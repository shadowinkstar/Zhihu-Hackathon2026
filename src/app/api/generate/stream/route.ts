import { NextResponse } from "next/server";
import { redeemInvite } from "@/lib/server/invite-store";
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
  if (!shouldTryClaudeCode()) {
    return NextResponse.json({ ok: false, reason: "Claude Code 未启用" }, { status: 503 });
  }

  try {
    await getClaudeCodeDaemon(true).warm();
    return NextResponse.json({ ok: true, provider: "claude-code" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeError(error).message || "Claude Code 预热失败",
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const startedAt = new Date();
  const callId = newCallId("generate_stream");
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

  if (payload.access.mode !== "invite") {
    return NextResponse.json({ error: "流式生成只支持邀请码模式" }, { status: 400 });
  }

  const invite = await redeemInvite(payload.access.inviteCode, true);
  if (!invite.ok) {
    await logCallEvent({
      callId,
      event: "generate_stream.invite_rejected",
      route: "/api/generate/stream",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: requestLog,
      error: {
        reason: invite.reason,
      },
    });
    return NextResponse.json({ error: invite.reason }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const preferredProvider = shouldTryClaudeCode() ? "claude-code" : "demo-invite";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamedText = "";
      let firstTextReceived = false;
      let closed = false;

      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const writeEvent = (event: StreamEvent) => {
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
          "demo-invite",
          invite.remaining,
          undefined,
          generationMode,
        );
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
          provider: "demo-invite",
          model: "mock",
          request: requestLog,
          prompts: promptLog,
          response: result,
          meta: {
            inviteRemaining: invite.remaining,
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
        const claudeResult = await getClaudeCodeDaemon(thinkingEnabled).run(payload, {
          mode: generationMode,
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
          invite.remaining,
          claudeResult.model,
          generationMode,
        );
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
            inviteRemaining: invite.remaining,
            mode: claudeResult.mode,
            thinkingEnabled,
            timings: claudeResult.timings,
          },
        });
      } catch (error) {
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
            fallback: streamedText ? "closed-partial-stream" : "demo-invite",
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
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      "x-generation-mode": generationMode,
      "x-provider": preferredProvider,
      "x-quota-remaining": String(invite.remaining),
    },
  });
}
