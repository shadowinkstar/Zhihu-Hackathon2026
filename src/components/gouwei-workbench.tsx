"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  DownloadCloud,
  ExternalLink,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  MessagesSquare,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import type {
  ContinuationResult,
  GenerationMode,
  NarrativeAnalysis,
  StyleProfile,
} from "@/lib/types";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const defaultSourceRef = "";

const neutralStyle: StyleProfile = {
  id: "neutral",
  label: "自然续写",
  source: "neutral",
  summary: "只接剧情，不额外套用文风。",
  prompt: "保持剧情连贯、语言自然，不模仿任何特定作者。",
};

const presetStyles: StyleProfile[] = [
  {
    id: "kimura-police-cut",
    label: "木村上村树",
    source: "preset",
    summary: "日常独白、轻微跑题，最后把线索拐进王警官的扫黄现场。",
    provenance: "系统预设：日常独白、荒诞转场、突兀收束。",
    dimensions: ["日常物件开场", "低烈度独白", "跑题式转场", "扫黄式荒诞收束"],
    prompt:
      "使用虚构的木村上村树式协作风格：平静日常、细节独白、突然离题、荒诞收束；可以把结尾转向王警官扫黄桥段，但不要模仿现实作者的受保护表达。",
  },
  {
    id: "yanxuan-suspense",
    label: "盐选悬疑",
    source: "preset",
    summary: "高密度钩子、短段落反转，每段都推进一个新疑点。",
    provenance: "系统预设：短段落、强钩子、付费断点前置。",
    dimensions: ["短段落", "高频疑点", "旧物回收", "付费断点前置"],
    prompt:
      "使用盐选悬疑式节奏：短段落、强钩子、信息逐层翻转，控制解释比例，每段都推进一个新疑点。",
  },
  {
    id: "zhihu-debater",
    label: "知乎嘴硬大V",
    source: "preset",
    summary: "先下判断，再补论据，偶尔冷幽默拆台。",
    provenance: "系统预设：判断句、论证段、吐槽收束。",
    dimensions: ["先结论", "再证据", "分层解释", "冷幽默补刀"],
    prompt:
      "使用知乎长文辩手式表达：先给判断，再给证据，夹带克制吐槽；保持故事推进，不写成纯议论文。",
  },
  {
    id: "urban-reversal",
    label: "都市反转",
    source: "preset",
    summary: "压迫开局、身份错位，最后一句给爆点。",
    provenance: "系统预设：压迫开局、身份误导、结尾爆点。",
    dimensions: ["压迫开局", "身份错位", "中段误导", "末句爆点"],
    prompt:
      "使用都市反转爽感结构：开局压迫、信息误导、身份错位、结尾爆点；保持原创情节，不套用具体作品。",
  },
  {
    id: "confession-needle",
    label: "情感留刺",
    source: "preset",
    summary: "第一人称回忆、细节递进，结尾留一个扎心钩子。",
    provenance: "系统预设：情感倾诉、回忆递进、克制结尾。",
    dimensions: ["第一人称", "细节递进", "情绪克制", "结尾留刺"],
    prompt:
      "使用情感倾诉式结构：第一人称可感细节、回忆递进、克制表达，结尾留下一个情绪钩子。",
  },
];

const arcs = [
  { id: "付费断口安全续写", label: "断口续写" },
  { id: "盐选题材互转", label: "题材互转" },
];

const generationModes: Array<{ id: GenerationMode; label: string; summary: string }> = [
  { id: "quick", label: "快速", summary: "直接出稿" },
  { id: "expert", label: "专家", summary: "深度推演" },
];

type WorkflowLogItem = {
  title: string;
  detail?: string;
  status: "running" | "done" | "error" | "info";
};

type StreamEvent =
  | { type: "log"; title: string; detail?: string; status?: WorkflowLogItem["status"] }
  | { type: "reasoning"; chunk: string }
  | { type: "text"; chunk: string }
  | { type: "analysis"; analysis: NarrativeAnalysis };

const lengthOptions = [
  { id: "short", label: "短篇" },
  { id: "medium", label: "中篇" },
  { id: "long", label: "长篇" },
] as const;

const styleIntensityForApiCompatibility = 64;

const providerLabel = {
  "demo-invite": "演示",
  "custom-openai-compatible": "自带 API",
  "internal-model": "内置模型",
  "claude-code": "Claude Code",
} satisfies Record<ContinuationResult["usage"]["provider"], string>;

const styleSourceLabel = {
  neutral: "默认",
  analysis: "已分析",
  preset: "预设",
} satisfies Record<StyleProfile["source"], string>;

const editorNotes = [
  "已避免复现原文句式和隐藏付费正文。",
  "建议发布时保留 AI 辅助创作声明与原文跳转。",
  "可继续调整伏笔回收，或导出风格协作说明。",
];

type StyleMaterialMode = "text" | "skill" | "search";

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

type StyleMaterial = {
  id: string;
  title: string;
  content: string;
  sourceType: "text" | "skill" | "search" | "web";
  sourceRef?: string;
  trustNote?: string;
};

type SkillCandidate = {
  id: string;
  title: string;
  source: "clawhub" | "github";
  url: string;
  summary: string;
  trustNote: string;
};

const styleMaterialModes: Array<{
  id: StyleMaterialMode;
  label: string;
  summary: string;
}> = [
  {
    id: "text",
    label: "导入文本",
    summary: "粘贴可见片段、草稿或公开样本，直接炼化成文风 Skill。",
  },
  {
    id: "skill",
    label: "导入 Skill 链接",
    summary: "接入别人已经蒸馏好的角色、作家或人物 Skill。",
  },
  {
    id: "search",
    label: "网络搜索候选",
    summary: "围绕作者、角色或用户检索材料，只采纳高相关结果。",
  },
];

const minimumStyleCount = 3;

const blankStyleMaterial = (): StyleMaterial => ({
  id: crypto.randomUUID(),
  title: "材料 1",
  content: "",
  sourceType: "text",
});

type HackathonStorySummary = {
  workId: string;
  title: string;
  description: string;
  labels: string[];
  artwork?: string;
  tabArtwork?: string;
};

type HackathonStoryDetail = {
  workId: string;
  chapterName: string;
  authorName: string;
  labels: string[];
  introduction: string;
  content: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data as T;
}

async function readResponseError(response: Response) {
  const fallback = response.clone();
  try {
    const data = await response.json();
    return data.error || "请求失败";
  } catch {
    return (await fallback.text()) || "请求失败";
  }
}

