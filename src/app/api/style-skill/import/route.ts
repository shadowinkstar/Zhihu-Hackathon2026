import { NextResponse } from "next/server";
import { z } from "zod";
import { remember } from "@/lib/server/memory-cache";

export const runtime = "nodejs";

const requestSchema = z.object({
  ref: z.string().trim().min(1, "请提供 Skill 链接或 slug"),
});

const skillImportTtlMs = 24 * 60 * 60 * 1000;

type SkillMaterial = {
  title: string;
  content: string;
  sourceRef: string;
  sourceType: "skill";
  trustNote: string;
};

function cleanText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function slugFromClawHubRef(ref: string) {
  if (!/^https?:\/\//i.test(ref)) {
    return ref.replace(/^clawhub:\/\//, "").trim();
  }

  try {
    const url = new URL(ref);
    if (!/clawhub\.ai$/i.test(url.hostname)) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const skillIndex = parts.findIndex((part) => part === "skills");
    return skillIndex >= 0 ? parts[skillIndex + 1] || null : parts.at(-1) || null;
  } catch {
    return null;
  }
}

function githubRawUrl(ref: string) {
  if (/^https:\/\/raw\.githubusercontent\.com\//i.test(ref)) {
    return ref;
  }

  try {
    const url = new URL(ref);
    if (!/github\.com$/i.test(url.hostname)) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const blobIndex = parts.findIndex((part) => part === "blob");
    if (parts.length >= 5 && blobIndex === 2) {
      const [owner, repo] = parts;
      const branch = parts[3];
      const path = parts.slice(4).join("/");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    }

    if (parts.length >= 2) {
      const [owner, repo] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 GouweiXudiaoBot/0.1",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`无法获取 Skill 内容（HTTP ${response.status}）`);
  }

  return cleanText(await response.text());
}

async function importFromClawHub(slug: string): Promise<SkillMaterial> {
  const response = await fetch(`https://clawhub.ai/api/v1/skills/${encodeURIComponent(slug)}`, {
    headers: {
      "user-agent": "Mozilla/5.0 GouweiXudiaoBot/0.1",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`无法读取 ClawHub Skill：${slug}`);
  }

  const data = (await response.json()) as {
    skill?: {
      slug?: string;
      displayName?: string;
      summary?: string;
      tags?: Record<string, string>;
      stats?: Record<string, number>;
    };
    latestVersion?: {
      version?: string;
      changelog?: string;
      license?: string | null;
    };
    owner?: {
      handle?: string;
      displayName?: string;
    };
    moderation?: {
      verdict?: string;
      isSuspicious?: boolean;
      isMalwareBlocked?: boolean;
      summary?: string;
    };
  };

  const skill = data.skill;
  if (!skill?.slug) {
    throw new Error("ClawHub 返回内容缺少 Skill 信息");
  }

  const title = skill.displayName || skill.slug;
  const content = [
    `# ${title}`,
    "",
    skill.summary || "",
    "",
    `slug: ${skill.slug}`,
    `version: ${data.latestVersion?.version || skill.tags?.latest || "latest"}`,
    `owner: ${data.owner?.displayName || data.owner?.handle || "unknown"}`,
    `license: ${data.latestVersion?.license || "unknown"}`,
    `moderation: ${data.moderation?.verdict || "unknown"}${data.moderation?.isSuspicious ? " / suspicious" : ""}${data.moderation?.isMalwareBlocked ? " / malware-blocked" : ""}`,
    "",
    data.latestVersion?.changelog ? `## Changelog\n${data.latestVersion.changelog}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    content: cleanText(content),
    sourceRef: `https://clawhub.ai/skills/${skill.slug}`,
    sourceType: "skill" as const,
    trustNote: data.moderation?.summary || "来自 ClawHub API，仍建议人工确认 Skill 内容和来源。",
  };
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Skill 链接格式不正确", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const ref = parsed.data.ref;

  try {
    const rawUrl = githubRawUrl(ref);
    if (rawUrl) {
      const material = await remember(`style-skill:import:github:${rawUrl}`, skillImportTtlMs, async () => {
        const content = await fetchText(rawUrl);
        return {
          title: rawUrl.split("/").slice(-2).join("/"),
          content,
          sourceRef: rawUrl,
          sourceType: "skill" as const,
          trustNote: "已从 GitHub 可访问的 SKILL.md/raw 链接读取内容。",
        };
      });
      return NextResponse.json({
        material,
      });
    }

    const slug = slugFromClawHubRef(ref);
    if (slug) {
      const material = await remember(`style-skill:import:clawhub:${slug}`, skillImportTtlMs, () =>
        importFromClawHub(slug),
      );
      return NextResponse.json({ material });
    }

    if (/^https?:\/\//i.test(ref)) {
      const material = await remember(`style-skill:import:url:${ref}`, skillImportTtlMs, async () => {
        const content = await fetchText(ref);
        return {
          title: new URL(ref).hostname,
          content,
          sourceRef: ref,
          sourceType: "skill" as const,
          trustNote: "已从用户提供的公开链接读取文本，请确认它确实是 Skill 内容。",
        };
      });
      return NextResponse.json({
        material,
      });
    }

    return NextResponse.json({ error: "暂不支持该 Skill 来源" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Skill 获取失败" },
      { status: 502 },
    );
  }
}
