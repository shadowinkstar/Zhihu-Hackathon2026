import { NextResponse } from "next/server";
import { z } from "zod";
import { remember } from "@/lib/server/memory-cache";
import { searchZhihuContent } from "@/lib/server/zhihu-openapi";

export const runtime = "nodejs";

const requestSchema = z.object({
  query: z.string().trim().min(1, "请输入搜索对象"),
});

const styleSearchTtlMs = 6 * 60 * 60 * 1000;
const styleSignals = ["文风", "写作", "风格", "叙事", "语言", "作品", "评论", "人物", "角色", "作者"];

type SearchCandidate = {
  id: string;
  title: string;
  source: string;
  sourceKind: "zhihu" | "web";
  relevance: number;
  reason: string;
  excerpt: string;
  url?: string;
  selected: boolean;
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function cleanHtml(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function queryParts(query: string) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function scoreCandidate(query: string, text: string, base = 40) {
  const normalized = text.toLowerCase();
  const queryScore = queryParts(query).reduce(
    (score, part) => score + (normalized.includes(part) ? 18 : 0),
    0,
  );
  const signalScore = styleSignals.reduce(
    (score, signal) => score + (text.includes(signal) ? 5 : 0),
    0,
  );

  return Math.max(35, Math.min(96, base + queryScore + signalScore));
}

function relevanceReason(candidate: {
  sourceKind: "zhihu" | "web";
  relevance: number;
  voteUpCount?: number;
  rankingScore?: number;
  authorityLevel?: string;
}) {
  const parts = [
    candidate.sourceKind === "zhihu"
      ? "知乎站内搜索结果，来自开发者 zhihu_search API。"
      : "公开网页搜索结果，用于知乎 API 不可用时补充候选。",
    "相关性综合关键词命中、文风信号词、内容摘要、站内排序分和互动数据估算。",
  ];

  if (typeof candidate.rankingScore === "number") {
    parts.push(`知乎排序分 ${candidate.rankingScore.toFixed(2)}。`);
  }
  if (typeof candidate.voteUpCount === "number") {
    parts.push(`赞同 ${candidate.voteUpCount}。`);
  }
  if (candidate.authorityLevel) {
    parts.push(`权威等级 ${candidate.authorityLevel}。`);
  }
  if (candidate.relevance < 68) {
    parts.push("建议人工确认后再采纳。");
  }

  return parts.join("");
}

async function searchZhihuCandidates(query: string): Promise<SearchCandidate[]> {
  const items = await searchZhihuContent(`${query} 文风 写作风格`, 10);

  return items.map((item, index) => {
    const combined = `${item.title} ${item.contentText} ${item.authorName}`;
    const rankScore = Number.isFinite(item.rankingScore)
      ? Math.min(18, Math.max(0, item.rankingScore * 18))
      : 0;
    const voteScore = Math.min(10, Math.log10(Math.max(1, item.voteUpCount + 1)) * 4);
    const authorityScore = Math.min(8, Number(item.authorityLevel || 0) * 2);
    const relevance = Math.round(
      Math.max(42, Math.min(98, scoreCandidate(query, combined, 45) + rankScore + voteScore + authorityScore)),
    );

    return {
      id: `zhihu-${item.contentId || index}`,
      title: item.title || "知乎搜索结果",
      source: `知乎 · ${item.authorName || "知乎用户"} · ${item.contentType}`,
      sourceKind: "zhihu" as const,
      relevance,
      reason: relevanceReason({
        sourceKind: "zhihu",
        relevance,
        voteUpCount: item.voteUpCount,
        rankingScore: item.rankingScore,
        authorityLevel: item.authorityLevel,
      }),
      excerpt: cleanHtml(
        [
          item.contentText,
          item.comments.length ? `精选评论：${item.comments.slice(0, 2).join(" / ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      url: item.url,
      selected: relevance >= 72,
    };
  });
}

function parseH3Results(html: string, query: string, sourceName: string): SearchCandidate[] {
  const blocks = html.match(/<h3[\s\S]*?<\/h3>[\s\S]*?(?=<h3|<\/body>)/g) || [];

  return blocks.flatMap((block, index): SearchCandidate[] => {
      const linkMatch = block.match(/<h3[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
      const title = cleanHtml(linkMatch?.[2] || block.match(/<h3[\s\S]*?>([\s\S]*?)<\/h3>/i)?.[1] || "");
      const url = decodeHtml(linkMatch?.[1] || "").trim();
      const excerpt = cleanHtml(
        block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
          block.match(/class="[^"]*(?:str_info|res-desc|mh-summary|summary)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ||
          "",
      );
      const combined = `${title} ${excerpt} ${url}`;
      if (!title || /其他人还搜|相关搜索/.test(title) || combined.length < 8) {
        return [];
      }

      const relevance = Math.round(scoreCandidate(query, combined));
      return [{
        id: `web-${sourceName}-${index + 1}`,
        title,
        source: `${sourceName} · 公开搜索`,
        sourceKind: "web" as const,
        relevance,
        reason: relevanceReason({ sourceKind: "web", relevance }),
        excerpt: excerpt || "该结果缺少摘要，需要打开原文后再确认是否采纳。",
        url,
        selected: relevance >= 78,
      }];
    });
}

function parseBingResults(html: string, query: string): SearchCandidate[] {
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  return blocks.flatMap((block, index): SearchCandidate[] => {
      const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const title = cleanHtml(linkMatch?.[2] || "");
      const url = decodeHtml(linkMatch?.[1] || "").trim();
      const excerpt = cleanHtml(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
      if (!title) {
        return [];
      }
      const relevance = Math.round(scoreCandidate(query, `${title} ${excerpt} ${url}`));
      return [{
        id: `web-bing-${index + 1}`,
        title,
        source: "Bing · 公开搜索",
        sourceKind: "web" as const,
        relevance,
        reason: relevanceReason({ sourceKind: "web", relevance }),
        excerpt: excerpt || "该结果缺少摘要，需要打开原文后再确认是否采纳。",
        url,
        selected: relevance >= 78,
      }];
    });
}

async function fetchText(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: {
      "user-agent": "Mozilla/5.0 GouweiXudiaoBot/0.1 (+https://example.local)",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  return response.ok ? response.text() : "";
}

async function searchWebCandidates(query: string): Promise<SearchCandidate[]> {
  const queryText = `${query} 文风 写作风格 作品 评论`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const [sogou, so, bing] = await Promise.allSettled([
      fetchText(`https://www.sogou.com/web?query=${encodeURIComponent(queryText)}`, controller.signal),
      fetchText(`https://www.so.com/s?q=${encodeURIComponent(queryText)}`, controller.signal),
      fetchText(`https://cn.bing.com/search?cc=cn&setlang=zh-CN&q=${encodeURIComponent(queryText)}`, controller.signal),
    ]);

    const candidates = [
      ...(sogou.status === "fulfilled" ? parseH3Results(sogou.value, query, "搜狗") : []),
      ...(so.status === "fulfilled" ? parseH3Results(so.value, query, "360") : []),
      ...(bing.status === "fulfilled" ? parseBingResults(bing.value, query) : []),
    ];
    return candidates;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  return candidates
    .sort((left, right) => right.relevance - left.relevance)
    .filter((candidate) => {
      const key = (candidate.url || candidate.title).toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 16);
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "搜索输入不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const query = parsed.data.query;

  try {
    const candidates = await remember(`style-search:${query.toLowerCase()}`, styleSearchTtlMs, async () => {
      const [zhihu, web] = await Promise.allSettled([
        searchZhihuCandidates(query),
        searchWebCandidates(query),
      ]);
      return uniqueCandidates([
        ...(zhihu.status === "fulfilled" ? zhihu.value : []),
        ...(web.status === "fulfilled" ? web.value : []),
      ]);
    });

    if (!candidates.length) {
      return NextResponse.json({ error: "没有找到足够相关的公开材料" }, { status: 404 });
    }

    return NextResponse.json({
      candidates,
      sourceNote:
        "优先使用知乎开发者 zhihu_search API；未配置 Access Secret 或接口失败时，用公开搜索结果兜底。结果已缓存 6 小时。",
      scoringNote:
        "相关性由关键词命中、文风信号词、知乎 RankingScore、赞同数、权威等级和摘要完整度综合估算，用户可手动勾选采纳。",
    });
  } catch {
    return NextResponse.json({ error: "网络搜索超时，请换一个关键词再试" }, { status: 504 });
  }
}
