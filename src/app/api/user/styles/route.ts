import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { deleteUserStyle, saveUserStyle } from "@/lib/server/user-store";

export const runtime = "nodejs";

const styleSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  prompt: z.string(),
  source: z.enum(["preset", "analysis", "neutral"]),
  provenance: z.string().optional(),
  dimensions: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) {
    return NextResponse.json({ error: "请先使用知乎登录" }, { status: 401 });
  }

  const parsed = styleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "文风格式不正确", issues: parsed.error.flatten() }, { status: 400 });
  }

  const style = await saveUserStyle(session.user.id, parsed.data);
  return NextResponse.json({ style });
}

export async function DELETE(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) {
    return NextResponse.json({ error: "请先使用知乎登录" }, { status: 401 });
  }

  const styleId = request.nextUrl.searchParams.get("id");
  if (!styleId) {
    return NextResponse.json({ error: "缺少文风 ID" }, { status: 400 });
  }

  await deleteUserStyle(session.user.id, styleId);
  return NextResponse.json({ ok: true });
}
