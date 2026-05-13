import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/lib/server/invite-store";
import {
  getClaudeCodeDaemon,
  shouldTryClaudeCode,
} from "@/lib/server/claude-code-daemon";
import { generationModeSchema } from "@/lib/server/generate-schema";
import { safeError } from "@/lib/server/call-logger";

export const runtime = "nodejs";

const requestSchema = z.object({
  generationMode: generationModeSchema.optional(),
  thinkingEnabled: z.boolean().optional(),
  length: z.enum(["short", "medium", "long"]),
  access: z.object({
    mode: z.literal("invite"),
    inviteCode: z.string().min(1),
  }),
});

type StreamEvent =
  | { type: "log"; title: string; detail?: string; status?: "running" | "done" | "error" | "info" }
  | { type: "reasoning"; chunk: string }
  | { type: "text"; chunk: string };

function continuationPrompt(length: "short" | "medium" | "long") {
  const lengthGuide = {
    short: "继续生成一小段，推进一个动作或一个钩子即可。",
    medium: "继续生成若干自然段，承接上一段的节奏，推进一个新的转折或悬念。",
    long: "继续生成较完整的一段后续内容，可以展开更多人物反应、冲突推进和段尾钩子。",
  }[length];

  return [
    "继续生成。",
    "你已经在当前 Claude Code 会话里写过上一段续写，请直接接着上一段往后写。",
    "不要重复上一段，不要重新解释设定，不要输出标题、Markdown、说明或总结。",
    "保持同一文风、人物关系、安全边界和续写方向。",
    lengthGuide,
    "只输出中文正文。",
  ].join("\n");
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "继续生成参数不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!shouldTryClaudeCode()) {
    return NextResponse.json({ error: "Claude Code 未启用，无法继续生成" }, { status: 503 });
  }

  const payload = parsed.data;
  const mode = payload.generationMode || "quick";
  const thinkingEnabled = payload.thinkingEnabled !== false;
  const daemon = getClaudeCodeDaemon(thinkingEnabled, mode);

  if (!daemon.hasSession()) {
    return NextResponse.json(
      { error: "当前没有可继续的 Claude Code 会话，请先完成一次生成。" },
      { status: 409 },
    );
  }

  const invite = await redeemInvite(payload.access.inviteCode, true);
  if (!invite.ok) {
    return NextResponse.json({ error: invite.reason }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamedText = "";
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
      ) => writeEvent({ type: "log", title, detail, status });
      const write = (chunk: string) => {
        if (!chunk) {
          return;
        }
        streamedText += chunk;
        writeEvent({ type: "text", chunk });
      };

      try {
        writeLog("继续生成", "复用当前 Claude Code 会话，只发送继续指令。", "running");
        const result = await daemon.runPrompt(continuationPrompt(payload.length), {
          mode,
          signal: request.signal,
          onText: write,
          onThinking: thinkingEnabled
            ? (chunk) => writeEvent({ type: "reasoning", chunk })
            : undefined,
          onLog: writeLog,
        });
        if (!streamedText) {
          write(result.text);
        }
        writeLog("继续生成完成", `${result.text.length} 个字符。`, "done");
      } catch (error) {
        if (safeError(error).name === "AbortError" || request.signal.aborted) {
          writeLog("继续生成已停止", "已保留当前已生成正文。", "info");
          return;
        }

        writeLog(
          "继续生成失败",
          safeError(error).message || "Claude Code 没有返回后续正文。",
          "error",
        );
      } finally {
        close();
      }
    },
    cancel() {
      daemon.cancelActive("用户已停止继续生成");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      "x-provider": "claude-code",
      "x-quota-remaining": String(invite.remaining),
    },
  });
}
