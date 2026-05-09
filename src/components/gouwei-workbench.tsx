"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Loader2,
  PenLine,
  ScanText,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ArticlePreview,
  ContinuationResult,
  NarrativeAnalysis,
  SourcePermission,
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

const builtinStyles: StyleProfile[] = [
  {
    id: "kimura-police-cut",
    label: "木村上村树",
    source: "builtin",
    summary: "日常独白、轻微跑题，最后把线索拐进王警官的扫黄现场。",
    prompt:
      "使用虚构的木村上村树式协作风格：平静日常、细节独白、突然离题、荒诞收束；可以把结尾转向王警官扫黄桥段，但不要模仿现实作者的受保护表达。",
  },
  {
    id: "yanxuan-suspense",
    label: "盐选悬疑",
    source: "builtin",
    summary: "高密度钩子、短段落反转，每段都推进一个新疑点。",
    prompt:
      "使用盐选悬疑式节奏：短段落、强钩子、信息逐层翻转，控制解释比例，每段都推进一个新疑点。",
  },
  {
    id: "zhihu-debater",
    label: "知乎嘴硬大V",
    source: "builtin",
    summary: "先下判断，再补论据，偶尔冷幽默拆台。",
    prompt:
      "使用知乎长文辩手式表达：先给判断，再给证据，夹带克制吐槽；保持故事推进，不写成纯议论文。",
  },
  {
    id: "urban-reversal",
    label: "都市反转",
    source: "builtin",
    summary: "压迫开局、身份错位，最后一句给爆点。",
    prompt:
      "使用都市反转爽感结构：开局压迫、信息误导、身份错位、结尾爆点；保持原创情节，不套用具体作品。",
  },
  {
    id: "confession-needle",
    label: "情感留刺",
    source: "builtin",
    summary: "第一人称回忆、细节递进，结尾留一个扎心钩子。",
    prompt:
      "使用情感倾诉式结构：第一人称可感细节、回忆递进、克制表达，结尾留下一个情绪钩子。",
  },
];

const arcs = [
  { id: "付费断口安全续写", label: "断口续写" },
  { id: "盐选题材互转", label: "题材互转" },
  { id: "多 Agent 圆桌改稿", label: "圆桌改稿" },
];

const styleSourceLabel = {
  neutral: "默认",
  analysis: "已炼化",
  builtin: "预设",
} satisfies Record<StyleProfile["source"], string>;

const previewStatusLabel = {
  public_preview: "已读取试读",
  paid_content: "盐选链接",
  blocked: "读取受限",
  manual_input: "手动导入",
} satisfies Record<ArticlePreview["status"], string>;

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

