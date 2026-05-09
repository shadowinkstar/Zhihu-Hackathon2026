import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const PROMPT_VERSION = "gouwei-v0.7-paid-safe-preview";

type LogEvent = {
  callId: string;
  event: string;
  route: string;
  ok: boolean;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  promptVersion?: string;
  provider?: string;
  model?: string;
  request?: unknown;
  prompts?: unknown;
  response?: unknown;
  error?: unknown;
  meta?: unknown;
};

function logFilePath() {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), "data", "call-logs", `${day}.jsonl`);
}

export function newCallId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function hashText(value: string | undefined) {
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex");
}

export function textSummary(value: string | undefined, maxLength = 280) {
  if (!value) {
    return {
      length: 0,
      hash: null,
      preview: "",
    };
  }

  return {
    length: value.length,
    hash: hashText(value),
    preview: value.slice(0, maxLength),
  };
}

export function privateTextSummary(value: string | undefined) {
  return textSummary(value, 80);
}

export function safeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 6).join("\n"),
    };
  }

  return {
    message: String(error),
  };
}

export async function logCallEvent(event: LogEvent) {
  const target = logFilePath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(
    target,
    `${JSON.stringify({
      schema: "gouwei.call_log.v1",
      loggedAt: new Date().toISOString(),
      ...event,
    })}\n`,
    "utf8",
  );
}
