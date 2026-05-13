import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import {
  buildGeneratePromptLog,
  buildGenerateRequestLog,
} from "@/lib/server/generation-logging";
import { buildMessages } from "@/lib/server/generation-prompts";
import {
  buildContinuationResult,
  mockContinuation,
} from "@/lib/server/generation-common";
import { generateSchema, generationModeFor } from "@/lib/server/generate-schema";
import {
  getClaudeCodeDiagnostics,
  getClaudeCodeDaemon,
  shouldTryClaudeCode,
} from "@/lib/server/claude-code-daemon";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  safeError,
  textSummary,
} from "@/lib/server/call-logger";
import { saveGenerationRecord } from "@/lib/server/user-store";

export const runtime = "nodejs";

const streamChunkDelayMs = 18;

type StreamEvent =
  | { type: "log"; title: string; detail?: string; status?: "running" | "done" | "error" | "info" }
  | { type: "reasoning"; chunk: string }
  | { type: "text"; chunk: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitStreamText(text: string) {
  const chunks: string[] = [];
  let buffer = "";

  for (const char of text) {
    buffer += char;
    if (buffer.length >= 18 || /[。！？；\n]/.test(char)) {
      chunks.push(buffer);
      buffer = "";
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

export async function GET() {
  const diagnostics = getClaudeCodeDiagnostics();
  if (!shouldTryClaudeCode()) {
    return NextResponse.json({
      ok: false,
      reason: "Claude Code 未启用",
      diagnostics,
    });
  }

  try {
    await getClaudeCodeDaemon(true).warm();
    return NextResponse.json({ ok: true, provider: "claude-code", diagnostics });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeError(error).message || "Claude Code 预热失败",
        diagnostics,
      },
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAt = new Date();
  const callId = newCallId("generate_stream");
  const session = await requireUser(request);
  if (!session) {
    return NextResponse.json({ error: "请先使用知乎登录后再调用内置 Kimi 模型" }, { status: 401 });
  }

  const parsed = generateSchema.safeParse(await request.json());

  if (!parsed.success) {
    await logCallEvent({
      callId,
      event: "generate_stream.validation_failed",
      route: "/api/generate/stream",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: parsed.error.flatten(),
    });

    return NextResponse.json(
      { error: "生成参数不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const generationMode = generationModeFor(payload);
  const thinkingEnabled = payload.thinkingEnabled !== false;
  const promptMessages = buildMessages(payload);
  const requestLog = buildGenerateRequestLog(payload, generationMode);
  const promptLog = buildGeneratePromptLog(payload, promptMessages);

  if (payload.access.mode !== "internal") {
    return NextResponse.json({ error: "流式生成只支持登录后的内置 Kimi 模型" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const preferredProvider = shouldTryClaudeCode() ? "claude-code" : "demo-local";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamedText = "";
      let firstTextReceived = false;
      let closed = false;

      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Client may have already closed the stream after pressing stop.
          }
        }
      };
      const writeEvent = (event: StreamEvent) => {
        if (closed || request.signal.aborted) {
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const writeLog = (
        title: string,
        detail?: string,
        status: Extract<StreamEvent, { type: "log" }>["status"] = "info",
      ) => {
        writeEvent({ type: "log", title, detail, status });
      };
      const write = (chunk: string) => {
        if (!chunk) {
          return;
        }
        if (!firstTextReceived) {
          firstTextReceived = true;
          writeLog("开始接收正文", "正文会按模型返回节奏流入右侧。", "done");
        }
        streamedText += chunk;
        writeEvent({ type: "text", chunk });
      };
      const writeReasoning = (chunk: string) => {
        if (!chunk) {
          return;
        }
        writeEvent({ type: "reasoning", chunk });
      };
      const writeText = async (text: string) => {
        for (const chunk of splitStreamText(text)) {
          write(chunk);
          await sleep(streamChunkDelayMs);
        }
      };
      const completeWithDemo = async (fallbackFrom?: string) => {
        writeLog("改用演示兜底", "当前项目模型没有返回可用正文。", "info");
        const mock = mockContinuation(payload);
        await writeText(mock);
        const result = buildContinuationResult(
          payload,
          mock,
          "demo-local",
          undefined,
          undefined,
          generationMode,
        );
        await saveGenerationRecord(session.user.id, result, {
          sourceTitle: payload.analysis.source.title,
          selectedArc: payload.selectedArc,
          styleLabel: payload.styleProfile?.label,
          mode: generationMode,
        });
        const endedAt = new Date();
        await logCallEvent({
          callId,
          event: "generate_stream.completed",
          route: "/api/generate/stream",
          ok: true,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          promptVersion: PROMPT_VERSION,
          provider: "demo-local",
          model: "mock",
          request: requestLog,
          prompts: promptLog,
          response: result,
          meta: {
            fallbackFrom,
          },
        });
      };

      if (!shouldTryClaudeCode()) {
        writeLog("Claude Code 未启用", "改用演示生成。", "info");
        await completeWithDemo("claude-code-disabled");
        close();
        return;
      }

      const modelStartedAt = Date.now();
      try {
        writeLog(
          "使用 Claude Code",
          "通过 Claude Code 调用当前项目模型配置。",
          "info",
        );
        const claudeResult = await getClaudeCodeDaemon(thinkingEnabled, generationMode).run(payload, {
          mode: generationMode,
          signal: request.signal,
          onText: write,
          onThinking: thinkingEnabled ? writeReasoning : undefined,
          onLog: writeLog,
        });
        if (!streamedText) {
          await writeText(claudeResult.text);
        }
        writeLog(
          "Claude Code 完成",
          thinkingEnabled
            ? `${claudeResult.text.length} 个字符，推理 ${claudeResult.thinking.length} 字符。`
            : `${claudeResult.text.length} 个字符。`,
          "done",
        );
        const result = buildContinuationResult(
          payload,
          claudeResult.text,
          "claude-code",
          undefined,
          claudeResult.model,
          generationMode,
        );
        await saveGenerationRecord(session.user.id, result, {
          sourceTitle: payload.analysis.source.title,
          selectedArc: payload.selectedArc,
          styleLabel: payload.styleProfile?.label,
          mode: generationMode,
        });
        const endedAt = new Date();

        await logCallEvent({
          callId,
          event: "model.completed",
          route: "/api/generate/stream",
          ok: true,
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "claude-code",
          model: claudeResult.model,
          request: requestLog,
          prompts: promptLog,
          response: {
            output: claudeResult.text,
            outputSummary: textSummary(claudeResult.text),
            thinkingSummary: textSummary(claudeResult.thinking),
          },
          meta: {
            mode: claudeResult.mode,
            sessionId: claudeResult.sessionId,
            thinkingEnabled,
            timings: claudeResult.timings,
          },
        });

        await logCallEvent({
          callId,
          event: "generate_stream.completed",
          route: "/api/generate/stream",
          ok: true,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          promptVersion: PROMPT_VERSION,
          provider: "claude-code",
          model: claudeResult.model,
          request: requestLog,
          prompts: promptLog,
          response: result,
          meta: {
            mode: claudeResult.mode,
            thinkingEnabled,
            timings: claudeResult.timings,
          },
        });
      } catch (error) {
        if (safeError(error).name === "AbortError" || request.signal.aborted) {
          if (!closed) {
            writeLog("生成已停止", "已保留当前已生成正文，可继续生成后续。", "info");
          }
          return;
        }

        writeLog(
          streamedText ? "Claude Code 中途结束" : "Claude Code 调用失败",
          safeError(error).message || "常驻进程没有拿到可用正文。",
          "error",
        );
        await logCallEvent({
          callId,
          event: streamedText ? "model.partial_failed" : "model.failed",
          route: "/api/generate/stream",
          ok: false,
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "claude-code",
          model: process.env.ANTHROPIC_MODEL || "kimi-for-coding",
          request: requestLog,
          prompts: promptLog,
          error: safeError(error),
          meta: {
            fallback: streamedText ? "closed-partial-stream" : "demo-local",
            mode: generationMode,
          },
        });

        if (!streamedText) {
          await completeWithDemo("claude-code");
        }
      } finally {
        close();
      }
    },
    cancel() {
      getClaudeCodeDaemon(thinkingEnabled, generationMode).cancelActive("用户已停止生成");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      "x-generation-mode": generationMode,
      "x-provider": preferredProvider,
    },
  });
}