export function GouweiWorkbench() {
  const [sourceUrl, setSourceUrl] = useState(defaultUrl);
  const [sourceText, setSourceText] = useState("");
  const [permission, setPermission] = useState<SourcePermission>("public");
  const [preview, setPreview] = useState<ArticlePreview | null>(null);
  const [analysis, setAnalysis] = useState<NarrativeAnalysis | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState(neutralStyle.id);
  const [styleIntensity, setStyleIntensity] = useState(48);
  const [selectedArc, setSelectedArc] = useState(arcs[0].id);
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

  const styleOptions = useMemo(() => {
    const analyzed = analysis ? [analysis.styleProfile] : [];
    return [neutralStyle, ...analyzed, ...builtinStyles];
  }, [analysis]);

  const selectedStyle =
    styleOptions.find((style) => style.id === selectedStyleId) || neutralStyle;

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
        permission,
      });
      setAnalysis(nextAnalysis);
      setSelectedStyleId(nextAnalysis.styleProfile.id);
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
      permission,
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

  async function generateContinuation() {
    setBusy("generate");
    setError(null);

    try {
      const currentAnalysis = await ensureAnalysis();
      setAnalysis(currentAnalysis);
      const nextResult = await postJson<ContinuationResult>("/api/generate", {
        analysis: currentAnalysis,
        sourceText,
        selectedArc,
        styleProfile: selectedStyle,
        length,
        styleIntensity,
        access:
          accessMode === "invite"
            ? { mode: "invite", inviteCode }
            : { mode: "custom", endpoint, apiKey, model },
      });
      setResult(nextResult);
      if (typeof nextResult.usage.quotaRemaining === "number") {
        setInviteStatus(`剩余 ${nextResult.usage.quotaRemaining} 次`);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "生成失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f2ecdf] text-[#171411]">
      <header className="border-b border-[#dfd3c2] bg-[#f7f1e7]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-[#171411] text-[#fffaf0]">
              <PenLine aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-[#6f6558]">知乎 Hackathon 2026</p>
              <h1 className="text-2xl font-semibold leading-none">狗尾续貂？</h1>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-2 lg:min-w-[430px]">
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
                  className="h-10 min-w-0 flex-1 rounded-md border border-[#d8cdbc] bg-white px-3 text-sm uppercase outline-none focus:border-[#176bff]"
                />
                <button
                  type="button"
                  onClick={checkInvite}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#176bff] px-3 text-sm font-semibold text-white"
                >
                  {busy === "invite" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
                  {inviteStatus || "查额度"}
                </button>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-[1fr_130px_1fr]">
                <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className="h-10 rounded-md border border-[#d8cdbc] px-3 text-sm outline-none" placeholder="Endpoint" />
                <input value={model} onChange={(event) => setModel(event.target.value)} className="h-10 rounded-md border border-[#d8cdbc] px-3 text-sm outline-none" placeholder="模型" />
                <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="h-10 rounded-md border border-[#d8cdbc] px-3 text-sm outline-none" type="password" placeholder="API Key" />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
          <section className="rounded-lg border border-[#d8cdbc] bg-[#fffaf0] p-4 shadow-[0_18px_60px_rgba(60,44,24,0.08)] md:p-5">
            <div className="rounded-lg border border-[#171411] bg-white p-3">
              <label htmlFor="source-url" className="text-sm font-semibold text-[#3b3329]">知乎文章链接</label>
              <div className="mt-2 flex flex-col gap-2 md:flex-row">
                <input
                  id="source-url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  className="h-14 min-w-0 flex-1 rounded-lg border border-[#d8cdbc] bg-[#fffdf8] px-4 text-base outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                  placeholder="https://www.zhihu.com/question/..."
                />
                <button
                  type="button"
                  onClick={loadPreview}
                  disabled={busy === "preview"}
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-[#171411] px-5 text-sm font-semibold text-[#fffaf0] transition hover:bg-[#2d251d] disabled:opacity-60"
                >
                  {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanText aria-hidden="true" />}
                  展示试看片段
                </button>
              </div>
            </div>

            <AnimatePresence mode="wait">
              {busy === "preview" ? (
                <motion.div
                  key="loading-preview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 rounded-lg border border-[#d8cdbc] bg-[#f8f2e8] p-4"
                >
                  <div className="flex items-center gap-3 text-sm font-semibold">
                    <span className="relative flex size-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#176bff] opacity-75" />
                      <span className="relative inline-flex size-3 rounded-full bg-[#176bff]" />
                    </span>
                    正在读取公开信息和试看片段
                  </div>
                  <div className="mt-4 grid gap-2">
                    <div className="h-3 w-2/3 rounded bg-[#dfd3c2]" />
                    <div className="h-3 w-full rounded bg-[#e9dece]" />
                    <div className="h-3 w-5/6 rounded bg-[#e9dece]" />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="mt-4 grid gap-3">
              <div className="flex flex-wrap gap-2">
                {([
                  ["public", "公开片段"],
                  ["self_owned", "我的草稿"],
                  ["authorized", "已授权"],
                ] as Array<[SourcePermission, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPermission(value)}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                      permission === value
                        ? "border-[#176bff] bg-[#eaf2ff] text-[#17488f]"
                        : "border-[#d8cdbc] bg-white text-[#6f6558]",
                    )}
                  >
                    {permission === value ? <Check aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
                    {label}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-2">
                  <span className="flex items-center justify-between gap-3 text-sm font-semibold text-[#3b3329]">
                    {preview ? preview.title : "试看片段 / 自有草稿"}
                    {preview ? (
                      <span className="rounded bg-[#171411] px-2 py-1 text-xs font-semibold text-[#fffaf0]">
                        {previewStatusLabel[preview.status]}
                      </span>
                    ) : null}
                  </span>
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  className="min-h-72 resize-none rounded-lg border border-[#d8cdbc] bg-white px-4 py-3 text-sm leading-7 outline-none transition focus:border-[#176bff] focus:ring-2 focus:ring-[#176bff]/15"
                  placeholder={
                    preview?.status === "paid_content" || preview?.status === "blocked"
                      ? "这里粘贴你已看到且有权使用的试读片段或已购可见片段。"
                      : "点“展示试看片段”，或直接粘贴你有权使用的正文片段。"
                  }
                />
              </label>

              {preview ? (
                <p className="text-xs leading-5 text-[#6f6558]">{preview.accessNote}</p>
              ) : null}
            </div>

            <div className="mt-5 rounded-lg border border-[#d8cdbc] bg-[#f8f2e8] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold">可选：炼化作者文风</p>
                  <p className="mt-1 text-xs leading-5 text-[#6f6558]">
                    只在你需要贴近作者公开近作时开启。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={refineAuthorStyle}
                  disabled={busy === "style" || !sourceText}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#171411] bg-white px-3 text-sm font-semibold disabled:opacity-50"
                >
                  {busy === "style" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {analysis ? "重新炼化" : "炼化作者文风"}
                </button>
              </div>
              {analysis ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {analysis.corpusPlan.samples
                    .filter((sample) => sample.selected)
                    .map((sample) => (
                      <span key={sample.id} className="rounded-md bg-white px-2 py-1 text-xs text-[#6f6558]">
                        {sample.lengthClass === "long" ? "长文" : "短文"} · {sample.title}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border border-[#171411] bg-[#171411] p-4 text-[#fffaf0] shadow-[0_18px_60px_rgba(23,20,17,0.18)] md:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#89b5ff]">生成区</p>
                <h3 className="mt-1 text-2xl font-semibold">选文风，续下去</h3>
              </div>
              <Wand2 aria-hidden="true" className="text-[#9ad7b2]" />
            </div>

            <div className="mt-5">
              <p className="text-xs font-semibold text-[#89b5ff]">文风</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {styleOptions.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setSelectedStyleId(style.id)}
                    className={cn(
                      "min-h-24 rounded-lg border p-3 text-left transition",
                      selectedStyle.id === style.id
                        ? "border-[#89b5ff] bg-[#29364a]"
                        : "border-white/12 bg-[#201b16] hover:border-white/30",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                      <span className="min-w-0">
                        {style.label}
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-[#c9bca8]">
                          {styleSourceLabel[style.source]}
                        </span>
                      </span>
                      {selectedStyle.id === style.id ? <Check aria-hidden="true" className="text-[#9ad7b2]" /> : null}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-[#c9bca8]">{style.summary}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-t border-white/12 pt-5">
              <div>
                <p className="text-xs font-semibold text-[#89b5ff]">方向</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {arcs.map((arc) => (
                    <button
                      key={arc.id}
                      type="button"
                      onClick={() => setSelectedArc(arc.id)}
                      className={cn(
                        "h-10 rounded-md border text-sm font-semibold transition",
                        selectedArc === arc.id
                          ? "border-[#89b5ff] bg-[#29364a]"
                          : "border-white/12 bg-[#201b16] text-[#c9bca8]",
                      )}
                    >
                      {arc.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">篇幅</span>
                  <select
                    value={length}
                    onChange={(event) => setLength(event.target.value as "short" | "medium" | "long")}
                    className="h-11 rounded-lg border border-white/12 bg-[#201b16] px-3 text-sm outline-none focus:border-[#89b5ff]"
                  >
                    <option value="short">短：快速试写</option>
                    <option value="medium">中：完整片段</option>
                    <option value="long">长：章节草稿</option>
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">文风强度 {styleIntensity}</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={styleIntensity}
                    onChange={(event) => setStyleIntensity(Number(event.target.value))}
                    className="h-11 accent-[#89b5ff]"
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={generateContinuation}
              disabled={busy === "generate" || !sourceText}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#176bff] px-4 text-sm font-semibold text-white transition hover:bg-[#0f58d6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "generate" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
              开始续写
            </button>

            {error ? (
              <div className="mt-3 flex gap-2 rounded-lg border border-[#f4c0b6] bg-[#fff0ed] p-3 text-sm leading-6 text-[#9f3728]">
                <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" />
                {error}
              </div>
            ) : null}

            <AnimatePresence mode="wait">
              {result ? (
                <motion.article
                  key={result.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.28 }}
                  className="mt-5 rounded-lg border border-white/12 bg-[#201b16] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base font-semibold">{result.title}</h3>
                    <ExternalLink aria-hidden="true" className="shrink-0 text-[#89b5ff]" />
                  </div>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#f8f1e4]">
                    {result.continuation}
                  </div>
                </motion.article>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-5 min-h-72 rounded-lg border border-white/12 bg-[#201b16] p-4"
                >
                  <div className="flex items-center gap-2 text-[#89b5ff]">
                    <Sparkles aria-hidden="true" />
                    <span className="text-sm font-semibold">续写预览</span>
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-[#d8cdbc]">
                    读取试看片段后，选择一个文风即可生成。
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-4 flex gap-2 text-xs leading-5 text-[#c9bca8]">
              <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[#9ad7b2]" />
              公开信息、自有草稿、授权片段；发布保留 AI 声明、原文跳转和下架入口。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
