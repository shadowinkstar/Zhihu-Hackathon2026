import { NextResponse } from "next/server";
import { z } from "zod";
import type { NarrativeAnalysis } from "@/lib/types";
import { extractFirstUrl } from "@/lib/zhihu-url";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  privateTextSummary,
  safeError,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

const requestSchema = z.object({
  sourceUrl: z.string().trim().optional(),
  sourceText: z.string().trim().optional(),
  permission: z.literal("public").default("public"),
});

const sampleHooks = [
  "主角已经做出选择，但代价还没有真正落下。",
  "一个被轻描淡写带过的人物，明显藏着下一段剧情的钥匙。",
  "叙事里反复出现的物件还没有兑现，它适合成为转折机关。",
];

function pickTitle(sourceText?: string, fallback?: string) {
  const firstLine = sourceText
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstLine) {
    const normalized = firstLine.replace(/^#+\s*/, "");
    return normalized.length <= 42 ? normalized : `${normalized.slice(0, 36)}...`;
  }

  return fallback || "未命名的知乎长文";
}

function splitParagraphs(sourceText?: string) {
  return (sourceText || "")
    .split(/\n{2,}|\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 8);
}

function countMatches(value: string, pattern: RegExp) {
  return Array.from(value.matchAll(pattern)).length;
}

function analyzeWritingStyle(sourceText?: string) {
  const text = sourceText || "";
  const paragraphs = splitParagraphs(text);
  const sentenceCount = Math.max(1, countMatches(text, /[。！？!?]/g));
  const dialogueCount = countMatches(text, /[“「『][^”」』]{1,80}[”」』]/g);
  const questionCount = countMatches(text, /[？?]/g);
  const firstPersonCount = countMatches(text, /我|我们|咱/g);
  const hookWords = countMatches(text, /忽然|突然|可是|但|却|原来|直到|没想到|最后/g);
  const avgSentenceLength = Math.round(text.length / sentenceCount);
  const paragraphShape =
    paragraphs.length >= 6 ? "多段推进" : paragraphs.length >= 3 ? "中段展开" : "少段压缩";
  const pace = avgSentenceLength <= 22 ? "短句快切" : avgSentenceLength <= 42 ? "中速叙述" : "长句铺陈";
  const perspective =
    firstPersonCount >= 4 ? "第一人称贴身叙述" : dialogueCount >= 3 ? "对话推动叙事" : "第三人称近景叙事";
  const suspense = hookWords + questionCount >= 5 ? "高频钩子" : hookWords >= 2 ? "中频转折" : "低钩子密度";
  const dialogue = dialogueCount >= 4 ? "对话密集" : dialogueCount >= 1 ? "少量关键对话" : "叙述为主";

  return {
    paragraphs,
    avgSentenceLength,
    dimensions: [pace, paragraphShape, perspective, suspense, dialogue],
    rhythm:
      pace === "短句快切"
        ? ["短句推进", "关键句独立成段", "转折后快速落点"]
        : pace === "长句铺陈"
          ? ["长句铺垫", "细节层层补足", "段尾回收信息"]
          : ["中速叙述", "细节停顿", "段尾留钩"],
    diction:
      firstPersonCount >= 4
        ? ["自我回忆", "感受判断", "克制抒情"]
        : ["日常词汇", "具体物件", "轻解释"],
    plotMoves:
      suspense === "高频钩子"
        ? ["连续设疑", "旧物回收", "信息反转"]
        : ["动机补足", "关系推进", "开放结尾"],
    prompt: `参考炼化样本分析出的表达方式：${[pace, paragraphShape, perspective, suspense, dialogue].join("、")}。续写时保留这些叙事功能，不复制原句，不冒充原作者，不复现隐藏付费正文。`,
    summary: `已从炼化样本分析：${[pace, paragraphShape, perspective, suspense].join("、")}。`,
  };
}

function buildCorpusPlan(sourceText?: string) {
  const paragraphs = splitParagraphs(sourceText);
  const selected = paragraphs
    .map((paragraph, index) => ({
      id: `user-sample-${index + 1}`,
      title: `可见片段 ${index + 1}`,
      publishedAt: new Date(Date.now() - index * 86400000 * 7).toISOString().slice(0, 10),
      lengthClass: paragraph.length >= 160 ? "long" as const : "short" as const,
      recencyWeight: Number(Math.max(0.35, 1 - index * 0.12).toFixed(2)),
      selected: index < 8,
    }))
    .filter((sample) => sample.selected);

  return {
    strategy:
      selected.length > 0
        ? "从当前可见文本切分片段，按段落顺序近似时间权重，长短段混合提取节奏、词汇、桥段和禁区。"
        : "未取得可分析片段。需要用户粘贴可见内容后再生成文风结果。",
    samples: selected,
  };
}

async function readPublicTitle(sourceUrl?: string) {
  const normalizedUrl = extractFirstUrl(sourceUrl);
  if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 GouweiXudiaoBot/0.1 (+https://example.local)",
      },
    });
    clearTimeout(timer);

    const html = await response.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return title?.replace(/\s+/g, " ").replace(/ - 知乎$/, "").trim() || null;
  } catch {
    return null;
  }
}

function extractCharacters(sourceText?: string) {
  if (!sourceText) {
    return ["叙述者", "失踪的原作者", "被迫接稿的续写人"];
  }

  const candidates = Array.from(
    sourceText.matchAll(/[“「]([^”」]{2,8})[”」]|([\u4e00-\u9fa5]{2,4})(?:说|问|想|笑|走|看)/g),
  )
    .map((match) => match[1] || match[2])
    .filter(Boolean);

  return Array.from(new Set(candidates)).slice(0, 4).concat(["旁观者"]).slice(0, 4);
}

