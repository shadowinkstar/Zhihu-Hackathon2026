import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/lib/server/invite-store";
import type { ContinuationResult, GenerateRequest } from "@/lib/types";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  privateTextSummary,
  safeError,
  textSummary,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

const generateSchema: z.ZodType<GenerateRequest> = z.object({
  analysis: z.any(),
  sourceText: z.string().optional(),
  selectedArc: z.string(),
  styleProfile: z
    .object({
      id: z.string(),
      label: z.string(),
      summary: z.string(),
      prompt: z.string(),
      source: z.enum(["builtin", "analysis", "neutral"]),
    })
    .optional(),
  length: z.enum(["short", "medium", "long"]),
  styleIntensity: z.number().min(0).max(100),
  access: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("invite"),
      inviteCode: z.string().min(1),
    }),
    z.object({
      mode: z.literal("custom"),
      endpoint: z.string().url(),
      apiKey: z.string().min(1),
      model: z.string().min(1),
    }),
  ]),
});

function buildMessages(payload: GenerateRequest) {
  const { analysis } = payload;
  const styleProfile = payload.styleProfile || analysis.styleProfile || {
    label: "自然续写",
    summary: "只保持剧情连贯，不额外套用文风。",
    prompt: "保持剧情连贯、语言自然，不模仿任何特定作者。",
  };
  const lengthGuide = {
    short: "短篇，写满 6 段，每段至少 2 句、70-110 个中文字符，总长约 500-800 个中文字符，不要提前收束。",
    medium: "中篇，写 8 段，每段 80-130 个中文字符，总长约 900-1400 个中文字符。",
    long: "长篇，写 10-12 段，每段 120-180 个中文字符，总长约 1600-2400 个中文字符。",
  }[payload.length];
  const styleGuide =
    payload.styleIntensity >= 70
      ? "风格强度较高：明显参考节奏、转场和叙事结构，但不要复刻原文句子。"
      : payload.styleIntensity >= 35
        ? "风格强度中等：参考叙事节奏和人物动机，表达保持自然。"
        : "风格强度较低：只使用剧情结构，不刻意贴近原文口吻。";

  return [
    {
      role: "system",
      content: `${styleProfile.prompt}

版权边界：
- 不冒充原作者。
- 不复现用户未提供或无权使用的付费正文。
- 输出必须是“受启发的原创续写草稿”。
- 不输出标题、Markdown 分隔线、解释说明或编辑注释，只输出正文。`,
    },
    {
      role: "user",
      content: `作品标题：${analysis.source.title}
剧情前提：${analysis.story.premise}
人物：${analysis.story.characters.join("、")}
未解钩子：${analysis.story.unresolvedHooks.join("；")}
文风节奏：${analysis.styleSkill.rhythm.join("；")}
当前文风：${styleProfile.label}。${styleProfile.summary}
情节方向：${payload.selectedArc}
篇幅要求：${lengthGuide}
文风强度：${payload.styleIntensity}/100
风格策略：${styleGuide}
用户提供片段：
${payload.sourceText || "未提供正文片段，请只基于公开元信息与结构化设定续写。"}

请严格按篇幅要求生成中文续写正文，保留可继续编辑的余地。`,
    },
  ];
}

function buildClaudeMessages(payload: GenerateRequest) {
  const [systemMessage, userMessage] = buildMessages(payload);

  return {
    system: systemMessage.content,
    messages: [
      {
        role: "user",
        content: userMessage.content,
      },
    ],
  };
}

function maxTokensFor(provider: "openai" | "anthropic", length: GenerateRequest["length"]) {
  if (provider === "anthropic") {
    return length === "long" ? 3200 : length === "medium" ? 2200 : 1400;
  }

  return length === "long" ? 1200 : length === "medium" ? 780 : 420;
}

type ModelCallResult = {
  text?: string;
  usage?: unknown;
  stopReason?: string;
  finishReason?: string;
  responseId?: string;
  contentTypes?: string[];
  thinkingDisabled?: boolean;
};

async function callOpenAICompatible(payload: GenerateRequest, endpoint: string, apiKey: string, model: string) {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(payload),
      temperature: 0.82,
      max_tokens: maxTokensFor("openai", payload.length),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `模型接口返回 ${response.status}`);
  }

  const data = await response.json();
  return {
    text: data.choices?.[0]?.message?.content?.trim(),
    usage: data.usage,
    finishReason: data.choices?.[0]?.finish_reason,
    responseId: data.id,
  } satisfies ModelCallResult;
}

