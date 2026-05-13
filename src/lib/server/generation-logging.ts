import type { GenerateRequest, GenerationMode } from "@/lib/types";
import { privateTextSummary, PROMPT_VERSION, textSummary } from "@/lib/server/call-logger";

type PromptMessage = {
  content: string;
};

export function buildGenerateRequestLog(payload: GenerateRequest, generationMode: GenerationMode) {
  return {
    analysisId: payload.analysis.id,
    sourceTitle: payload.analysis.source.title,
    sourcePermission: payload.analysis.source.permission,
    sourceText: privateTextSummary(payload.sourceText),
    selectedArc: payload.selectedArc,
    generationMode,
    length: payload.length,
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
}

export function buildGeneratePromptLog(payload: GenerateRequest, promptMessages: PromptMessage[]) {
  return {
    version: PROMPT_VERSION,
    system: promptMessages[0].content,
    userTemplate:
      "作品标题、剧情前提、人物、未解钩子、文风节奏、当前文风、文风协作提示、情节方向、篇幅要求、用户片段摘要。",
    userSourceText: privateTextSummary(payload.sourceText),
    userRedacted: payload.sourceText
      ? promptMessages[1].content.replace(
          payload.sourceText,
          `[USER_SOURCE_TEXT_REDACTED:${privateTextSummary(payload.sourceText).hash}]`,
        )
      : promptMessages[1].content,
  };
}
