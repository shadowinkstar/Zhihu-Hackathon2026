import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  await clearSession(request, response);
  return response;
}
