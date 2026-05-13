import { NextResponse } from "next/server";
import { z } from "zod";
import { remember } from "@/lib/server/memory-cache";

export const runtime = "nodejs";

const requestSchema = z.object({
  query: z.string().trim().min(1, "请输入 Skill 搜索词"),
});

type SkillCandidate = {
  id: string;
  title: string;
  source: "clawhub" | "github";
  url: string;
  summary: string;
  trustNote: string;
};

const skillSearchTtlMs = 24 * 60 * 60 * 1000;

const curatedSkillCandidates: SkillCandidate[] = [
  {
    id: "curated-clawhub-writing-style-iterator",
    title: "Writing Style Iterator",
    source: "clawhub",
    url: "https://clawhub.ai/skills/writing-style-iterator",
    summary: "个性化写作风格记忆系统，会从修改和反馈中迭代写作风格规则。",
    trustNote: "预置 ClawHub 候选，适合做文风炼化材料；导入后仍由 Claude Code 二次总结。",
  },
  {
    id: "curated-clawhub-writing-style-cloner",
    title: "Writing Style Cloner - 个人写作风格克隆器",
    source: "clawhub",
    url: "https://clawhub.ai/skills/writing-style-cloner",
    summary: "把语音稿或草稿改写为指定个人写作风格的自媒体文章。",
    trustNote: "预置 ClawHub 候选，适合验证“已蒸馏 Skill 再炼化”的导入流程。",
  },
  {
    id: "curated-clawhub-observer-writing-style",
    title: "Observer Writing Style",
    source: "clawhub",
    url: "https://clawhub.ai/skills/observer-writing-style",
    summary: "偏权威思辨、理性克制、带反讽的评论型写作风格。",
    trustNote: "预置 ClawHub 候选，适合评论、读书笔记、社会观察类文风参考。",
  },
  {
    id: "curated-clawhub-writing-style-zhengliu",
    title: "Writing Style Zhengliu",
    source: "clawhub",
    url: "https://clawhub.ai/skills/writing-style-zhengliu",
    summary: "蒸馏式知识萃取写作风格，强调结构、信息密度和表达压缩。",
    trustNote: "预置 ClawHub 候选，适合提炼高密度表达和结构化叙事规则。",
  },
];

function uniqueCandidates(candidates: SkillCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

async function searchClawHub(query: string): Promise<SkillCandidate[]> {
  const response = await fetch(
    `https://clawhub.ai/api/v1/search?q=${encodeURIComponent(query)}&limit=8`,
    {
      headers: {
        "user-agent": "Mozilla/5.0 GouweiXudiaoBot/0.1",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    },
  );

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as {
    results?: Array<{
      slug?: string;
      displayName?: string;
      summary?: string;
      score?: number;
    }>;
  };

  return (data.results || [])
    .filter((item) => item.slug)
    .map((item) => ({
      id: `clawhub-${item.slug}`,
      title: item.displayName || item.slug || "ClawHub Skill",
      source: "clawhub" as const,
      url: `https://clawhub.ai/skills/${item.slug}`,
      summary: item.summary || "ClawHub Skill，详情需要打开后确认。",
      trustNote: `ClawHub 搜索匹配，score ${item.score?.toFixed(2) || "n/a"}。导入前仍需人工确认来源。`,
    }));
}

async function searchGitHub(query: string): Promise<SkillCandidate[]> {
  const searchQuery = `${query} SKILL.md agent skill writing style`;
  const response = await fetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&per_page=5`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "GouweiXudiaoBot/0.1",
      },
    },
  );

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: number;
      full_name: string;
      html_url: string;
      description?: string | null;
      stargazers_count?: number;
    }>;
  };

  return (data.items || []).map((item) => ({
    id: `github-${item.id}`,
    title: item.full_name,
    source: "github" as const,
    url: item.html_url,
    summary: item.description || "GitHub 仓库候选，需要确认其中是否包含 SKILL.md。",
    trustNote: `GitHub 仓库候选，stars ${item.stargazers_count ?? 0}。只会抓取可访问的 SKILL.md 文本。`,
  }));
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Skill 搜索输入不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const query = parsed.data.query;
  const candidates = await remember(
    `style-skill:search:${normalizeQuery(query)}`,
    skillSearchTtlMs,
    async () => {
      const [clawhub, github] = await Promise.all([
        searchClawHub(query),
        searchGitHub(query),
      ]);
      return uniqueCandidates([...curatedSkillCandidates, ...clawhub, ...github]).slice(0, 10);
    },
  );

  return NextResponse.json({
    candidates,
  });
}

export async function GET() {
  return NextResponse.json({
    candidates: curatedSkillCandidates,
  });
}