function buildAnalysis(input: z.infer<typeof requestSchema>, publicTitle?: string | null): NarrativeAnalysis {
  const normalizedUrl = extractFirstUrl(input.sourceUrl);
  const textLength = input.sourceText?.length || 0;
  const title = pickTitle(input.sourceText, publicTitle || undefined);
  const isZhihu = Boolean(normalizedUrl.includes("zhihu.com"));
  const hasUrl = Boolean(normalizedUrl);
  const style = analyzeWritingStyle(input.sourceText);
  const corpusPlan = buildCorpusPlan(input.sourceText);

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: {
      title,
      author: isZhihu ? "知乎作者" : "用户提供文本",
      sourceType: hasUrl ? "知乎链接 / 公开元信息" : "用户上传草稿",
      publicOnly: input.permission === "public",
      sourceNote: "仅使用接口返回正文、公开可访问信息与用户粘贴片段，不读取隐藏付费正文。",
      permission: input.permission,
    },
    styleProfile: {
      id: "analyzed-author-style",
      label: "自制文风",
      source: "analysis",
      summary: style.summary,
      prompt: style.prompt,
      provenance: "由文风炼化生成。",
      dimensions: style.dimensions,
    },
    corpusPlan,
    story: {
      premise:
        textLength > 80
          ? "文本已经具备明确的叙事入口，适合做结构化续写与多路线延展。"
          : "当前样本较短，系统会偏向生成故事骨架、人物动机和安全续写方向。",
      characters: extractCharacters(input.sourceText),
      unresolvedHooks: sampleHooks,
      continuityRules: [
        "不复述原文，不补写付费隐藏章节，只延展用户有权使用的情节线索。",
        "优先维持人物动机、叙事视角和世界观规则的一致性。",
        "每次生成都附带 AI 辅助声明、来源跳转和可下架说明。",
      ],
    },
    styleSkill: {
      name: "dogtail-style.skill",
      version: "0.1.0",
      summary: "已归纳叙事节奏、常用桥段和不可触碰的版权边界。",
      rhythm: style.rhythm,
      diction: style.diction,
      plotMoves: style.plotMoves,
      avoid: ["复现大段原文", "声称原作者", "绕过付费墙", "生成可混淆为原作的新章节"],
      prompt:
        "你是续写协作编辑。请学习节奏、叙事功能和结构偏好，不要模仿受保护文本的独特表达，不要声称自己是原作者。",
    },
    guardrails: {
      status: "needs_review",
      notices: [
        "输出默认标识为 AI 辅助创作。",
        "知乎链接只抽取标题、简介和用户提供的片段。",
        "风格 Skill 记录可查看、可删除、可导出。",
      ],
    },
  };
}

export async function POST(request: Request) {
  const startedAt = new Date();
  const callId = newCallId("analyze");
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    await logCallEvent({
      callId,
      event: "analyze.validation_failed",
      route: "/api/analyze",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: parsed.error.flatten(),
    });

    return NextResponse.json(
      { error: "输入格式不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!parsed.data.sourceText?.trim()) {
    await logCallEvent({
      callId,
      event: "analyze.insufficient_samples",
      route: "/api/analyze",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        rawSourceUrl: parsed.data.sourceUrl,
        sourceUrl: extractFirstUrl(parsed.data.sourceUrl),
        permission: parsed.data.permission,
        sourceText: privateTextSummary(parsed.data.sourceText),
      },
      error: {
        message: "没有可炼化的正文样本",
      },
    });

    return NextResponse.json(
      { error: "没有可炼化的正文样本，请先粘贴可见片段。" },
      { status: 422 },
    );
  }

  try {
    const normalizedUrl = extractFirstUrl(parsed.data.sourceUrl);
    const publicTitle = await readPublicTitle(normalizedUrl);
    const analysis = buildAnalysis({ ...parsed.data, sourceUrl: normalizedUrl }, publicTitle);
    const endedAt = new Date();

    await logCallEvent({
      callId,
      event: "analyze.completed",
      route: "/api/analyze",
      ok: true,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        rawSourceUrl: parsed.data.sourceUrl,
        sourceUrl: normalizedUrl,
        permission: parsed.data.permission,
        sourceText: privateTextSummary(parsed.data.sourceText),
      },
      response: {
        analysisId: analysis.id,
        title: analysis.source.title,
        sourceType: analysis.source.sourceType,
        publicOnly: analysis.source.publicOnly,
        characters: analysis.story.characters,
        hooks: analysis.story.unresolvedHooks,
        styleSummary: analysis.styleSkill.summary,
        stylePrompt: analysis.styleSkill.prompt,
        corpusPlan: analysis.corpusPlan,
      },
      meta: {
        publicTitle,
      },
    });

    return NextResponse.json(analysis);
  } catch (error) {
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "analyze.failed",
      route: "/api/analyze",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: {
        rawSourceUrl: parsed.data.sourceUrl,
        sourceUrl: extractFirstUrl(parsed.data.sourceUrl),
        permission: parsed.data.permission,
        sourceText: privateTextSummary(parsed.data.sourceText),
      },
      error: safeError(error),
    });

    return NextResponse.json({ error: "分析失败" }, { status: 500 });
  }
}