async function callAnthropicCompatible(payload: GenerateRequest, endpoint: string, apiKey: string, model: string) {
  const { system, messages } = buildClaudeMessages(payload);
  const target = `${endpoint.replace(/\/$/, "")}/v1/messages`;
  const requestBody = (disableThinking: boolean) =>
    JSON.stringify({
      model,
      system,
      messages,
      temperature: 0.82,
      max_tokens: maxTokensFor("anthropic", payload.length),
      ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
    });
  let thinkingDisabled = true;
  let response = await fetch(target, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: requestBody(true),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 400 && /thinking|extra|unknown|disabled/i.test(errorText)) {
      thinkingDisabled = false;
      response = await fetch(target, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: requestBody(false),
      });
    }

    if (!response.ok) {
      const retryErrorText = await response.text();
      throw new Error(retryErrorText || errorText || `Claude 接口返回 ${response.status}`);
    }
  }

  const data = await response.json();
  const textBlocks = Array.isArray(data.content)
    ? data.content
        .filter((block: { type?: string; text?: string }) => block.type === "text" && block.text)
        .map((block: { text: string }) => block.text)
    : [];

  return {
    text: textBlocks.join("\n").trim() || undefined,
    usage: data.usage,
    stopReason: data.stop_reason,
    responseId: data.id,
    contentTypes: Array.isArray(data.content)
      ? data.content.map((block: { type?: string }) => block.type || "unknown")
      : [],
    thinkingDisabled,
  } satisfies ModelCallResult;
}

function mockContinuation(payload: GenerateRequest): string {
  const { analysis, selectedArc, styleIntensity } = payload;
  const protagonist = analysis.story.characters[0] || "叙述者";
  const hook = analysis.story.unresolvedHooks[0];
  const styleHint =
    styleIntensity > 70
      ? "句子故意压得很短，像有人在门外敲了三下。"
      : "叙述保持平稳，把荒诞藏在正常语气下面。";

  return `【AI 续写草稿｜方向：${selectedArc}】

${protagonist}后来承认，事情真正变坏不是从那个夜晚开始的，而是从他第一次假装没看见开始的。桌上的杯子还冒着热气，屏幕里那篇文章停在半截，像一扇只开了十厘米的门。${styleHint}

他把页面往下滑，当然什么也没有。剩下的部分被整齐地藏在系统提示后面，仿佛故事也学会了收费。可问题在于，人物并不会因为按钮变灰就停止行动。那个被一笔带过的人名又出现了，这次是在楼下便利店的小票背面，笔迹歪斜，只有一句话：别让结尾替你做决定。

于是续写人接过了这条线。他没有去猜原作者原本想写什么，只把已经露出来的线索重新摆好：一个犹豫的人，一个失约的夜晚，一个还没有兑现的物件，以及${hook}。这些东西互相看了一眼，像会议室里没人愿意第一个发言。

真正的转折发生在最后五分钟。${protagonist}终于意识到，所谓狗尾续貂不是把别人的故事补完整，而是在断口处承认断口，然后从那里长出一截新的东西。它未必高明，但它诚实地标着来源、边界和手上的泥。`;
}

function buildResult(
  payload: GenerateRequest,
  continuation: string,
  provider: ContinuationResult["usage"]["provider"],
  quotaRemaining?: number,
  model?: string,
): ContinuationResult {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: `${payload.analysis.source.title}：${payload.selectedArc}`,
    continuation,
    editorNotes: [
      "已避免复现原文句式和隐藏付费正文。",
      "建议发布时保留 AI 辅助创作声明与原文跳转。",
      "可继续调整伏笔回收，或导出风格协作说明。",
    ],
    usage: {
      provider,
      quotaRemaining,
      model,
    },
  };
}

