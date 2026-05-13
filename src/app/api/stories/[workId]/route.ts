import { NextResponse } from "next/server";
import { getHackathonStoryDetail } from "@/lib/server/zhihu-openapi";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  safeError,
  textSummary,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/stories/[workId]">) {
  const startedAt = new Date();
  const callId = newCallId("story_detail");
  const { workId } = await context.params;

  try {
    const story = await getHackathonStoryDetail(workId);
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "story_detail.completed",
      route: "/api/stories/[workId]",
      ok: true,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        workId,
      },
      response: {
        workId: story.workId,
        chapterName: story.chapterName,
        authorName: story.authorName,
        content: textSummary(story.content, 120),
      },
    });

    return NextResponse.json(story);
  } catch (error) {
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "story_detail.failed",
      route: "/api/stories/[workId]",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        workId,
      },
      error: safeError(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "知乎故事详情读取失败" },
      { status: 502 },
    );
  }
}
