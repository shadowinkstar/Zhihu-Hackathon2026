export type ModelAccessMode = "invite" | "custom";

export type GenerationMode = "quick" | "expert";

export type StyleProfile = {
  id: string;
  label: string;
  summary: string;
  prompt: string;
  source: "preset" | "analysis" | "neutral";
  provenance?: string;
  dimensions?: string[];
};

export type CorpusSample = {
  id: string;
  title: string;
  publishedAt: string;
  lengthClass: "long" | "short";
  recencyWeight: number;
  selected: boolean;
};

export type ArticlePreview = {
  id: string;
  sourceUrl?: string;
  linkKind: "paid_share" | "zhihu_answer" | "zhihu_article" | "unknown";
  status: "public_preview" | "paid_content" | "blocked" | "manual_input";
  title: string;
  author: string;
  previewText: string;
  accessNote: string;
};

export type NarrativeAnalysis = {
  id: string;
  createdAt: string;
  source: {
    title: string;
    author: string;
    sourceType: string;
    publicOnly: boolean;
    sourceNote: string;
    permission: "public";
  };
  styleProfile: StyleProfile;
  corpusPlan: {
    strategy: string;
    samples: CorpusSample[];
  };
  story: {
    premise: string;
    characters: string[];
    unresolvedHooks: string[];
    continuityRules: string[];
  };
  styleSkill: {
    name: string;
    version: string;
    summary: string;
    rhythm: string[];
    diction: string[];
    plotMoves: string[];
    avoid: string[];
    prompt: string;
  };
  guardrails: {
    status: "ready" | "needs_review";
    notices: string[];
  };
};

export type GenerateRequest = {
  analysis: NarrativeAnalysis;
  sourceText?: string;
  selectedArc: string;
  styleProfile?: StyleProfile;
  generationMode?: GenerationMode;
  thinkingEnabled?: boolean;
  length: "short" | "medium" | "long";
  styleIntensity: number;
  access:
    | {
        mode: "invite";
        inviteCode: string;
      }
    | {
        mode: "custom";
        endpoint: string;
        apiKey: string;
        model: string;
      };
};

export type ContinuationResult = {
  id: string;
  createdAt: string;
  title: string;
  continuation: string;
  editorNotes: string[];
  usage: {
    provider: "demo-invite" | "custom-openai-compatible" | "internal-model" | "claude-code";
    mode?: GenerationMode;
    model?: string;
    quotaRemaining?: number;
  };
};
