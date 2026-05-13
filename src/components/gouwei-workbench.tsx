"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ExternalLink,
  KeyRound,
  Loader2,
  MessagesSquare,
  PenLine,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import type {
  ArticlePreview,
  ContinuationResult,
  GenerationMode,
  NarrativeAnalysis,
  StyleProfile,
} from "@/lib/types";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const defaultUrl = "https://www.zhihu.com/question/...";

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
  | { type: "text"; chunk: string };

const lengthOptions = [
  { id: "short", label: "短篇" },
  { id: "medium", label: "中篇" },
  { id: "long", label: "长篇" },
] as const;

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

const previewStatusLabel = {
  public_preview: "已读取试读",
  paid_content: "盐选链接",
  blocked: "读取受限",
  manual_input: "手动导入",
} satisfies Record<ArticlePreview["status"], string>;

const editorNotes = [
  "已避免复现原文句式和隐藏付费正文。",
  "建议发布时保留 AI 辅助创作声明与原文跳转。",
  "可继续调整伏笔回收，或导出风格协作说明。",
];

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
}: {
  items: WorkflowLogItem[];
  open: boolean;
  onToggle: (open: boolean) => void;
  elapsedSeconds: number;
  streamedChars: number;
  reasoningText: string;
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
        模型思考开启时会展示推理流；当前推理 {reasoningText.length} 字，正文 {streamedChars} 字。
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

export function GouweiWorkbench() {
  const [sourceUrl, setSourceUrl] = useState(defaultUrl);
  const [sourceText, setSourceText] = useState("");
  const [preview, setPreview] = useState<ArticlePreview | null>(null);
  const [analysis, setAnalysis] = useState<NarrativeAnalysis | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState(neutralStyle.id);
  const [styleIntensity, setStyleIntensity] = useState(48);
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
  const [busy, setBusy] = useState<"preview" | "style" | "generate" | "invite" | null>(null);
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

  const styleOptions = useMemo(() => {
    return [neutralStyle, ...presetStyles];
  }, []);

  const selectedStyle =
    styleOptions.find((style) => style.id === selectedStyleId) || neutralStyle;
  const selectedModeLabel =
    generationModes.find((mode) => mode.id === generationMode)?.label || "快速";
  const selectedLengthLabel =
    lengthOptions.find((option) => option.id === length)?.label || "中篇";
  const thinkingLabel = thinkingEnabled ? "思考开启" : "思考关闭";
  const streamedChars = result?.continuation.length || 0;

  useEffect(() => {
    if (busy !== "generate" || generationStartedAt === null) {
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

  async function loadPreview() {
    setBusy("preview");
    setError(null);
    setResult(null);
    setAnalysis(null);

    try {
      const nextPreview = await postJson<ArticlePreview>("/api/preview", {
        sourceUrl,
      });
      setPreview(nextPreview);
      if (nextPreview.sourceUrl) {
        setSourceUrl(nextPreview.sourceUrl);
      }
      setSourceText(nextPreview.previewText);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "试看片段读取失败");
    } finally {
      setBusy(null);
    }
  }

  async function refineAuthorStyle() {
    setBusy("style");
    setError(null);

    try {
      const nextAnalysis = await postJson<NarrativeAnalysis>("/api/analyze", {
        sourceUrl,
        sourceText,
        permission: "public",
      });
      setAnalysis(nextAnalysis);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文风炼化失败");
    } finally {
      setBusy(null);
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
      setPreview({
        id: detail.workId,
        sourceUrl: storyUrl,
        linkKind: "unknown",
        status: "public_preview",
        title: detail.chapterName,
        author: detail.authorName,
        previewText: content,
        accessNote: "来自知乎 Hackathon 故事接口。",
      });
      setSelectedStyleId(neutralStyle.id);
      setActiveTab("write");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "知乎故事详情读取失败");
    } finally {
      setStoryBusy(null);
    }
  }

  async function generateContinuation(event: MouseEvent<HTMLButtonElement>) {
    setBusy("generate");
    setError(null);
    setResult(null);
    setGenerationStartedAt(event.timeStamp);
    setGenerationElapsedSeconds(0);
    setWorkflowLogOpen(true);
    setWorkflowLog([]);
    setReasoningText("");

    try {
      const currentAnalysis = await ensureAnalysis();
      setAnalysis(currentAnalysis);
      const requestBody = {
        analysis: currentAnalysis,
        sourceText,
        selectedArc,
        styleProfile: selectedStyle,
        generationMode,
        thinkingEnabled,
        length,
        styleIntensity,
        access:
          accessMode === "invite"
            ? { mode: "invite", inviteCode }
            : { mode: "custom", endpoint, apiKey, model },
      };

      if (accessMode === "invite") {
        const response = await fetch("/api/generate/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response));
        }

        const quotaRemaining = parseQuota(response.headers.get("x-quota-remaining"));
        const provider = providerFromHeader(response.headers.get("x-provider"));
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
      const message = nextError instanceof Error ? nextError.message : "生成失败";
      addWorkflowLog("生成失败", message, "error");
      setError(message);
    } finally {
      setBusy(null);
      setGenerationStartedAt(null);
    }
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
            知乎故事、链接和粘贴文本进入同一套续写流程。
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
                  <label className="flex flex-col gap-1.5 md:col-span-2">
                    <span className="text-xs font-semibold text-[#6f6558]">贴近程度 {styleIntensity}</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={styleIntensity}
                      onChange={(event) => setStyleIntensity(Number(event.target.value))}
                      className="h-10 accent-[#176bff]"
                    />
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
                disabled={busy === "generate" || !sourceText}
                className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#176bff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f58d6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "generate" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
                {busy === "generate" ? "创作中" : "开始创作"}
              </button>

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
                      : busy === "generate"
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
                    <div className="whitespace-pre-wrap text-[15px] leading-8 text-[#f8f1e4]">
                      {result.continuation || "正在生成..."}
                    </div>
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
                      {busy === "generate"
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
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.45fr)]">
            <section className="rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-4 shadow-[0_16px_45px_rgba(60,44,24,0.08)]">
              <div className="rounded-lg border border-[#171411] bg-white p-3">
                <label htmlFor="source-url" className="text-sm font-semibold text-[#3b3329]">知乎文章链接</label>
                <div className="mt-2 flex flex-col gap-2 md:flex-row">
                  <input
                    id="source-url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                    className="h-12 min-w-0 flex-1 rounded-lg border border-[#d8cdbc] bg-[#fffdf8] px-4 text-sm outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                    placeholder="https://www.zhihu.com/question/..."
                  />
                  <button
                    type="button"
                    onClick={loadPreview}
                    disabled={busy === "preview"}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#171411] px-4 text-sm font-semibold text-[#fffaf0] transition hover:bg-[#2d251d] disabled:opacity-60"
                  >
                    {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanText aria-hidden="true" />}
                    读取试读
                  </button>
                </div>
              </div>

              <label className="mt-4 flex flex-col gap-2">
                <span className="flex items-center justify-between gap-3 text-sm font-semibold text-[#3b3329]">
                  {preview ? preview.title : "用于炼化的样本文本"}
                  {preview ? (
                    <span className="rounded bg-[#171411] px-2 py-1 text-xs font-semibold text-[#fffaf0]">
                      {previewStatusLabel[preview.status]}
                    </span>
                  ) : null}
                </span>
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  className="min-h-[440px] resize-none rounded-lg border border-[#d8cdbc] bg-white px-4 py-3 text-sm leading-7 outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                  placeholder={
                    preview?.status === "paid_content" || preview?.status === "blocked"
                      ? "这里粘贴你已看到且有权使用的试读片段或已购可见片段。"
                      : "粘贴文本后炼化文风。"
                  }
                />
              </label>

              {preview ? (
                <p className="mt-2 text-xs leading-5 text-[#6f6558]">{preview.accessNote}</p>
              ) : null}

              <button
                type="button"
                onClick={refineAuthorStyle}
                disabled={busy === "style" || !sourceText}
                className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#171411] bg-white px-4 text-sm font-semibold disabled:opacity-50"
              >
                {busy === "style" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {analysis ? "重新炼化" : "炼化文风"}
              </button>

              {error ? (
                <div className="mt-3 flex gap-2 rounded-lg border border-[#f4c0b6] bg-[#fff0ed] p-3 text-sm leading-6 text-[#9f3728]">
                  <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />
                  {error}
                </div>
              ) : null}
            </section>

            <aside className="rounded-lg border border-[#171411] bg-[#171411] p-4 text-[#fffaf0]">
              <p className="text-sm font-semibold text-[#89b5ff]">当前文风</p>
              <h2 className="mt-2 text-xl font-semibold">{selectedStyle.label}</h2>
              <p className="mt-3 text-sm leading-6 text-[#d8cdbc]">{selectedStyle.summary}</p>

              {selectedStyle.provenance ? (
                <p className="mt-3 text-xs leading-5 text-[#c9bca8]">{selectedStyle.provenance}</p>
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

              {analysis ? (
                <div className="mt-5 border-t border-white/12 pt-4">
                  <p className="text-xs font-semibold text-[#89b5ff]">样本</p>
                  <div className="mt-3 grid gap-2">
                    {analysis.corpusPlan.samples
                      .filter((sample) => sample.selected)
                      .map((sample) => (
                        <span key={sample.id} className="rounded-md bg-white/10 px-2 py-1 text-xs text-[#d8cdbc]">
                          {sample.lengthClass === "long" ? "长文" : "短文"} · {sample.title}
                        </span>
                      ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 border-t border-white/12 pt-4">
                <p className="text-xs font-semibold text-[#89b5ff]">可选文风</p>
                <div className="mt-3 grid gap-2">
                  {styleOptions.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyleId(style.id)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-sm transition",
                        selectedStyle.id === style.id
                          ? "border-[#89b5ff] bg-[#29364a]"
                          : "border-white/12 bg-[#201b16] text-[#c9bca8]",
                      )}
                    >
                      <span className="font-semibold">{style.label}</span>
                      <span className="ml-2 text-[10px] text-[#c9bca8]">{styleSourceLabel[style.source]}</span>
                    </button>
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
