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
  permission: z.enum(["public", "self_owned", "authorized"]).default("public"),
});

const sampleHooks = [
  "主角已经做出选择，但代价还没有真正落下。",
  "一个被轻描淡写带过的人物，明显藏着下一段剧情的钥匙。",
  "叙事里反复出现的物件还没有兑现，它适合成为转折机关。",
];

const mockCorpus = [
  { title: "雨夜便利店的第七次停电", publishedAt: "2026-04-28", lengthClass: "long" as const },
  { title: "我在知乎写悬疑故事踩过的三个坑", publishedAt: "2026-04-02", lengthClass: "short" as const },
  { title: "那把伞后来去了哪里", publishedAt: "2026-03-18", lengthClass: "long" as const },
  { title: "短篇：别在凌晨四点回头", publishedAt: "2026-02-20", lengthClass: "short" as const },
  { title: "桥、旧书店和一个不肯收尾的人", publishedAt: "2025-12-11", lengthClass: "long" as const },
  { title: "写故事时我为什么喜欢留一个空门", publishedAt: "2025-09-05", lengthClass: "short" as const },
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

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: {
      title,
      author: isZhihu ? "知乎作者（待授权确认）" : "用户提供文本",
      sourceType: hasUrl ? "知乎链接 / 公开元信息" : "用户上传草稿",
      publicOnly: input.permission === "public",
      sourceNote:
        input.permission === "public"
          ? "仅使用公开可访问信息与用户粘贴片段，不读取隐藏付费正文。"
          : "用户声明拥有文本使用权或已获得授权，可用于风格分析与续写。",
      permission: input.permission,
    },
    styleProfile: {
      id: "analyzed-author-style",
      label: "作者近作炼化",
      source: "analysis",
      summary: "近期样本权重更高，长短文各半，提取节奏、转场、口头禅和禁区。",
      prompt:
        "参考作者公开近作的节奏、转场、冲突组织和收尾习惯；不要复制句子，不要冒充作者本人，不要复现隐藏付费正文。",
    },
    corpusPlan: {
      strategy:
        "按时间衰减抽样：近 60 天权重最高，长文与短文各占约一半；样本只用于归纳叙事功能，不保存原文全文。",
      samples: mockCorpus.map((item, index) => ({
        id: `sample-${index + 1}`,
        ...item,
        recencyWeight: Number((1 - index * 0.12).toFixed(2)),
        selected: index < 4,
      })),
    },
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
      rhythm: ["短句推进悬念", "中段用细节停顿", "结尾留下可续写钩子"],
      diction: ["日常口语", "轻微荒诞", "克制吐槽", "知乎式解释补刀"],
      plotMoves: ["伏笔回收", "视角错位", "题材互转", "看似跑偏但服务主线的反转"],
      avoid: ["复现大段原文", "声称原作者授权", "绕过付费墙", "生成可混淆为原作的新章节"],
      prompt:
        "你是续写协作编辑。请学习节奏、叙事功能和结构偏好，不要模仿受保护文本的独特表达，不要声称自己是原作者。",
    },
    guardrails: {
      status: input.permission === "public" ? "needs_review" : "ready",
      notices: [
        "输出默认标识为 AI 辅助创作。",
        "公开链接只抽取标题、简介和用户可合法提供的片段。",
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
