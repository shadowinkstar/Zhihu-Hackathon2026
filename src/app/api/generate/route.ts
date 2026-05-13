import { NextResponse } from "next/server";
import { redeemInvite } from "@/lib/server/invite-store";
import type { GenerateRequest } from "@/lib/types";
import {
  buildGeneratePromptLog,
  buildGenerateRequestLog,
} from "@/lib/server/generation-logging";
import {
  buildClaudeMessages,
  buildMessages,
  maxTokensFor,
} from "@/lib/server/generation-prompts";
import { generateSchema, generationModeFor } from "@/lib/server/generate-schema";
import {
  buildContinuationResult,
  mockContinuation,
} from "@/lib/server/generation-common";
import {
  logCallEvent,
  newCallId,
  PROMPT_VERSION,
  safeError,
  textSummary,
} from "@/lib/server/call-logger";

export const runtime = "nodejs";

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
  const generationMode = generationModeFor(payload);
  const promptMessages = buildMessages(payload);
  const requestLog = buildGenerateRequestLog(payload, generationMode);
  const promptLog = buildGeneratePromptLog(payload, promptMessages);

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

      const result = buildContinuationResult(
        payload,
        continuation,
        "custom-openai-compatible",
        undefined,
        payload.access.model,
        generationMode,
      );
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
          const result = buildContinuationResult(
            payload,
            continuation,
            "internal-model",
            invite.remaining,
            anthropicModel,
            generationMode,
          );
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
          return NextResponse.json(result);
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
      const result = buildContinuationResult(
        payload,
        continuation || mockContinuation(payload),
        "internal-model",
        invite.remaining,
        internalModel,
        generationMode,
      );
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
      return NextResponse.json(result);
    }

    const mock = mockContinuation(payload);
    const result = buildContinuationResult(payload, mock, "demo-invite", invite.remaining, undefined, generationMode);
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

    return NextResponse.json(result);
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
