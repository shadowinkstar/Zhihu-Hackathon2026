import { createHmac, randomUUID } from "node:crypto";

type ZhihuApiResponse<T> = {
  status: number;
  msg?: string;
  data: T | null;
};

type StoryListItem = {
  work_id: string;
  title: string;
  artwork?: string;
  tab_artwork?: string;
  description?: string;
  labels?: string[];
};

type StoryDetailItem = {
  work_id: string;
  chapter_name?: string;
  author_avatar?: string;
  author_name?: string;
  labels?: string[];
  introduction?: string;
  content?: string;
};

export type HackathonStorySummary = {
  workId: string;
  title: string;
  description: string;
  labels: string[];
  artwork?: string;
  tabArtwork?: string;
};

export type HackathonStoryDetail = {
  workId: string;
  chapterName: string;
  authorName: string;
  authorAvatar?: string;
  labels: string[];
  introduction: string;
  content: string;
};

const baseUrl = "https://openapi.zhihu.com";
const extraInfo = "";

function credentials() {
  const appKey = process.env.ZHIHU_APP_KEY;
  const appSecret = process.env.ZHIHU_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("缺少 ZHIHU_APP_KEY 或 ZHIHU_APP_SECRET");
  }

  return { appKey, appSecret };
}

function signedHeaders() {
  const { appKey, appSecret } = credentials();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const logId = `gouwei_${timestamp}_${randomUUID()}`;
  const signString = `app_key:${appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`;
  const sign = createHmac("sha256", appSecret).update(signString).digest("base64");

  return {
    "X-App-Key": appKey,
    "X-Timestamp": timestamp,
    "X-Log-Id": logId,
    "X-Sign": sign,
    "X-Extra-Info": extraInfo,
  };
}

async function zhihuGet<T>(path: string, searchParams?: Record<string, string>) {
  const url = new URL(path, baseUrl);
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    method: "GET",
    headers: signedHeaders(),
    cache: "no-store",
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `知乎 OpenAPI 返回 ${response.status}`);
  }

  const data = JSON.parse(body) as ZhihuApiResponse<T>;
  if (data.status !== 0) {
    throw new Error(data.msg || "知乎 OpenAPI 请求失败");
  }

  return data.data;
}

export async function listHackathonStories(): Promise<HackathonStorySummary[]> {
  const data = await zhihuGet<StoryListItem[]>("/openapi/hackathon_story/list");

  return (data || []).map((story) => ({
    workId: story.work_id,
    title: story.title,
    description: story.description || "",
    labels: story.labels || [],
    artwork: story.artwork,
    tabArtwork: story.tab_artwork,
  }));
}

export async function getHackathonStoryDetail(workId: string): Promise<HackathonStoryDetail> {
  const data = await zhihuGet<StoryDetailItem>("/openapi/hackathon_story/detail", {
    work_id: workId,
  });

  if (!data?.work_id || !data.content) {
    throw new Error("story not found");
  }

  return {
    workId: data.work_id,
    chapterName: data.chapter_name || "正文",
    authorName: data.author_name || "知乎作者",
    authorAvatar: data.author_avatar,
    labels: data.labels || [],
    introduction: data.introduction || "",
    content: data.content,
  };
}
