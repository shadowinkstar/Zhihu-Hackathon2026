import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { getUserWorkspace } from "@/lib/server/user-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) {
    return NextResponse.json({ user: null, styles: [], generations: [] });
  }

  const workspace = await getUserWorkspace(session.user.id);
  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      avatarUrl: session.user.avatarUrl,
      urlToken: session.user.urlToken,
    },
    styles: workspace.styles,
    generations: workspace.generations,
  });
}
