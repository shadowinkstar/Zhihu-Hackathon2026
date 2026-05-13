import type { GenerateRequest } from "@/lib/types";

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

function lengthGuide(length: GenerateRequest["length"]) {
  return {
    short: "短篇体量：通常用几个自然段完成一个清晰场景、一次转折或一个悬念推进。按剧情密度自然收放，不机械凑段落，不逐字计算字符数。",
    medium: "标准续写体量：通常用若干自然段完成铺垫、推进、转折和新的余味。以阅读节奏和叙事完整度为准，不追求固定字数。",
    long: "长篇体量：可以展开多轮冲突、人物反应和伏笔回收，让读者感觉读到一段完整续章。篇幅可随素材复杂度浮动，不做精确字数核算。",
  }[length];
}

function workflowGuide(payload: GenerateRequest) {
  if (payload.generationMode === "expert") {
    return [
      "专家模式内部工作流（仅用于生成，不输出这些过程）：",
      "1. 边界审读：确认用户片段、公开信息和不可触碰的隐藏/付费正文边界。",
      "2. 续写诊断：提炼断口处最该延续的读者期待、人物动机、冲突压力和未解伏笔。",
      "3. 大纲设计：先拟定一个简洁续写大纲，包含开场承接、关键转折、情绪变化、伏笔处理和结尾钩子。",
      "4. 起草正文：按大纲写成自然中文叙事，优先保证人物行为可信、场景推进顺畅、文风与用户选择一致。",
      "5. 编辑校对：检查连续性、重复表达、节奏拖沓、口吻漂移、过度解释和版权风险，必要时重写问题段落。",
      "6. 终稿输出：只交付校对后的续写正文，保留继续编辑和继续连载的空间。",
    ].join("\n");
  }

  return [
    "快速模式内部工作流（仅用于生成，不输出这些过程）：",
    "先抓住断口、人物和钩子，再直接写出一版可编辑的原创续写正文。",
  ].join("\n");
}

export function buildMessages(payload: GenerateRequest): ChatMessage[] {
  const { analysis } = payload;
  const styleProfile = payload.styleProfile || {
    label: "自然续写",
    summary: "只保持剧情连贯，不额外套用文风。",
    prompt: "保持剧情连贯、语言自然，不模仿任何特定作者。",
  };
  const thinkingGuide =
    payload.thinkingEnabled === false
      ? "模型思考关闭：直接生成正文，减少推理展开。"
      : "模型思考开启：先判断文风、剧情钩子与安全边界，再生成正文。";

  return [
    {
      role: "system",
      content: `${styleProfile.prompt}

版权边界：
- 不冒充原作者。
- 不复现用户未提供或无权使用的付费正文。
- 输出必须是“受启发的原创续写草稿”。
- 不输出标题、Markdown 分隔线、解释说明或编辑注释，只输出正文。
- ${thinkingGuide}

${workflowGuide(payload)}`,
    },
    {
      role: "user",
      content: `作品标题：${analysis.source.title}
剧情前提：${analysis.story.premise}
人物：${analysis.story.characters.join("、")}
未解钩子：${analysis.story.unresolvedHooks.join("；")}
文风节奏：${analysis.styleSkill.rhythm.join("；")}
当前文风：${styleProfile.label}。${styleProfile.summary}
文风协作提示：${styleProfile.prompt}
情节方向：${payload.selectedArc}
篇幅要求：${lengthGuide(payload.length)}
用户提供片段：
${payload.sourceText || "未提供正文片段，请只基于公开元信息与结构化设定续写。"}

请生成中文续写正文。篇幅按上面的体量目标自然接近即可，不要为了命中数字而数段落或统计字数；保留可继续编辑的余地。`,
    },
  ];
}

export function buildClaudeMessages(payload: GenerateRequest) {
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

export function maxTokensFor(provider: "openai" | "anthropic", length: GenerateRequest["length"]) {
  if (provider === "anthropic") {
    return length === "long" ? 3200 : length === "medium" ? 2200 : 1400;
  }

  return length === "long" ? 1200 : length === "medium" ? 780 : 420;
}