function parseQuota(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function providerFromHeader(value: string | null): ContinuationResult["usage"]["provider"] {
  if (
    value === "demo-invite" ||
    value === "custom-openai-compatible" ||
    value === "internal-model" ||
    value === "claude-code"
  ) {
    return value;
  }

  return "claude-code";
}

function WorkflowLogPanel({
  items,
  open,
  onToggle,
  elapsedSeconds,
  streamedChars,
  reasoningText,
  meterText,
}: {
  items: WorkflowLogItem[];
  open: boolean;
  onToggle: (open: boolean) => void;
  elapsedSeconds: number;
  streamedChars: number;
  reasoningText: string;
  meterText?: string;
}) {
  if (!items.length && !open) {
    return null;
  }

  const latest = items.at(-1);

  return (
    <motion.details
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mt-4 rounded-lg border border-white/12 bg-[#201b16] p-4"
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-[#89b5ff]">
              <MessagesSquare className="size-4" aria-hidden="true" />
              智能体工作记录
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#d8cdbc]">
              {latest?.title || "等待开始"}
              {latest?.detail ? `：${latest.detail}` : ""}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded bg-white/10 px-2 py-1 text-xs font-semibold text-[#c9bca8]">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {elapsedSeconds}s
          </span>
        </div>
      </summary>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-[#c9bca8]">
        {meterText ||
          `模型思考开启时会展示推理流；当前推理 ${reasoningText.length} 字，正文 ${streamedChars} 字。`}
      </div>

      {reasoningText ? (
        <div className="mt-3 rounded-md border border-[#89b5ff]/20 bg-[#121a24] p-3">
          <p className="text-xs font-semibold text-[#89b5ff]">实时推理</p>
          <div className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[#d8cdbc]">
            {reasoningText}
          </div>
        </div>
      ) : null}

      <ol className="mt-4 grid gap-2">
        {items.map((item, index) => (
          <li
            key={`${index}-${item.title}`}
            className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2"
          >
            <span className="mt-0.5 flex size-4 items-center justify-center">
              {item.status === "running" ? (
                <Loader2 className="size-4 animate-spin text-[#89b5ff]" aria-hidden="true" />
              ) : item.status === "error" ? (
                <CircleAlert className="size-4 text-[#f4a08f]" aria-hidden="true" />
              ) : item.status === "done" ? (
                <CheckCircle2 className="size-4 text-[#9ad7b2]" aria-hidden="true" />
              ) : (
                <span className="size-2 rounded-full bg-[#89b5ff]" aria-hidden="true" />
              )}
            </span>
            <span>
              <span className="block text-sm font-semibold text-[#fffaf0]">{item.title}</span>
              {item.detail ? (
                <span className="mt-1 block text-xs leading-5 text-[#c9bca8]">{item.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </motion.details>
  );
}

function parseStreamBuffer(
  buffer: string,
  onEvent: (event: StreamEvent) => void,
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";

  for (const part of parts) {
    const dataLine = part
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }

    try {
      onEvent(JSON.parse(dataLine.slice(5).trim()) as StreamEvent);
    } catch {
      // Ignore malformed stream metadata and keep the content stream alive.
    }
  }

  return rest;
}

function appendPlainTextResult(
  chunk: string,
  setResult: Dispatch<SetStateAction<ContinuationResult | null>>,
) {
  setResult((current) =>
    current ? { ...current, continuation: current.continuation + chunk } : current,
  );
}

function stoppedError(message: string) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function GouweiWorkbench() {
  const [sourceUrl, setSourceUrl] = useState(defaultSourceRef);
  const [sourceText, setSourceText] = useState("");
  const [analysis, setAnalysis] = useState<NarrativeAnalysis | null>(null);
  const [customStyleProfiles, setCustomStyleProfiles] = useState<StyleProfile[]>([]);
  const [managedPresetStyles, setManagedPresetStyles] = useState<StyleProfile[]>(presetStyles);
  const [selectedStyleId, setSelectedStyleId] = useState(neutralStyle.id);
  const [selectedArc, setSelectedArc] = useState(arcs[0].id);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("quick");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [accessMode, setAccessMode] = useState<"invite" | "custom">("invite");
  const [inviteCode, setInviteCode] = useState("ZH-HACK-2026");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<ContinuationResult | null>(null);
  const [lastClaudeRunConfig, setLastClaudeRunConfig] = useState<{
    mode: GenerationMode;
    thinkingEnabled: boolean;
    length: (typeof lengthOptions)[number]["id"];
  } | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<
    | "preview"
    | "style"
    | "search"
    | "skillSearch"
    | "skillImport"
    | "generate"
    | "continue"
    | "invite"
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"write" | "style">("write");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stories, setStories] = useState<HackathonStorySummary[]>([]);
  const [storyBusy, setStoryBusy] = useState<"list" | "detail" | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [workflowLog, setWorkflowLog] = useState<WorkflowLogItem[]>([]);
  const [workflowLogOpen, setWorkflowLogOpen] = useState(false);
  const [reasoningText, setReasoningText] = useState("");
  const [styleMaterialMode, setStyleMaterialMode] = useState<StyleMaterialMode>("text");
  const [styleMaterials, setStyleMaterials] = useState<StyleMaterial[]>(() => [blankStyleMaterial()]);
  const [styleTargetName, setStyleTargetName] = useState("");
  const [styleSkillLink, setStyleSkillLink] = useState("");
  const [styleSkillQuery, setStyleSkillQuery] = useState("writing style");
  const [styleSearchQuery, setStyleSearchQuery] = useState("");
  const [searchCandidates, setSearchCandidates] = useState<SearchCandidate[]>([]);
  const [selectedSearchCandidateIds, setSelectedSearchCandidateIds] = useState<string[]>([]);
  const [styleSearchSourceNote, setStyleSearchSourceNote] = useState("");
  const [styleSearchScoringNote, setStyleSearchScoringNote] = useState("");
  const [skillCandidates, setSkillCandidates] = useState<SkillCandidate[]>([]);

  const styleOptions = useMemo(() => {
    return [neutralStyle, ...customStyleProfiles, ...managedPresetStyles];
  }, [customStyleProfiles, managedPresetStyles]);

  const selectedStyle =
    styleOptions.find((style) => style.id === selectedStyleId) || neutralStyle;
  const selectedModeLabel =
    generationModes.find((mode) => mode.id === generationMode)?.label || "快速";
  const selectedLengthLabel =
    lengthOptions.find((option) => option.id === length)?.label || "中篇";
  const thinkingLabel = thinkingEnabled ? "思考开启" : "思考关闭";
  const streamedChars = result?.continuation.length || 0;
  const selectedCorpusSamples =
    analysis?.corpusPlan.samples.filter((sample) => sample.selected) || [];
  const selectedSearchCandidates = searchCandidates.filter((candidate) =>
    selectedSearchCandidateIds.includes(candidate.id),
  );
  const materialCharCount = styleMaterials.reduce(
    (sum, material) => sum + material.content.length,
    0,
  );
  const canDeleteStyle = styleOptions.length > minimumStyleCount;

  useEffect(() => {
    if (
      (busy !== "generate" && busy !== "continue" && busy !== "style") ||
      generationStartedAt === null
    ) {
      return;
    }

    const updateElapsed = () => {
      setGenerationElapsedSeconds(
        Math.max(0, Math.floor((performance.now() - generationStartedAt) / 1000)),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busy, generationStartedAt]);

  useEffect(() => {
    if (accessMode !== "invite") {
      return;
    }

    const controller = new AbortController();
    fetch("/api/generate/stream", {
      method: "GET",
      signal: controller.signal,
    }).catch(() => {
      // Warmup is best-effort; generation still starts the daemon lazily.
    });

    return () => controller.abort();
  }, [accessMode]);

  useEffect(() => {
    if (styleMaterialMode !== "skill" || skillCandidates.length) {
      return;
    }

    let cancelled = false;
    getJson<{ candidates: SkillCandidate[] }>("/api/style-skill/search")
      .then((data) => {
        if (!cancelled) {
          setSkillCandidates(data.candidates);
        }
      })
      .catch(() => {
        // Suggested Skill links are a convenience cache; manual search still works.
      });

    return () => {
      cancelled = true;
    };
  }, [skillCandidates.length, styleMaterialMode]);

  function addWorkflowLog(
    title: string,
    detail?: string,
    status: WorkflowLogItem["status"] = "info",
  ) {
    setWorkflowLog((current) => {
      const next = current.map((item) =>
        item.status === "running" ? { ...item, status: "done" as const } : item,
      );
      const latest = next.at(-1);

      if (latest?.title === title) {
        return [
          ...next.slice(0, -1),
          {
            title,
            detail: detail ?? latest.detail,
            status,
          },
        ];
      }

      return [...next, { title, detail, status }];
    });
  }

  function normalizeStyleName(value: string, fallback: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }

    const lastSegment = trimmed
      .split(/[/?#]/)
      .filter(Boolean)
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .trim();

    return lastSegment && lastSegment.length <= 18 ? lastSegment : fallback;
  }

  function upsertMaterial(nextMaterial: StyleMaterial) {
    setStyleMaterials((current) => {
      const emptyIndex = current.findIndex(
        (material) => !material.content.trim() && material.sourceType === "text",
      );
      if (emptyIndex >= 0) {
        return current.map((material, index) => (index === emptyIndex ? nextMaterial : material));
      }
      return [nextMaterial, ...current];
    });
  }

  function updateMaterial(id: string, patch: Partial<StyleMaterial>) {
    setStyleMaterials((current) =>
      current.map((material) => (material.id === id ? { ...material, ...patch } : material)),
    );
  }

  function addMaterial() {
    setStyleMaterials((current) => [
      ...current,
      {
        ...blankStyleMaterial(),
        title: `材料 ${current.length + 1}`,
      },
    ]);
  }

  function removeMaterial(id: string) {
    setStyleMaterials((current) => {
      const next = current.filter((material) => material.id !== id);
      return next.length ? next : [blankStyleMaterial()];
    });
  }

  function addStyleProfile(nextStyle: StyleProfile) {
    setCustomStyleProfiles((current) => [
      nextStyle,
      ...current.filter((style) => style.id !== nextStyle.id),
    ]);
    setSelectedStyleId(nextStyle.id);
  }

  function deleteStyle(style: StyleProfile) {
    if (style.id === neutralStyle.id || !canDeleteStyle) {
      return;
    }

    setCustomStyleProfiles((current) => current.filter((item) => item.id !== style.id));
    setManagedPresetStyles((current) => current.filter((item) => item.id !== style.id));

    if (selectedStyleId === style.id) {
      const nextStyle = styleOptions.find((item) => item.id !== style.id) || neutralStyle;
      setSelectedStyleId(nextStyle.id);
    }
  }

  async function importSkillMaterial(ref = styleSkillLink) {
    if (!ref.trim()) {
      setError("请先粘贴一个 Skill 链接、ClawHub slug 或 GitHub 地址。");
      return;
    }

    setBusy("skillImport");
    setError(null);

    try {
      const data = await postJson<{ material: Omit<StyleMaterial, "id"> }>(
        "/api/style-skill/import",
        { ref },
      );
      upsertMaterial({
        ...data.material,
        id: crypto.randomUUID(),
        title: data.material.title || normalizeStyleName(ref, "外部 Skill"),
      });
      setStyleMaterialMode("text");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Skill 获取失败");
    } finally {
      setBusy(null);
    }
  }

  async function searchSkills() {
    if (!styleSkillQuery.trim()) {
      setError("请输入 Skill 搜索词。");
      return;
    }

    setBusy("skillSearch");
    setError(null);

    try {
      const data = await postJson<{ candidates: SkillCandidate[] }>("/api/style-skill/search", {
        query: styleSkillQuery,
      });
      setSkillCandidates(data.candidates);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Skill 搜索失败");
    } finally {
      setBusy(null);
    }
  }

  async function runStyleSearch() {
    if (!styleSearchQuery.trim()) {
      setError("请输入作者、角色、知乎用户或风格关键词。");
      return;
    }

    setError(null);
    setBusy("search");

    try {
      const data = await postJson<{
        candidates: SearchCandidate[];
        sourceNote?: string;
        scoringNote?: string;
      }>("/api/style-search", { query: styleSearchQuery });
      setSearchCandidates(data.candidates);
      setSelectedSearchCandidateIds(
        data.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.id),
      );
      setStyleSearchSourceNote(data.sourceNote || "");
      setStyleSearchScoringNote(data.scoringNote || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "网络搜索失败");
    } finally {
      setBusy(null);
    }
  }

  function adoptSearchCandidates() {
    if (!selectedSearchCandidates.length) {
      setError("请先选择至少一条候选材料。");
      return;
    }

    const material = selectedSearchCandidates
      .map(
        (candidate) =>
          `【${candidate.title}】\n来源：${candidate.source}\n链接：${candidate.url || "无"}\n相关度：${candidate.relevance}\n评价依据：${candidate.reason}\n材料摘要：${candidate.excerpt}`,
      )
      .join("\n\n");

    upsertMaterial({
      id: crypto.randomUUID(),
      title: `${styleSearchQuery.trim()}：高相关公开材料`,
      content: material,
      sourceType: "search",
      sourceRef: styleSearchQuery.trim(),
      trustNote: "由公开搜索候选采纳，仍需确认材料来源可靠。",
    });
    setStyleMaterialMode("text");
    setError(null);
  }

  async function refineAuthorStyle() {
    setBusy("style");
    setError(null);
    setWorkflowLogOpen(true);
    setWorkflowLog([]);
    setReasoningText("");
    setGenerationStartedAt(performance.now());
    setGenerationElapsedSeconds(0);

    try {
      const usableMaterials = styleMaterials
        .map((material) => ({
          ...material,
          title: material.title.trim() || "未命名材料",
          content: material.content.trim(),
        }))
        .filter((material) => material.content.length >= 20);

      if (!usableMaterials.length) {
        throw new Error("请至少上传一条 20 字以上的文风材料。");
      }

      addWorkflowLog(
        "准备文风炼化",
        `${usableMaterials.length} 条材料，目标名称：${styleTargetName.trim() || "自动命名"}。`,
        "running",
      );

      const response = await fetch("/api/style-refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          materials: usableMaterials,
          targetName: styleTargetName.trim() || usableMaterials[0]?.title,
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("文风炼化没有返回流程流。");
      }

      const decoder = new TextDecoder();
      let eventBuffer = "";
      let nextAnalysis: NarrativeAnalysis | null = null;
      const handleStyleEvent = (streamEvent: StreamEvent) => {
        if (streamEvent.type === "log") {
          addWorkflowLog(streamEvent.title, streamEvent.detail, streamEvent.status || "info");
          return;
        }

        if (streamEvent.type === "analysis") {
          nextAnalysis = streamEvent.analysis;
          setAnalysis(streamEvent.analysis);
          addStyleProfile(streamEvent.analysis.styleProfile);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        eventBuffer = parseStreamBuffer(
          eventBuffer + decoder.decode(value, { stream: true }),
          handleStyleEvent,
        );
      }

      const tail = decoder.decode();
      if (tail) {
        eventBuffer = parseStreamBuffer(eventBuffer + tail, handleStyleEvent);
      }
      if (eventBuffer.trim()) {
        parseStreamBuffer(`${eventBuffer}\n\n`, handleStyleEvent);
      }
      if (!nextAnalysis) {
        throw new Error("Claude Code 没有生成可用文风。");
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "文风炼化失败";
      addWorkflowLog("文风炼化失败", message, "error");
      setError(message);
    } finally {
      setBusy(null);
      setGenerationStartedAt(null);
    }
  }

  async function ensureAnalysis() {
    if (analysis) {
      return analysis;
    }

    return postJson<NarrativeAnalysis>("/api/analyze", {
      sourceUrl,
      sourceText,
      permission: "public",
    });
  }

  async function checkInvite() {
    setBusy("invite");
    setError(null);
    setInviteStatus(null);

    try {
      const data = await postJson<{ remaining?: number; label?: string }>("/api/invite/redeem", {
        code: inviteCode,
        previewOnly: true,
      });
      setInviteStatus(`${data.label || "邀请码"}剩余 ${data.remaining ?? 0} 次`);
    } catch (nextError) {
      setInviteStatus(nextError instanceof Error ? nextError.message : "邀请码不可用");
    } finally {
      setBusy(null);
    }
  }

  async function loadStories() {
    setStoryBusy("list");
    setError(null);

    try {
      const data = await getJson<{ stories: HackathonStorySummary[] }>("/api/stories");
      setStories(data.stories);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "知乎故事列表读取失败");
    } finally {
      setStoryBusy(null);
    }
  }

  async function selectStory(story: HackathonStorySummary) {
    setStoryBusy("detail");
    setSelectedStoryId(story.workId);
    setError(null);
    setResult(null);
    setAnalysis(null);

    try {
      const detail = await getJson<HackathonStoryDetail>(`/api/stories/${story.workId}`);
      const storyUrl = `https://www.zhihu.com/market/story/${detail.workId}`;
      const content = [detail.introduction.trim(), detail.content.trim()]
        .filter(Boolean)
        .join("\n\n");
      setSourceUrl(storyUrl);
      setSourceText(content);
      setSelectedStyleId(neutralStyle.id);
      setActiveTab("write");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "知乎故事详情读取失败");
    } finally {
      setStoryBusy(null);
    }
  }

  async function generateContinuation(event: MouseEvent<HTMLButtonElement>) {
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setBusy("generate");
    setError(null);
    setResult(null);
    setLastClaudeRunConfig(null);
    setGenerationStartedAt(event.timeStamp);
    setGenerationElapsedSeconds(0);
    setWorkflowLogOpen(true);
    setWorkflowLog([]);
    setReasoningText("");

    try {
      const currentAnalysis = await ensureAnalysis();
      if (controller.signal.aborted) {
        throw stoppedError("生成已停止");
      }
      setAnalysis(currentAnalysis);
      const requestBody = {
        analysis: currentAnalysis,
        sourceText,
        selectedArc,
        styleProfile: selectedStyle,
        generationMode,
        thinkingEnabled,
        length,
        styleIntensity: styleIntensityForApiCompatibility,
        access:
          accessMode === "invite"
            ? { mode: "invite", inviteCode }
            : { mode: "custom", endpoint, apiKey, model },
      };

      if (accessMode === "invite") {
        const response = await fetch("/api/generate/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response));
        }

        const quotaRemaining = parseQuota(response.headers.get("x-quota-remaining"));
        const provider = providerFromHeader(response.headers.get("x-provider"));
        if (provider === "claude-code") {
          setLastClaudeRunConfig({ mode: generationMode, thinkingEnabled, length });
        }
        const streamingResult: ContinuationResult = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          title: `${currentAnalysis.source.title}：${selectedArc}`,
          continuation: "",
          editorNotes,
          usage: {
            provider,
            quotaRemaining,
            model: provider === "claude-code" ? "Claude Code" : undefined,
            mode: generationMode,
          },
        };
        setResult(streamingResult);
        if (typeof quotaRemaining === "number") {
          setInviteStatus(`剩余 ${quotaRemaining} 次`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const text = await response.text();
          appendPlainTextResult(text, setResult);
          addWorkflowLog("收到正文", `${text.length} 个字符。`, "done");
          return;
        }

        const decoder = new TextDecoder();
        const isEventStream = response.headers
          .get("content-type")
          ?.includes("text/event-stream");
        let eventBuffer = "";
        const handleStreamEvent = (streamEvent: StreamEvent) => {
          if (streamEvent.type === "log") {
            addWorkflowLog(streamEvent.title, streamEvent.detail, streamEvent.status || "info");
            return;
          }

          if (streamEvent.type === "reasoning") {
            setReasoningText((current) => current + streamEvent.chunk);
            return;
          }

          if (streamEvent.type === "analysis") {
            return;
          }

          appendPlainTextResult(streamEvent.chunk, setResult);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          if (isEventStream) {
            eventBuffer = parseStreamBuffer(eventBuffer + chunk, handleStreamEvent);
          } else {
            appendPlainTextResult(chunk, setResult);
          }
        }

        const tail = decoder.decode();
        if (tail) {
          if (isEventStream) {
            eventBuffer = parseStreamBuffer(eventBuffer + tail, handleStreamEvent);
          } else {
            appendPlainTextResult(tail, setResult);
          }
        }
        if (eventBuffer.trim()) {
          parseStreamBuffer(`${eventBuffer}\n\n`, handleStreamEvent);
        }
        return;
      }

      const nextResult = await postJson<ContinuationResult>("/api/generate", requestBody);
      setResult(nextResult);
      if (typeof nextResult.usage.quotaRemaining === "number") {
        setInviteStatus(`剩余 ${nextResult.usage.quotaRemaining} 次`);
      }
    } catch (nextError) {
      if (isAbortError(nextError)) {
        addWorkflowLog("生成已停止", "已保留当前已经流出的正文。", "info");
        return;
      }

      const message = nextError instanceof Error ? nextError.message : "生成失败";
      addWorkflowLog("生成失败", message, "error");
      setError(message);
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
      setBusy(null);
      setGenerationStartedAt(null);
    }
  }

  async function continueContinuation(event: MouseEvent<HTMLButtonElement>) {
    if (!result) {
      setError("请先完成一次续写，再继续生成。");
      return;
    }
    if (accessMode !== "invite") {
      setError("继续生成当前只支持 Claude Code 邀请码模式。");
      return;
    }

    const continueConfig = lastClaudeRunConfig || {
      mode: generationMode,
      thinkingEnabled,
      length,
    };
    const controller = new AbortController();
    generationAbortRef.current = controller;
    setBusy("continue");
    setError(null);
    setGenerationStartedAt(event.timeStamp);
    setGenerationElapsedSeconds(0);
    setWorkflowLogOpen(true);
    setReasoningText("");
    addWorkflowLog("准备继续生成", "复用当前 Claude Code 会话，不重新发送完整上下文。", "running");

    try {
      const response = await fetch("/api/generate/continue/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          generationMode: continueConfig.mode,
          thinkingEnabled: continueConfig.thinkingEnabled,
          length: continueConfig.length,
          access: { mode: "invite", inviteCode },
        }),
      });

      if (!response.ok) {
        throw new Error(await readResponseError(response));
      }

      const quotaRemaining = parseQuota(response.headers.get("x-quota-remaining"));
      if (typeof quotaRemaining === "number") {
        setInviteStatus(`剩余 ${quotaRemaining} 次`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("继续生成没有返回流式正文。");
      }

      const decoder = new TextDecoder();
      let eventBuffer = "";
      const handleStreamEvent = (streamEvent: StreamEvent) => {
        if (streamEvent.type === "log") {
          addWorkflowLog(streamEvent.title, streamEvent.detail, streamEvent.status || "info");
          return;
        }
        if (streamEvent.type === "reasoning") {
          setReasoningText((current) => current + streamEvent.chunk);
          return;
        }
        if (streamEvent.type === "analysis") {
          return;
        }
        appendPlainTextResult(streamEvent.chunk, setResult);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        eventBuffer = parseStreamBuffer(
          eventBuffer + decoder.decode(value, { stream: true }),
          handleStreamEvent,
        );
      }

      const tail = decoder.decode();
      if (tail) {
        eventBuffer = parseStreamBuffer(eventBuffer + tail, handleStreamEvent);
      }
      if (eventBuffer.trim()) {
        parseStreamBuffer(`${eventBuffer}\n\n`, handleStreamEvent);
      }
    } catch (nextError) {
      if (isAbortError(nextError)) {
        addWorkflowLog("继续生成已停止", "已保留当前已经流出的正文。", "info");
        return;
      }

      const message = nextError instanceof Error ? nextError.message : "继续生成失败";
      addWorkflowLog("继续生成失败", message, "error");
      setError(message);
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
      }
      setBusy(null);
      setGenerationStartedAt(null);
    }
  }

  function stopActiveGeneration() {
    if (busy !== "generate" && busy !== "continue") {
      return;
    }

    void fetch("/api/generate/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generationMode: lastClaudeRunConfig?.mode || generationMode,
        thinkingEnabled: lastClaudeRunConfig?.thinkingEnabled ?? thinkingEnabled,
      }),
    }).catch(() => {
      // The active streaming request also carries an abort signal; this endpoint is a backup stop path.
    });
    generationAbortRef.current?.abort();
    addWorkflowLog(
      busy === "continue" ? "停止继续生成" : "停止生成",
      "已向 Claude Code 发送停止请求，当前正文会保留。",
      "info",
    );
  }

  return (
    <main className="min-h-screen bg-[#f2ecdf] text-[#171411]">
      <header className="border-b border-[#dfd3c2] bg-[#f7f1e7]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[#171411] text-[#fffaf0]">
              <PenLine aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-[#6f6558]">知乎 Hackathon 2026</p>
              <h1 className="text-xl font-semibold leading-none">狗尾续貂？</h1>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-2 lg:min-w-[520px]">
            <div className="grid grid-cols-2 rounded-md bg-[#f0e7d9] p-1">
              {(["invite", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAccessMode(mode)}
                  className={cn(
                    "h-8 rounded text-sm font-semibold transition",
                    accessMode === mode ? "bg-[#171411] text-[#fffaf0]" : "text-[#6f6558]",
                  )}
                >
                  {mode === "invite" ? "邀请码额度" : "自带 API"}
                </button>
              ))}
            </div>
            {accessMode === "invite" ? (
              <div className="flex gap-2">
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-[#d8cdbc] bg-white px-3 text-xs uppercase outline-none focus:border-[#176bff]"
                />
                <button
                  type="button"
                  onClick={checkInvite}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-[#176bff] px-3 text-xs font-semibold text-white"
                >
                  {busy === "invite" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  {inviteStatus || "查额度"}
                </button>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-[1fr_120px_1fr]">
                <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className="h-9 rounded-md border border-[#d8cdbc] px-3 text-xs outline-none" placeholder="Endpoint" />
                <input value={model} onChange={(event) => setModel(event.target.value)} className="h-9 rounded-md border border-[#d8cdbc] px-3 text-xs outline-none" placeholder="模型" />
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="h-9 rounded-md border border-[#d8cdbc] px-3 text-xs outline-none" type="password" placeholder="API Key" />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-4">
        <div className="mb-4 flex flex-col gap-3 border-b border-[#dfd3c2] pb-3 md:flex-row md:items-center md:justify-between">
          <div className="grid w-full grid-cols-2 rounded-lg bg-[#e8ddcb] p-1 md:w-80">
            {([
              ["write", "续写"],
              ["style", "文风炼化"],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "h-9 rounded-md text-sm font-semibold transition",
                  activeTab === tab ? "bg-[#171411] text-[#fffaf0]" : "text-[#6f6558]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-[#6f6558]">
            知乎故事、粘贴文本和文风 Skill 进入同一套续写流程。
          </p>
        </div>

        {activeTab === "write" ? (
          <div className="grid min-h-[calc(100vh-188px)] gap-4 xl:grid-cols-2">
            <section className="flex min-h-[640px] flex-col rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-4 shadow-[0_16px_45px_rgba(60,44,24,0.08)]">
              <div className="mb-4 rounded-lg border border-[#d8cdbc] bg-[#f8f2e8] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-[#3b3329]">
                      <BookOpen aria-hidden="true" className="size-4 text-[#176bff]" />
                      知乎故事
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#6f6558]">
                      获取 Hackathon 故事列表，选中后把正文放入下方。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadStories}
                    disabled={storyBusy === "list"}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#176bff] bg-white px-2.5 text-xs font-semibold text-[#17488f] disabled:opacity-60"
                  >
                    {storyBusy === "list" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
                    {stories.length ? "刷新" : "获取列表"}
                  </button>
                </div>
                {stories.length ? (
                  <div className="mt-3 grid max-h-48 gap-2 overflow-auto pr-1 md:grid-cols-2">
                    {stories.map((story) => (
                      <button
                        key={story.workId}
                        type="button"
                        onClick={() => selectStory(story)}
                        disabled={storyBusy === "detail"}
                        className={cn(
                          "rounded-md border bg-white p-2 text-left transition hover:border-[#176bff]",
                          selectedStoryId === story.workId
                            ? "border-[#176bff] ring-2 ring-[#176bff]/10"
                            : "border-[#d8cdbc]",
                        )}
                      >
                        <span className="block truncate text-xs font-semibold text-[#3b3329]">
                          {story.title}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-[#6f6558]">
                          {story.description || story.labels?.join(" / ") || story.workId}
                        </span>
                        {story.labels?.length ? (
                          <span className="mt-2 flex flex-wrap gap-1">
                            {story.labels.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded bg-[#eef4ff] px-1.5 py-0.5 text-[10px] text-[#17488f]">
                                {tag}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#3b3329]">粘贴要续写的片段</p>
                  <p className="mt-1 text-xs text-[#6f6558]">{sourceText.length} 字符</p>
                </div>
              </div>

              <textarea
                value={sourceText}
                onChange={(event) => setSourceText(event.target.value)}
                className="mt-4 min-h-[430px] flex-1 resize-none rounded-lg border border-[#d8cdbc] bg-white px-4 py-4 text-[15px] leading-8 outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                placeholder="直接粘贴知乎试读片段、自有草稿，或从上方故事列表选择正文。"
              />

              <section className="mt-3 rounded-lg border border-[#171411] bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#3b3329]">文风选择</p>
                    <p className="mt-1 text-xs leading-5 text-[#6f6558]">{selectedStyle.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setThinkingEnabled((enabled) => !enabled)}
                      className={cn(
                        "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition",
                        thinkingEnabled
                          ? "border-[#176bff] bg-[#eef4ff] text-[#17488f]"
                          : "border-[#d8cdbc] bg-white text-[#6f6558]",
                      )}
                    >
                      <span
                        className={cn(
                          "relative h-4 w-7 rounded-full transition",
                          thinkingEnabled ? "bg-[#176bff]" : "bg-[#d8cdbc]",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-3 rounded-full bg-white transition",
                            thinkingEnabled ? "left-3.5" : "left-0.5",
                          )}
                        />
                      </span>
                      模型思考
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("style")}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[#176bff] bg-[#eef4ff] px-3 text-xs font-semibold text-[#17488f]"
                    >
                      <Sparkles className="size-3.5" aria-hidden="true" />
                      自制文风
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {styleOptions.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyleId(style.id)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left transition",
                        selectedStyle.id === style.id
                          ? "border-[#176bff] bg-[#eef4ff] text-[#17488f]"
                          : "border-[#d8cdbc] bg-[#fffdf8] text-[#3b3329] hover:border-[#176bff]",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{style.label}</span>
                        <span className="shrink-0 rounded bg-[#171411] px-1.5 py-0.5 text-[10px] text-[#fffaf0]">
                          {styleSourceLabel[style.source]}
                        </span>
                      </span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#6f6558]">
                        {style.summary}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <details
                open={settingsOpen}
                onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
                className="mt-3 rounded-lg border border-[#d8cdbc] bg-[#f8f2e8]"
              >
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-[#3b3329]">
                  <span className="flex flex-wrap items-center gap-2">
                    <span>续写配置</span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs text-[#6f6558]">{selectedArc}</span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs text-[#6f6558]">{selectedLengthLabel}</span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs text-[#6f6558]">{selectedModeLabel}</span>
                    <span className="rounded bg-white px-2 py-0.5 text-xs text-[#6f6558]">{thinkingLabel}</span>
                  </span>
                </summary>
                <div className="grid gap-3 border-t border-[#e2d6c6] p-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-[#6f6558]">方向</span>
                    <select
                      value={selectedArc}
                      onChange={(event) => setSelectedArc(event.target.value)}
                      className="h-10 rounded-md border border-[#d8cdbc] bg-white px-3 text-sm outline-none focus:border-[#176bff]"
                    >
                      {arcs.map((arc) => (
                        <option key={arc.id} value={arc.id}>
                          {arc.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-[#6f6558]">篇幅</span>
                    <select
                      value={length}
                      onChange={(event) => setLength(event.target.value as "short" | "medium" | "long")}
                      className="h-10 rounded-md border border-[#d8cdbc] bg-white px-3 text-sm outline-none focus:border-[#176bff]"
                    >
                      {lengthOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-[#6f6558]">模式</span>
                    <select
                      value={generationMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as GenerationMode;
                        setGenerationMode(nextMode);
                      }}
                      className="h-10 rounded-md border border-[#d8cdbc] bg-white px-3 text-sm outline-none focus:border-[#176bff]"
                    >
                      {generationModes.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label} · {mode.summary}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap items-end gap-1.5 md:col-span-2 xl:col-span-3">
                    {selectedStyle.dimensions?.slice(0, 5).map((dimension) => (
                      <span key={dimension} className="rounded bg-white px-2 py-1 text-xs text-[#6f6558]">
                        {dimension}
                      </span>
                    ))}
                  </div>
                </div>
              </details>

              <button
                type="button"
                onClick={generateContinuation}
                disabled={busy === "generate" || busy === "continue" || !sourceText}
                className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#176bff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f58d6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "generate" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                {busy === "generate" ? "创作中" : "开始创作"}
              </button>

              {busy === "generate" || busy === "continue" ? (
                <button
                  type="button"
                  onClick={stopActiveGeneration}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#d25b4f] bg-[#fff0ed] px-4 text-sm font-semibold text-[#9f3728] transition hover:bg-[#ffe3dc]"
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                  停止生成
                </button>
              ) : null}

              {error ? (
                <div className="mt-3 flex gap-2 rounded-lg border border-[#f4c0b6] bg-[#fff0ed] p-3 text-sm leading-6 text-[#9f3728]">
                  <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />
                  {error}
                </div>
              ) : null}
            </section>

            <section className="flex min-h-[640px] flex-col rounded-lg border border-[#171411] bg-[#171411] p-4 text-[#fffaf0] shadow-[0_16px_45px_rgba(23,20,17,0.18)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#89b5ff]">续写输出</p>
                  <h2 className="mt-1 truncate text-lg font-semibold">
                    {result
                      ? result.title
                      : busy === "generate" || busy === "continue"
                        ? "正在生成"
                        : "等待生成"}
                  </h2>
                </div>
                {result ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-[#c9bca8]">
                      {providerLabel[result.usage.provider]}
                    </span>
                    {result.usage.mode ? (
                      <span className="rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-[#c9bca8]">
                        {generationModes.find((mode) => mode.id === result.usage.mode)?.label}
                      </span>
                    ) : null}
                    <ExternalLink aria-hidden="true" className="size-5 shrink-0 text-[#89b5ff]" />
                  </div>
                ) : null}
              </div>

              {workflowLog.length ? (
                <WorkflowLogPanel
                  items={workflowLog}
                  open={workflowLogOpen}
                  onToggle={setWorkflowLogOpen}
                  elapsedSeconds={generationElapsedSeconds}
                  streamedChars={streamedChars}
                  reasoningText={reasoningText}
                />
              ) : null}

              <AnimatePresence mode="wait">
                {result ? (
                  <motion.article
                    key={result.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.24 }}
                    className="mt-4 min-h-[520px] flex-1 overflow-auto rounded-lg border border-white/12 bg-[#201b16] p-5"
                  >
                    <textarea
                      value={result.continuation || "正在生成..."}
                      readOnly
                      className="h-full min-h-[480px] w-full resize-none overflow-auto rounded-md border border-white/10 bg-transparent p-0 text-[15px] leading-8 text-[#f8f1e4] outline-none"
                    />
                    <button
                      type="button"
                      onClick={continueContinuation}
                      disabled={busy === "generate" || busy === "continue"}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#89b5ff] bg-[#eef4ff] px-4 text-sm font-semibold text-[#17488f] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "continue" ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      {busy === "continue" ? "继续生成中" : "继续生成"}
                    </button>
                  </motion.article>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 flex min-h-[520px] flex-1 flex-col justify-center rounded-lg border border-white/12 bg-[#201b16] p-5"
                  >
                    <div className="flex items-center gap-2 text-[#89b5ff]">
                      <Sparkles aria-hidden="true" />
                      <span className="text-sm font-semibold">输出预览</span>
                    </div>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-[#d8cdbc]">
                      {busy === "generate" || busy === "continue"
                        ? thinkingEnabled
                          ? "Claude Code 正在运行；推理过程会先出现在工作记录，正文随后流入这里。"
                          : "Claude Code 正在运行；正文会直接流入这里。"
                        : "左侧粘贴片段后生成；可按需要开启模型思考。"}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <p className="mt-3 flex gap-2 text-xs leading-5 text-[#c9bca8]">
                <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[#9ad7b2]" />
                输出默认保留原创续写边界，不复现隐藏正文。
              </p>
            </section>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.42fr)]">
            <section className="rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-4 shadow-[0_16px_45px_rgba(60,44,24,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#3b3329]">文风炼化材料</p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[#6f6558]">
                    建议按文章分条上传 3 条以上材料。Claude Code 会读取多篇样本，提炼稳定文风，再生成可复用 Skill。
                  </p>
                </div>
                <span className="rounded bg-[#171411] px-2 py-1 text-xs font-semibold text-[#fffaf0]">
                  {styleMaterials.length} 条 · {materialCharCount} 字符
                </span>
              </div>

              <label className="mt-4 block">
                <span className="text-sm font-semibold text-[#3b3329]">文风名称</span>
                <input
                  value={styleTargetName}
                  onChange={(event) => setStyleTargetName(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-[#d8cdbc] bg-white px-4 text-sm outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                  placeholder="例如：余华式冷幽默、林黛玉口吻、我的公众号文风"
                />
              </label>

              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {styleMaterialModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setStyleMaterialMode(mode.id)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition",
                      styleMaterialMode === mode.id
                        ? "border-[#176bff] bg-[#eef4ff] text-[#17488f] ring-2 ring-[#176bff]/10"
                        : "border-[#d8cdbc] bg-white text-[#3b3329] hover:border-[#176bff]",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {mode.id === "text" ? (
                        <FileText className="size-4" aria-hidden="true" />
                      ) : mode.id === "skill" ? (
                        <Link2 className="size-4" aria-hidden="true" />
                      ) : (
                        <Search className="size-4" aria-hidden="true" />
                      )}
                      {mode.label}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[#6f6558]">
                      {mode.summary}
                    </span>
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {styleMaterialMode === "text" ? (
                  <motion.div
                    key="style-text"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="mt-4"
                  >
                    <div className="rounded-lg border border-[#d8cdbc] bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[#3b3329]">分文章上传</p>
                          <p className="mt-1 text-xs leading-5 text-[#6f6558]">
                            每条材料单独命名，便于 Claude Code 判断哪些特征是稳定文风，哪些只是单篇内容。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addMaterial}
                          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#176bff] bg-[#eef4ff] px-3 text-xs font-semibold text-[#17488f]"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                          添加材料
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3">
                        {styleMaterials.map((material, index) => (
                          <div
                            key={material.id}
                            className="rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-3"
                          >
                            <div className="flex flex-col gap-2 md:flex-row">
                              <input
                                value={material.title}
                                onChange={(event) =>
                                  updateMaterial(material.id, { title: event.target.value })
                                }
                                className="h-10 min-w-0 flex-1 rounded-md border border-[#d8cdbc] bg-white px-3 text-sm outline-none focus:border-[#176bff]"
                                placeholder={`材料 ${index + 1} 标题`}
                              />
                              <button
                                type="button"
                                onClick={() => removeMaterial(material.id)}
                                disabled={styleMaterials.length <= 1}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#d8cdbc] bg-white px-3 text-xs font-semibold text-[#6f6558] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                                删除
                              </button>
                            </div>
                            <textarea
                              value={material.content}
                              onChange={(event) =>
                                updateMaterial(material.id, {
                                  content: event.target.value,
                                  sourceType: material.sourceType === "text" ? "text" : material.sourceType,
                                })
                              }
                              className="mt-2 min-h-40 w-full resize-y rounded-lg border border-[#d8cdbc] bg-white px-4 py-3 text-sm leading-7 outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                              placeholder="粘贴这一篇文章、片段、访谈转写或已采纳的公开材料。"
                            />
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6f6558]">
                              <span>{material.sourceType} · {material.content.length} 字符</span>
                              {material.trustNote ? <span>{material.trustNote}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : styleMaterialMode === "skill" ? (
                  <motion.div
                    key="style-skill"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="mt-4 rounded-lg border border-[#171411] bg-white p-4"
                  >
                    <div className="grid gap-3 lg:grid-cols-2">
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#3b3329]">搜索 ClawHub / GitHub Skill</span>
                        <div className="flex gap-2">
                          <input
                            value={styleSkillQuery}
                            onChange={(event) => setStyleSkillQuery(event.target.value)}
                            className="h-12 min-w-0 flex-1 rounded-lg border border-[#d8cdbc] bg-[#fffdf8] px-4 text-sm outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                            placeholder="writing style / character voice / author style"
                          />
                          <button
                            type="button"
                            onClick={searchSkills}
                            disabled={busy === "skillSearch"}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#171411] px-4 text-sm font-semibold text-[#fffaf0] transition disabled:opacity-60"
                          >
                            {busy === "skillSearch" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                            搜索
                          </button>
                        </div>
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-[#3b3329]">直接导入 Skill 链接</span>
                        <div className="flex gap-2">
                          <input
                            value={styleSkillLink}
                            onChange={(event) => setStyleSkillLink(event.target.value)}
                            className="h-12 min-w-0 flex-1 rounded-lg border border-[#d8cdbc] bg-[#fffdf8] px-4 text-sm outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                            placeholder="ClawHub slug / GitHub repo / raw SKILL.md"
                          />
                          <button
                            type="button"
                            onClick={() => importSkillMaterial()}
                            disabled={busy === "skillImport"}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#176bff] bg-[#eef4ff] px-4 text-sm font-semibold text-[#17488f] transition disabled:opacity-60"
                          >
                            {busy === "skillImport" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <DownloadCloud className="size-4" aria-hidden="true" />}
                            获取
                          </button>
                        </div>
                      </label>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#6f6558]">
                      候选来自 ClawHub API 和 GitHub 仓库搜索；导入后会作为一条材料进入 Claude Code 炼化，不会直接当成可信文风。
                    </p>
                    <div className="mt-4 grid gap-2">
                      {skillCandidates.length ? (
                        skillCandidates.map((candidate) => (
                          <div key={candidate.id} className="rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#3b3329]">{candidate.title}</p>
                                <p className="mt-1 text-xs text-[#6f6558]">{candidate.source} · {candidate.url}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => importSkillMaterial(candidate.url)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#171411] px-2.5 text-xs font-semibold text-[#fffaf0]"
                              >
                                <DownloadCloud className="size-3.5" aria-hidden="true" />
                                导入
                              </button>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-[#3b3329]">{candidate.summary}</p>
                            <p className="mt-2 text-xs leading-5 text-[#6f6558]">{candidate.trustNote}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-[#d8cdbc] bg-[#fffaf0] p-4 text-sm leading-6 text-[#6f6558]">
                          搜索后会显示可导入的真实 Skill 候选；也可以直接粘贴别人给你的 ClawHub / GitHub 链接。
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="style-search"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="mt-4 rounded-lg border border-[#171411] bg-white p-4"
                  >
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-[#3b3329]">搜索对象</span>
                      <div className="flex flex-col gap-2 md:flex-row">
                        <input
                          value={styleSearchQuery}
                          onChange={(event) => setStyleSearchQuery(event.target.value)}
                          className="h-12 min-w-0 flex-1 rounded-lg border border-[#d8cdbc] bg-[#fffdf8] px-4 text-sm outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                          placeholder="输入作者、角色、知乎用户或风格关键词"
                        />
                        <button
                          type="button"
                          onClick={runStyleSearch}
                          disabled={busy === "search"}
                          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#171411] px-4 text-sm font-semibold text-[#fffaf0] transition hover:bg-[#2d251d] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy === "search" ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Search className="size-4" aria-hidden="true" />
                          )}
                          {busy === "search" ? "检索中" : "检索候选"}
                        </button>
                      </div>
                    </label>

                    {styleSearchSourceNote || styleSearchScoringNote ? (
                      <div className="mt-3 rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-3 text-xs leading-5 text-[#6f6558]">
                        {styleSearchSourceNote ? <p>{styleSearchSourceNote}</p> : null}
                        {styleSearchScoringNote ? <p className="mt-1">{styleSearchScoringNote}</p> : null}
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-2">
                      {searchCandidates.length ? (
                        searchCandidates.map((candidate) => (
                          <div
                            key={candidate.id}
                            className={cn(
                              "rounded-lg border p-3",
                              candidate.relevance >= 82
                                ? "border-[#176bff] bg-[#eef4ff]"
                                : "border-[#d8cdbc] bg-[#fffaf0]",
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                                <input
                                  type="checkbox"
                                  checked={selectedSearchCandidateIds.includes(candidate.id)}
                                  onChange={(event) => {
                                    setSelectedSearchCandidateIds((current) =>
                                      event.target.checked
                                        ? Array.from(new Set([...current, candidate.id]))
                                        : current.filter((id) => id !== candidate.id),
                                    );
                                  }}
                                  className="mt-1 size-4 shrink-0 accent-[#176bff]"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-[#3b3329]">
                                    {candidate.title}
                                  </span>
                                  <span className="mt-1 block text-xs text-[#6f6558]">
                                    {candidate.source}
                                    {candidate.url ? ` · ${candidate.url}` : ""}
                                  </span>
                                </span>
                              </label>
                              <span
                                className={cn(
                                  "rounded px-2 py-1 text-xs font-semibold",
                                  candidate.sourceKind === "zhihu"
                                    ? "bg-[#176bff] text-white"
                                    : candidate.relevance >= 82
                                    ? "bg-[#176bff] text-white"
                                    : "bg-[#e8ddcb] text-[#6f6558]",
                                )}
                              >
                                {candidate.sourceKind === "zhihu" ? "知乎" : "公开"} · 相关度 {candidate.relevance}
                              </span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-[#6f6558]">{candidate.reason}</p>
                            <p className="mt-2 text-xs leading-5 text-[#3b3329]">{candidate.excerpt}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-[#d8cdbc] bg-[#fffaf0] p-4 text-sm leading-6 text-[#6f6558]">
                          搜索结果会先进入候选区。知乎站内结果优先，公开搜索兜底；你可以手动勾选值得参考的材料。
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={adoptSearchCandidates}
                      disabled={!selectedSearchCandidates.length}
                      className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#176bff] bg-[#eef4ff] px-4 text-sm font-semibold text-[#17488f] transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="size-4" aria-hidden="true" />
                      采纳已选素材
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={refineAuthorStyle}
                disabled={busy === "style" || !styleMaterials.some((material) => material.content.trim().length >= 20)}
                className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#176bff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f58d6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "style" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {busy === "style" ? "Claude Code 炼化中" : analysis ? "重新生成文风 Skill" : "调用 Claude Code 生成文风 Skill"}
              </button>

              {workflowLog.length ? (
                <WorkflowLogPanel
                  items={workflowLog}
                  open={workflowLogOpen}
                  onToggle={setWorkflowLogOpen}
                  elapsedSeconds={generationElapsedSeconds}
                  streamedChars={materialCharCount}
                  reasoningText={reasoningText}
                  meterText={`文风炼化流程可见：材料 ${styleMaterials.length} 条，材料 ${materialCharCount} 字，已记录 ${workflowLog.length} 个步骤。`}
                />
              ) : null}

              {error ? (
                <div className="mt-3 flex gap-2 rounded-lg border border-[#f4c0b6] bg-[#fff0ed] p-3 text-sm leading-6 text-[#9f3728]">
                  <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />
                  {error}
                </div>
              ) : null}
            </section>

            <aside className="rounded-lg border border-[#171411] bg-[#171411] p-4 text-[#fffaf0]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#89b5ff]">已有文风</p>
                  <h2 className="mt-2 truncate text-xl font-semibold">{selectedStyle.label}</h2>
                </div>
                <span className="rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-[#c9bca8]">
                  至少保留 {minimumStyleCount}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#d8cdbc]">{selectedStyle.summary}</p>

              {selectedStyle.provenance ? (
                <p className="mt-3 rounded-md border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-[#c9bca8]">
                  {selectedStyle.provenance}
                </p>
              ) : null}

              {selectedStyle.dimensions?.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedStyle.dimensions.map((dimension) => (
                    <span key={dimension} className="rounded bg-white/10 px-2 py-1 text-xs text-[#d8cdbc]">
                      {dimension}
                    </span>
                  ))}
                </div>
              ) : null}

              {selectedCorpusSamples.length ? (
                <div className="mt-5 border-t border-white/12 pt-4">
                  <p className="text-xs font-semibold text-[#89b5ff]">本次样本</p>
                  <div className="mt-3 grid gap-2">
                    {selectedCorpusSamples.map((sample) => (
                      <span key={sample.id} className="rounded-md bg-white/10 px-2 py-1 text-xs text-[#d8cdbc]">
                        {sample.lengthClass === "long" ? "长文" : "短文"} · {sample.title}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 border-t border-white/12 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#89b5ff]">文风管理</p>
                  <p className="text-[11px] text-[#c9bca8]">{styleOptions.length} 个</p>
                </div>
                <div className="mt-3 grid gap-2">
                  {styleOptions.map((style) => (
                    <div
                      key={style.id}
                      className={cn(
                        "rounded-md border p-2 text-sm transition",
                        selectedStyle.id === style.id
                          ? "border-[#89b5ff] bg-[#29364a]"
                          : "border-white/12 bg-[#201b16] text-[#c9bca8] hover:border-[#89b5ff]/60",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedStyleId(style.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold">{style.label}</span>
                            <span className="shrink-0 text-[10px] text-[#c9bca8]">
                              {styleSourceLabel[style.source]}
                            </span>
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#c9bca8]">
                            {style.summary}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteStyle(style)}
                          disabled={style.id === neutralStyle.id || !canDeleteStyle}
                          className="flex size-8 shrink-0 items-center justify-center rounded border border-white/10 text-[#c9bca8] transition hover:border-[#f4a08f] hover:text-[#f4a08f] disabled:cursor-not-allowed disabled:opacity-30"
                          title={
                            style.id === neutralStyle.id
                              ? "默认文风不可删除"
                              : canDeleteStyle
                                ? "删除文风"
                                : `至少保留 ${minimumStyleCount} 个文风`
                          }
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
