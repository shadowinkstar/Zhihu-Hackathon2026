import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getClaudeCodeDaemon,
  shouldTryClaudeCode,
} from "@/lib/server/claude-code-daemon";
import { generationModeSchema } from "@/lib/server/generate-schema";

export const runtime = "nodejs";

const requestSchema = z.object({
  generationMode: generationModeSchema.optional(),
  thinkingEnabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!shouldTryClaudeCode()) {
    return NextResponse.json({ stopped: false, reason: "Claude Code 未启用" });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  const payload = parsed.success ? parsed.data : {};
  const stopped = getClaudeCodeDaemon(
    payload.thinkingEnabled !== false,
    payload.generationMode || "quick",
  ).cancelActive("用户已停止生成");

  return NextResponse.json({ stopped });
}
