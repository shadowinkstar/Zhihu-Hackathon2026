import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { NarrativeAnalysis, StyleProfile } from "@/lib/types";
import { requireUser } from "@/lib/server/auth";
import {
  getClaudeCodeDaemon,
  shouldTryClaudeCode,
} from "@/lib/server/claude-code-daemon";
import { safeError } from "@/lib/server/call-logger";
import { saveUserStyle } from "@/lib/server/user-store";

export const runtime = "nodejs";

const materialSchema = z.object({
  id: z.string(),
  title: z.string().trim().default("未命名材料"),
  content: z.string().trim().min(20, "材料正文太短"),
  sourceType: z.enum(["text", "skill", "search", "web"]).default("text"),
  sourceRef: z.string().trim().optional(),
});

const requestSchema = z.object({
  materials: z.array(materialSchema).min(1, "请至少上传一条材料"),
  targetName: z.string().trim().optional(),
});

type ClaudeStyleJson = {
  label?: string;
  summary?: string;
  dimensions?: string[];
  rhythm?: string[];
  diction?: string[];
  plotMoves?: string[];
  avoid?: string[];
  prompt?: string;
  premise?: string;
  characters?: string[];
  hooks?: string[];
};

type StreamEvent =
  | { type: "log"; title: string; detail?: string; status?: "running" | "done" | "error" | "info" }
  | { type: "analysis"; analysis: NarrativeAnalysis };

function compact(value: string, maxLength = 2400) {
  const trimmed = value.replace(/\s+\n/g, "\n").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}\n[材料已截断]` : trimmed;
}

function extractJson(text: string): ClaudeStyleJson {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("Claude Code 没有返回可解析的文风 JSON");
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as ClaudeStyleJson;
}

function uniqueList(values: unknown, fallback: string[]) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const normalized = values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 8);

  return normalized.length ? Array.from(new Set(normalized)) : fallback;
}

function buildPrompt(input: z.infer<typeof requestSchema>) {
  const materials = input.materials
    .map(
      (material, index) =>
        `材料 ${index + 1}
