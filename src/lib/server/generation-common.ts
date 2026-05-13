import type { ContinuationResult, GenerateRequest, GenerationMode } from "@/lib/types";

export function mockContinuation(payload: GenerateRequest): string {
  const { analysis, selectedArc } = payload;
  const protagonist = analysis.story.characters[0] || "叙述者";
  const hook = analysis.story.unresolvedHooks[0];
  const styleHint = payload.styleProfile?.summary || "叙述保持平稳，把荒诞藏在正常语气下面。";

  return `【AI 续写草稿｜方向：${selectedArc}】

${protagonist}后来承认，事情真正变坏不是从那个夜晚开始的，而是从他第一次假装没看见开始的。桌上的杯子还冒着热气，屏幕里那篇文章停在半截，像一扇只开了十厘米的门。${styleHint}

他把页面往下滑，当然什么也没有。剩下的部分被整齐地藏在系统提示后面，仿佛故事也学会了收费。可问题在于，人物并不会因为按钮变灰就停止行动。那个被一笔带过的人名又出现了，这次是在楼下便利店的小票背面，笔迹歪斜，只有一句话：别让结尾替你做决定。

于是续写人接过了这条线。他没有去猜原作者原本想写什么，只把已经露出来的线索重新摆好：一个犹豫的人，一个失约的夜晚，一个还没有兑现的物件，以及${hook}。这些东西互相看了一眼，像会议室里没人愿意第一个发言。

真正的转折发生在最后五分钟。${protagonist}终于意识到，所谓狗尾续貂不是把别人的故事补完整，而是在断口处承认断口，然后从那里长出一截新的东西。它未必高明，但它诚实地标着来源、边界和手上的泥。`;
}

export function buildContinuationResult(
  payload: GenerateRequest,
  continuation: string,
  provider: ContinuationResult["usage"]["provider"],
  quotaRemaining?: number,
  model?: string,
  mode?: GenerationMode,
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
      mode,
    },
  };
}
