import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/lib/server/invite-store";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  textSummary,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

const requestSchema = z.object({
  code: z.string().min(1),
  previewOnly: z.boolean().default(true),
});

export async function POST(request: Request) {
  const startedAt = new Date();
  const callId = newCallId("invite");
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    await logCallEvent({
      callId,
      event: "invite.validation_failed",
      route: "/api/invite/redeem",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: parsed.error.flatten(),
    });

    return NextResponse.json({ error: "邀请码格式不正确" }, { status: 400 });
  }

  const result = await redeemInvite(parsed.data.code, !parsed.data.previewOnly);
  const endedAt = new Date();

  await logCallEvent({
    callId,
    event: result.ok ? "invite.completed" : "invite.rejected",
    route: "/api/invite/redeem",
    ok: result.ok,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    promptVersion: PROMPT_VERSION,
    request: {
      codeHash: textSummary(parsed.data.code).hash,
      previewOnly: parsed.data.previewOnly,
    },
    response: result,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
