import { NextResponse } from "next/server";
import { listHackathonStories } from "@/lib/server/zhihu-openapi";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  safeError,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = new Date();
  const callId = newCallId("stories");

  try {
    const stories = await listHackathonStories();
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "stories.completed",
      route: "/api/stories",
      ok: true,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      response: {
        count: stories.length,
        ids: stories.map((story) => story.workId),
      },
    });

    return NextResponse.json({ stories });
  } catch (error) {
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "stories.failed",
      route: "/api/stories",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: safeError(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "知乎故事列表读取失败" },
      { status: 502 },
    );
  }
}
