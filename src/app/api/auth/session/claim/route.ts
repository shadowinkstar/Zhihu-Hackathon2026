import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/server/auth";
import { consumeLoginTicket } from "@/lib/server/user-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { ticket?: string };
  const sessionId = await consumeLoginTicket(body.ticket);
  if (!sessionId) {
    return NextResponse.json({ error: "登录票据无效或已过期" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, sessionId);
  return response;
}
