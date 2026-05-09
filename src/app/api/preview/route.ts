import { NextResponse } from "next/server";
import { z } from "zod";
import type { ArticlePreview } from "@/lib/types";
import { extractFirstUrl } from "@/lib/zhihu-url";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  safeError,
  textSummary,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

const requestSchema = z.object({
  sourceUrl: z.string().trim().min(1),
});

function cleanTitle(title?: string | null) {
  return title?.replace(/\s+/g, " ").replace(/ - 知乎$/, "").trim() || null;
}

function detectLinkKind(sourceUrl: string): ArticlePreview["linkKind"] {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === "oia.zhihu.com" && url.pathname.includes("/km_paid_content/share")) {
      return "paid_share";
    }
    if (
      url.hostname.endsWith("zhihu.com") &&
      (/^\/answer\/\d+/.test(url.pathname) || /^\/question\/\d+\/answer\/\d+/.test(url.pathname))
    ) {
      return "zhihu_answer";
    }
    if (url.hostname.endsWith("zhihu.com")) {
      return "zhihu_article";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

async function fetchPublicMeta(sourceUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4200);
  const response = await fetch(sourceUrl, {
    signal: controller.signal,
    headers: {
      "user-agent": "Mozilla/5.0 GouweiXudiaoBot/0.1 (+https://example.local)",
    },
  });
  clearTimeout(timer);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      title: null,
    };
  }

  const html = await response.text();
  return {
    ok: true,
    status: response.status,
    title: cleanTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]),
  };
}

function buildFallbackPreview(sourceUrl: string, kind: ArticlePreview["linkKind"], title?: string | null): ArticlePreview {
  if (kind === "paid_share") {
    return {
      id: crypto.randomUUID(),
      sourceUrl,
      linkKind: kind,
      status: "paid_content",
      title: title || "盐选付费内容",
      author: "知乎作者",
      previewText: "",
      accessNote: "检测到盐选/付费分享链接。请粘贴你已看到且有权使用的试读片段或正文片段。",
    };
  }

  if (kind === "zhihu_answer") {
    return {
      id: crypto.randomUUID(),
      sourceUrl,
      linkKind: kind,
      status: "blocked",
      title: title || "知乎回答",
      author: "知乎作者",
      previewText: "",
      accessNote: "知乎限制了自动读取。请粘贴公开可见片段、试读内容或你已购买后可见的片段。",
    };
  }

  return {
    id: crypto.randomUUID(),
    sourceUrl,
    linkKind: kind,
    status: "manual_input",
    title: title || "待导入文本",
    author: kind === "zhihu_article" ? "知乎作者" : "链接作者",
    previewText: "",
    accessNote: "未读取到正文。可以直接粘贴你有权使用的片段继续续写。",
  };
}

export async function POST(request: Request) {
  const startedAt = new Date();
  const callId = newCallId("preview");
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    await logCallEvent({
      callId,
      event: "preview.validation_failed",
      route: "/api/preview",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: parsed.error.flatten(),
    });

    return NextResponse.json({ error: "链接格式不正确" }, { status: 400 });
  }

  const rawSourceUrl = parsed.data.sourceUrl;
  const sourceUrl = extractFirstUrl(rawSourceUrl);
  const linkKind = detectLinkKind(sourceUrl);

  try {
    if (!/^https?:\/\//i.test(sourceUrl)) {
      const endedAt = new Date();
      await logCallEvent({
        callId,
        event: "preview.no_url_found",
        route: "/api/preview",
        ok: false,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        promptVersion: PROMPT_VERSION,
        request: {
          rawSourceUrl,
          extracted: sourceUrl,
        },
      });

      return NextResponse.json({ error: "没有识别到链接" }, { status: 400 });
    }

    let preview: ArticlePreview;
    let publicStatus: number | null = null;

    if (linkKind === "paid_share") {
      preview = buildFallbackPreview(sourceUrl, linkKind);
    } else {
      const meta = await fetchPublicMeta(sourceUrl);
      publicStatus = meta.status;
      preview = meta.ok
        ? {
            id: crypto.randomUUID(),
            sourceUrl,
            linkKind,
            status: "manual_input",
            title: meta.title || (linkKind === "zhihu_answer" ? "知乎回答" : "知乎文章"),
            author: sourceUrl.includes("zhihu.com") ? "知乎作者" : "链接作者",
            previewText: "",
            accessNote: "已读取公开标题；正文请粘贴你可见且有权使用的片段。",
          }
        : buildFallbackPreview(sourceUrl, linkKind, meta.title);
    }

    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "preview.completed",
      route: "/api/preview",
      ok: true,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        rawSourceUrl,
        sourceUrl,
        linkKind,
      },
      response: {
        title: preview.title,
        author: preview.author,
        status: preview.status,
        linkKind: preview.linkKind,
        previewText: textSummary(preview.previewText, 80),
        accessNote: preview.accessNote,
      },
      meta: {
        publicStatus,
      },
    });

    return NextResponse.json(preview);
  } catch (error) {
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "preview.failed",
      route: "/api/preview",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        rawSourceUrl,
        sourceUrl,
        linkKind,
      },
      error: safeError(error),
    });

    return NextResponse.json({ error: "试看片段读取失败" }, { status: 500 });
  }
}
