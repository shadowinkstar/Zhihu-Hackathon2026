import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { TextDecoder } from "node:util";
import type { GenerateRequest, GenerationMode } from "@/lib/types";
import { buildClaudeMessages } from "@/lib/server/generation-prompts";

type ClaudeCodeStatus = "running" | "done" | "error" | "info";

type ClaudeCodeRunOptions = {
  mode: GenerationMode;
  onText?: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onLog?: (title: string, detail?: string, status?: ClaudeCodeStatus) => void;
};

type ClaudeRunState = {
  options: ClaudeCodeRunOptions;
  text: string;
  thinking: string;
  assistantText: string;
  model?: string;
  sessionId?: string;
  resolve: (result: ClaudeCodeRunResult) => void;
  reject: (error: Error) => void;
  startedAt: number;
  firstThinkingAt?: number;
  firstTextAt?: number;
};

export type ClaudeCodeRunResult = {
  text: string;
  thinking: string;
  model: string;
  mode: GenerationMode;
  sessionId?: string;
  timings: {
    durationMs: number;
    firstThinkingMs?: number;
    firstTextMs?: number;
  };
};

const decoder = new TextDecoder("utf-8");

function claudeExecutable() {
  return process.env.CLAUDE_CODE_PATH || "claude";
}

function shouldUseBareMode() {
  return process.env.CLAUDE_CODE_BARE === "1";
}