export async function POST(request: Request) {
  const startedAt = new Date();
  const callId = newCallId("generate");
  const parsed = generateSchema.safeParse(await request.json());

  if (!parsed.success) {
    await logCallEvent({
      callId,
      event: "generate.validation_failed",
      route: "/api/generate",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      error: parsed.error.flatten(),
    });

    return NextResponse.json(
      { error: "生成参数不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const promptMessages = buildMessages(payload);
  const requestLog = {
    analysisId: payload.analysis.id,
    sourceTitle: payload.analysis.source.title,
    sourcePermission: payload.analysis.source.permission,
    sourceText: privateTextSummary(payload.sourceText),
    selectedArc: payload.selectedArc,
    length: payload.length,
    styleIntensity: payload.styleIntensity,
    styleProfile: payload.styleProfile
      ? {
          id: payload.styleProfile.id,
          label: payload.styleProfile.label,
          source: payload.styleProfile.source,
        }
      : null,
    access:
      payload.access.mode === "invite"
        ? {
            mode: "invite",
            inviteCodeHash: textSummary(payload.access.inviteCode).hash,
          }
        : {
            mode: "custom",
            endpoint: payload.access.endpoint,
            model: payload.access.model,
            apiKeyPresent: Boolean(payload.access.apiKey),
          },
  };
  const promptLog = {
    version: PROMPT_VERSION,
    system: promptMessages[0].content,
    userTemplate:
      "作品标题、剧情前提、人物、未解钩子、文风节奏、当前文风、情节方向、篇幅要求、文风强度、用户片段摘要。",
    userSourceText: privateTextSummary(payload.sourceText),
    userRedacted: payload.sourceText
      ? promptMessages[1].content.replace(
          payload.sourceText,
          `[USER_SOURCE_TEXT_REDACTED:${privateTextSummary(payload.sourceText).hash}]`,
        )
      : promptMessages[1].content,
  };

  try {
    if (payload.access.mode === "custom") {
      const modelStartedAt = Date.now();
      let modelResult: ModelCallResult;

      try {
        modelResult = await callOpenAICompatible(
          payload,
          payload.access.endpoint,
          payload.access.apiKey,
          payload.access.model,
        );
        const continuation = modelResult.text;
        await logCallEvent({
          callId,
          event: continuation ? "model.completed" : "model.empty_response",
          route: "/api/generate",
          ok: Boolean(continuation),
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "custom-openai-compatible",
          model: payload.access.model,
          request: requestLog,
          prompts: promptLog,
          response: {
            output: continuation,
            outputSummary: textSummary(continuation),
            usage: modelResult.usage,
            finishReason: modelResult.finishReason,
            responseId: modelResult.responseId,
          },
        });
      } catch (error) {
        await logCallEvent({
          callId,
          event: "model.failed",
          route: "/api/generate",
          ok: false,
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "custom-openai-compatible",
          model: payload.access.model,
          request: requestLog,
          prompts: promptLog,
          error: safeError(error),
        });
        throw error;
      }

      const continuation = modelResult.text;
      if (!continuation) {
        throw new Error("模型没有返回续写内容");
      }

      const result = buildResult(payload, continuation, "custom-openai-compatible", undefined, payload.access.model);
      const endedAt = new Date();

      await logCallEvent({
        callId,
        event: "generate.completed",
        route: "/api/generate",
        ok: true,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        promptVersion: PROMPT_VERSION,
        provider: "custom-openai-compatible",
        model: payload.access.model,
        request: requestLog,
        prompts: promptLog,
        response: result,
      });

      return NextResponse.json(result);
    }

    const invite = await redeemInvite(payload.access.inviteCode, true);
    if (!invite.ok) {
      await logCallEvent({
        callId,
        event: "generate.invite_rejected",
        route: "/api/generate",
        ok: false,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        promptVersion: PROMPT_VERSION,
        request: requestLog,
        error: {
          reason: invite.reason,
        },
      });
      return NextResponse.json({ error: invite.reason }, { status: 403 });
    }

    const internalEndpoint = process.env.INTERNAL_MODEL_ENDPOINT;
    const internalApiKey = process.env.INTERNAL_MODEL_API_KEY;
    const internalModel = process.env.INTERNAL_MODEL_NAME || "gouwei-internal";
    const anthropicEndpoint = process.env.ANTHROPIC_BASE_URL;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
    const anthropicModel =
      process.env.ANTHROPIC_MODEL ||
      process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
      process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
      "claude-sonnet-4-5";

    if (anthropicEndpoint && anthropicApiKey) {
      const modelStartedAt = Date.now();
      try {
        const modelResult = await callAnthropicCompatible(
          payload,
          anthropicEndpoint,
          anthropicApiKey,
          anthropicModel,
        );
        const continuation = modelResult.text;
        await logCallEvent({
          callId,
          event: continuation ? "model.completed" : "model.empty_response",
          route: "/api/generate",
          ok: Boolean(continuation),
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "anthropic-compatible",
          model: anthropicModel,
          request: requestLog,
          prompts: promptLog,
          response: {
            output: continuation,
            outputSummary: textSummary(continuation),
            usage: modelResult.usage,
            stopReason: modelResult.stopReason,
            responseId: modelResult.responseId,
            contentTypes: modelResult.contentTypes,
            thinkingDisabled: modelResult.thinkingDisabled,
            note: continuation
              ? undefined
              : "Model returned no text blocks. This often means the token budget was spent on reasoning/thinking blocks.",
          },
        });
        if (continuation) {
          const result = buildResult(payload, continuation, "internal-model", invite.remaining, anthropicModel);
          const endedAt = new Date();
          await logCallEvent({
            callId,
            event: "generate.completed",
            route: "/api/generate",
            ok: true,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: endedAt.getTime() - startedAt.getTime(),
            promptVersion: PROMPT_VERSION,
            provider: "anthropic-compatible",
            model: anthropicModel,
            request: requestLog,
            prompts: promptLog,
            response: result,
            meta: {
              inviteRemaining: invite.remaining,
            },
          });
          return NextResponse.json(
            result,
          );
        }
      } catch (error) {
        await logCallEvent({
          callId,
          event: "model.failed",
          route: "/api/generate",
          ok: false,
          durationMs: Date.now() - modelStartedAt,
          promptVersion: PROMPT_VERSION,
          provider: "anthropic-compatible",
          model: anthropicModel,
          request: requestLog,
          prompts: promptLog,
          error: safeError(error),
          meta: {
            fallback: "demo-or-openai-compatible",
          },
        });
        console.warn("Claude-compatible model call failed; falling back to demo text.", error);
      }
    }

    if (internalEndpoint && internalApiKey) {
      const modelStartedAt = Date.now();
      const modelResult = await callOpenAICompatible(
        payload,
        internalEndpoint,
        internalApiKey,
        internalModel,
      );
      const continuation = modelResult.text;
      const result = buildResult(payload, continuation || mockContinuation(payload), "internal-model", invite.remaining, internalModel);
      const endedAt = new Date();
      await logCallEvent({
        callId,
        event: continuation ? "model.completed" : "model.empty_response",
        route: "/api/generate",
        ok: Boolean(continuation),
        durationMs: Date.now() - modelStartedAt,
        promptVersion: PROMPT_VERSION,
        provider: "internal-openai-compatible",
        model: internalModel,
        request: requestLog,
        prompts: promptLog,
        response: {
          output: continuation,
          outputSummary: textSummary(continuation),
          usage: modelResult.usage,
          finishReason: modelResult.finishReason,
          responseId: modelResult.responseId,
        },
      });
      await logCallEvent({
        callId,
        event: "generate.completed",
        route: "/api/generate",
        ok: true,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        promptVersion: PROMPT_VERSION,
        provider: "internal-openai-compatible",
        model: internalModel,
        request: requestLog,
        prompts: promptLog,
        response: result,
        meta: {
          inviteRemaining: invite.remaining,
        },
      });
      return NextResponse.json(
        result,
      );
    }

    const mock = mockContinuation(payload);
    const result = buildResult(payload, mock, "demo-invite", invite.remaining);
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "generate.completed",
      route: "/api/generate",
      ok: true,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      provider: "demo-invite",
      model: "mock",
      request: requestLog,
      prompts: promptLog,
      response: result,
      meta: {
        inviteRemaining: invite.remaining,
      },
    });

    return NextResponse.json(
      result,
    );
  } catch (error) {
    const endedAt = new Date();
    await logCallEvent({
      callId,
      event: "generate.failed",
      route: "/api/generate",
      ok: false,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      promptVersion: PROMPT_VERSION,
      request: requestLog,
      prompts: promptLog,
      error: safeError(error),
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "生成失败",
      },
      { status: 502 },
    );
  }
}