标题：${material.title || `材料 ${index + 1}`}
来源类型：${material.sourceType}
来源：${material.sourceRef || "用户粘贴"}
正文：
${compact(material.content)}`,
    )
    .join("\n\n---\n\n");

  return [
    "你正在为“狗尾续貂？”产品执行文风炼化。你的任务是读取用户上传的多篇材料，生成一个可复用的文风 Skill。",
    "可以使用 WebSearch / WebFetch 只查询公开资料来辅助确认作者、角色、作品背景或外部 Skill 说明；禁止绕过登录、付费墙或读取用户无权访问的内容。",
    "重要边界：只总结节奏、叙事功能、措辞倾向、桥段偏好和避让规则；不要复刻原句，不要冒充真实作者，不要输出可混淆为原作的说明。",
    "用户可能上传外部 Skill 内容、公开搜索摘录或多篇文章片段。请优先综合多材料之间稳定出现的特征，弱相关材料要降权。",
    "",
    "最终只输出 JSON，不要 Markdown，不要解释。JSON 结构：",
    JSON.stringify(
      {
        label: "不超过 12 字的文风名称",
        summary: "一句话说明该文风怎么写",
        dimensions: ["3-6 个文风维度"],
        rhythm: ["节奏规则"],
        diction: ["措辞规则"],
        plotMoves: ["常用叙事动作"],
        avoid: ["需要避开的风险"],
        prompt: "给续写模型使用的文风协作提示",
        premise: "这些材料适合支持的续写前提",
        characters: ["可抽象迁移的人物关系或叙述角色"],
        hooks: ["适合延展的钩子"],
      },
      null,
      2,
    ),
    "",
    `目标名称：${input.targetName || "由材料自动命名"}`,
    "",
    materials,
  ].join("\n");
}

function buildAnalysis(
  input: z.infer<typeof requestSchema>,
  refined: ClaudeStyleJson,
  model: string,
): NarrativeAnalysis {
  const sourceText = input.materials.map((material) => material.content).join("\n\n");
  const title = input.targetName || refined.label || "Claude 炼化文风";
  const label = input.targetName || refined.label || title;
  const dimensions = uniqueList(refined.dimensions, ["Claude 炼化", "多材料归纳", "原创续写边界"]);
  const styleProfile: StyleProfile = {
    id: `claude-style-${Date.now()}`,
    label: label.trim(),
    source: "analysis",
    summary: refined.summary?.trim() || "已由 Claude Code 从多篇材料中炼化出可复用文风。",
    prompt:
      refined.prompt?.trim() ||
      "学习材料中的节奏、叙事功能和措辞倾向，不复制原句，不冒充真实作者，输出原创续写草稿。",
    provenance: `Claude Code 炼化：${input.materials.length} 条材料，模型 ${model}`,
    dimensions,
  };

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: {
      title,
      author: "用户材料集合",
      sourceType: "多材料文风炼化",
      publicOnly: true,
      sourceNote: "由用户上传材料、外部 Skill 内容或公开搜索候选组成。",
      permission: "public",
    },
    styleProfile,
    corpusPlan: {
      strategy: "按材料分条读取，优先提取跨材料稳定特征；低相关或来源不清的内容只作参考。",
      samples: input.materials.map((material, index) => ({
        id: material.id || `style-material-${index + 1}`,
        title: material.title || `材料 ${index + 1}`,
        publishedAt: new Date(Date.now() - index * 86400000).toISOString().slice(0, 10),
        lengthClass: material.content.length >= 300 ? "long" : "short",
        recencyWeight: Number(Math.max(0.35, 1 - index * 0.08).toFixed(2)),
        selected: true,
      })),
    },
    story: {
      premise: refined.premise || "这些材料适合为续写提供口吻、节奏和叙事动作参考。",
      characters: uniqueList(refined.characters, ["叙述者", "被观察者", "关系中的另一方"]).slice(0, 5),
      unresolvedHooks: uniqueList(refined.hooks, [
        "材料里的稳定情绪还可以继续推进。",
        "人物关系可以通过细节和反差继续展开。",
        "叙述节奏可以在段尾保留余味。",
      ]),
      continuityRules: [
        "学习文风功能，不复制材料原句。",
        "不冒充真实作者、角色或原作续章。",
        "只使用用户上传内容和公开可访问资料。",
      ],
    },
    styleSkill: {
      name: `${styleProfile.label}.skill`,
      version: "0.1.0",
      summary: styleProfile.summary,
      rhythm: uniqueList(refined.rhythm, ["段落节奏稳定", "转折前留停顿", "段尾回收情绪"]),
      diction: uniqueList(refined.diction, ["具体名词优先", "少解释多呈现", "避免空泛修辞"]),
      plotMoves: uniqueList(refined.plotMoves, ["细节铺垫", "关系反差", "段尾留钩"]),
      avoid: uniqueList(refined.avoid, ["复现原文句式", "冒充原作者", "绕过付费或登录内容"]),
      prompt: styleProfile.prompt,
    },
    guardrails: {
      status: sourceText.length >= 120 ? "ready" : "needs_review",
      notices: [
        "文风 Skill 由 Claude Code 从多材料中生成。",
        "建议上传 3 条以上材料提升稳定性。",
        "外部 Skill 和公开搜索结果需要人工确认来源可信度。",
      ],
    },
  };
}

export async function POST(request: NextRequest) {
  const session = await requireUser(request);
  if (!session) {
    return NextResponse.json({ error: "请先使用知乎登录后再生成个人文风" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "文风材料格式不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!shouldTryClaudeCode()) {
    return NextResponse.json({ error: "Claude Code 未启用，无法炼化文风" }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const input = parsed.data;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const writeEvent = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const writeLog = (
        title: string,
        detail?: string,
        status: Extract<StreamEvent, { type: "log" }>["status"] = "info",
      ) => {
        writeEvent({ type: "log", title, detail, status });
      };

      try {
        const totalChars = input.materials.reduce(
          (sum, material) => sum + material.content.length,
          0,
        );
        writeLog(
          "读取炼化材料",
          `${input.materials.length} 条材料，约 ${totalChars} 字符。`,
          "done",
        );
        writeLog(
          "启动 Claude Code",
          input.targetName ? `目标文风：${input.targetName}` : "由材料自动命名。",
          "running",
        );

        const result = await getClaudeCodeDaemon(true, "expert").runPrompt(buildPrompt(input), {
          mode: "expert",
          onLog: writeLog,
        });

        writeLog("解析文风 Skill", "正在校验 Claude Code 返回的结构化结果。", "running");
        const refined = extractJson(result.text);
        const analysis = buildAnalysis(input, refined, result.model);
        await saveUserStyle(session.user.id, analysis.styleProfile);
        writeLog(
          "生成文风 Skill",
          `${analysis.styleProfile.label} · ${analysis.styleSkill.rhythm.length} 条节奏规则。`,
          "done",
        );
        writeEvent({ type: "analysis", analysis });
        writeLog("写入文风管理", "已加入右侧已有文风，可立即用于续写。", "done");
      } catch (error) {
        writeLog(
          "文风炼化失败",
          safeError(error).message || "Claude Code 文风炼化失败",
          "error",
        );
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