function runTimeoutMs(mode: GenerationMode) {
  const configured = Number(process.env.CLAUDE_CODE_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return mode === "expert" ? 180000 : 120000;
}

function buildClaudeCodePrompt(payload: GenerateRequest) {
  const { system, messages } = buildClaudeMessages(payload);
  const userText = messages
    .map((message) => message.content)
    .join("\n\n");

  return [
    "你正在作为“狗尾续貂？”工作台里的创作智能体运行。",
    "不要调用工具，不要读取文件，不要解释执行过程。",
    payload.thinkingEnabled === false
      ? "模型思考已关闭：直接生成正文，尽量减少推理展开；最终回复必须只包含中文续写正文。"
      : "模型思考已开启：你可以在推理过程中分析文风、剧情钩子、续写策略；最终回复必须只包含中文续写正文。",
    "最终回复不要包含标题、Markdown、JSON、编辑注释或过程说明。",
    "",
    "系统约束：",
    system,
    "",
    "用户任务：",
    userText,
  ].join("\n");
}

function userMessageLine(text: string) {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  })}\n`;
}

function safeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

class ClaudeCodeDaemon {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lineBuffer = "";
  private active: ClaudeRunState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private warmPromise: Promise<void> | null = null;
  private startedAt = 0;

  constructor(private readonly thinkingEnabled: boolean) {}

  isReady() {
    return Boolean(this.child && !this.child.killed);
  }

  isBusy() {
    return Boolean(this.active);
  }

  ensureStarted(onLog?: ClaudeCodeRunOptions["onLog"]) {
    if (this.child && !this.child.killed) {
      return;
    }

    const args = [
      "-p",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--thinking",
      this.thinkingEnabled ? "enabled" : "disabled",
    ];

    if (this.thinkingEnabled) {
      args.push("--effort", "medium");
    }

    if (shouldUseBareMode()) {
      args.push("--bare");
    }

    this.startedAt = Date.now();
    this.lineBuffer = "";
    this.child = spawn(claudeExecutable(), args, {
      env: {
        ...process.env,
        FORCE_COLOR: "0",
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    onLog?.(
      "Claude Code 常驻进程已启动",
      this.thinkingEnabled
        ? `PID ${this.child.pid ?? "unknown"}，模型思考开启`
        : `PID ${this.child.pid ?? "unknown"}，模型思考关闭`,
      "info",
    );

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.consumeStdout(decoder.decode(chunk, { stream: true }));
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = decoder.decode(chunk, { stream: true }).trim();
      if (text) {
        this.active?.options.onLog?.("Claude Code stderr", text.slice(0, 220), "info");
      }
    });

    this.child.on("error", (error) => {
      this.failActive(safeError(error));
      this.child = null;
    });

    this.child.on("close", (code) => {
      this.failActive(new Error(`Claude Code 常驻进程已退出（code ${code ?? "unknown"}）`));
      this.child = null;
      this.lineBuffer = "";
    });
  }

  warm() {
    if (this.warmPromise) {
      return this.warmPromise;
    }

    this.warmPromise = this.enqueueRaw(
      "这是工作台预热消息。不要使用工具，只输出两个字：就绪。",
      { mode: "quick" },
      true,
    ).then(
      () => undefined,
      (error) => {
        this.warmPromise = null;
        throw error;
      },
    );

    return this.warmPromise;
  }

  run(payload: GenerateRequest, options: ClaudeCodeRunOptions) {
    return this.enqueueRaw(buildClaudeCodePrompt(payload), options, false);
  }

  private enqueueRaw(
    prompt: string,
    options: Pick<ClaudeCodeRunOptions, "mode"> & Partial<ClaudeCodeRunOptions>,
    quiet: boolean,
  ) {
    const execution = this.queue.then(
      () =>
        new Promise<ClaudeCodeRunResult>((resolve, reject) => {
          this.ensureStarted(options.onLog);

          const child = this.child;
          if (!child || child.killed) {
            reject(new Error("Claude Code 常驻进程没有启动"));
            return;
          }

          const timer = setTimeout(() => {
            this.failActive(new Error(`Claude Code 调用超时（${runTimeoutMs(options.mode)}ms）`));
            this.restart();
          }, runTimeoutMs(options.mode));

          const startedAt = Date.now();
          this.active = {
            options,
            text: "",
            thinking: "",
            assistantText: "",
            resolve: (result) => {
              clearTimeout(timer);
              resolve(result);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
            startedAt,
          };

          if (!quiet) {
            options.onLog?.(
              "等待模型返回",
              this.thinkingEnabled
                ? "复用单用户常驻上下文，等待模型返回推理流。"
                : "复用单用户常驻上下文，等待模型返回正文。",
              "running",
            );
          }

          child.stdin.write(userMessageLine(prompt), "utf-8");
        }),
    );

    this.queue = execution.then(
      () => undefined,
      () => undefined,
    );

    return execution;
  }

  private consumeStdout(text: string) {
    this.lineBuffer += text;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      this.handleLine(line);
    }
  }

  private handleLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    const record = message as {
      type?: string;
      subtype?: string;
      session_id?: string;
      event?: {
        type?: string;
        message?: {
          model?: string;
        };
        delta?: {
          type?: string;
          thinking?: string;
          text?: string;
        };
      };
      message?: {
        content?: Array<{ type?: string; text?: string }>;
      };
      is_error?: boolean;
      error?: string;
      result?: string;
    };

    const active = this.active;
    if (!active) {
      return;
    }

    if (record.session_id) {
      active.sessionId = record.session_id;
    }

    if (record.event?.type === "message_start") {
      active.model = record.event.message?.model || active.model;
      active.options.onLog?.("模型请求已建立", active.model, "info");
      return;
    }

    if (record.event?.type === "content_block_delta") {
      const delta = record.event.delta;
      if (delta?.type === "thinking_delta" && delta.thinking) {
        if (active.firstThinkingAt === undefined) {
          active.firstThinkingAt = Date.now();
          if (active.options.onThinking) {
            active.options.onLog?.(
              "收到实时推理",
              `${active.firstThinkingAt - active.startedAt}ms 后开始返回 thinking_delta。`,
              "done",
            );
          }
        }
        active.thinking += delta.thinking;
        active.options.onThinking?.(delta.thinking);
        return;
      }

      if (delta?.type === "text_delta" && delta.text) {
        if (active.firstTextAt === undefined) {
          active.firstTextAt = Date.now();
          active.options.onLog?.(
            "开始生成正文",
            `${active.firstTextAt - active.startedAt}ms 后开始返回 text_delta。`,
            "done",
          );
        }
        active.text += delta.text;
        active.options.onText?.(delta.text);
        return;
      }
    }

    if (record.type === "assistant" && Array.isArray(record.message?.content)) {
      active.assistantText = record.message.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("");
      return;
    }

    if (record.type === "result") {
      const resultText = active.text || active.assistantText || record.result || "";
      const result: ClaudeCodeRunResult = {
        text: resultText.trim(),
        thinking: active.thinking.trim(),
        model: active.model || process.env.ANTHROPIC_MODEL || "kimi-for-coding",
        mode: active.options.mode,
        sessionId: active.sessionId,
        timings: {
          durationMs: Date.now() - active.startedAt,
          firstThinkingMs: active.firstThinkingAt
            ? active.firstThinkingAt - active.startedAt
            : undefined,
          firstTextMs: active.firstTextAt ? active.firstTextAt - active.startedAt : undefined,
        },
      };
      this.active = null;

      if (record.is_error || !result.text) {
        active.reject(new Error(record.error || "Claude Code 没有返回正文"));
        return;
      }

      active.resolve(result);
    }
  }

  private failActive(error: Error) {
    const active = this.active;
    this.active = null;
    active?.reject(error);
  }

  private restart() {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      child.kill();
    }
  }
}

const globalForClaude = globalThis as typeof globalThis & {
  __gouweiClaudeCodeDaemons?: {
    thinking?: ClaudeCodeDaemon;
    direct?: ClaudeCodeDaemon;
  };
};

export function shouldTryClaudeCode() {
  return process.env.CLAUDE_CODE_ENABLED !== "0";
}

export function getClaudeCodeDaemon(thinkingEnabled = true) {
  globalForClaude.__gouweiClaudeCodeDaemons ??= {};
  const key = thinkingEnabled ? "thinking" : "direct";
  globalForClaude.__gouweiClaudeCodeDaemons[key] ??= new ClaudeCodeDaemon(thinkingEnabled);
  return globalForClaude.__gouweiClaudeCodeDaemons[key];
}
