import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContinuationResult, GenerationMode, GenerationRecord, StyleProfile, ZhihuUser } from "@/lib/types";

type UserRecord = ZhihuUser & {
  zhihuId: string;
  createdAt: string;
  updatedAt: string;
};

type SessionRecord = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

type LoginTicketRecord = {
  id: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
};

type OAuthReturnOriginRecord = {
  origin: string;
  createdAt: string;
  expiresAt: string;
};

type UserStore = {
  users: Record<string, UserRecord>;
  sessions: Record<string, SessionRecord>;
  loginTickets: Record<string, LoginTicketRecord>;
  oauthReturnOrigin?: OAuthReturnOriginRecord;
  stylesByUser: Record<string, StyleProfile[]>;
  generationsByUser: Record<string, GenerationRecord[]>;
};

const storePath = path.join(process.cwd(), "data", "users.json");

const emptyStore: UserStore = {
  users: {},
  sessions: {},
  loginTickets: {},
  stylesByUser: {},
  generationsByUser: {},
};

async function readStore(): Promise<UserStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    return { ...emptyStore, ...(JSON.parse(raw) as UserStore) };
  } catch {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeStore(emptyStore);
    return structuredClone(emptyStore);
  }
}

async function writeStore(store: UserStore) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

export async function upsertZhihuUser(input: {
  zhihuId: string;
  name: string;
  avatarUrl?: string;
  urlToken?: string;
}) {
  const store = await readStore();
  const existing = Object.values(store.users).find((user) => user.zhihuId === input.zhihuId);
  const now = new Date().toISOString();
  const user: UserRecord = {
    id: existing?.id || crypto.randomUUID(),
    zhihuId: input.zhihuId,
    name: input.name || existing?.name || "知乎用户",
    avatarUrl: input.avatarUrl || existing?.avatarUrl,
    urlToken: input.urlToken || existing?.urlToken,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  store.users[user.id] = user;
  store.stylesByUser[user.id] ||= [];
  store.generationsByUser[user.id] ||= [];
  await writeStore(store);
  return user;
}

export async function createUserSession(userId: string, maxAgeSeconds: number) {
  const store = await readStore();
  const now = Date.now();
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAgeSeconds * 1000).toISOString(),
  };
  store.sessions[session.id] = session;
  await writeStore(store);
  return session;
}

export async function createLoginTicket(sessionId: string, maxAgeSeconds = 60) {
  const store = await readStore();
  const now = Date.now();
  const ticket: LoginTicketRecord = {
    id: crypto.randomUUID(),
    sessionId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAgeSeconds * 1000).toISOString(),
  };
  store.loginTickets[ticket.id] = ticket;
  await writeStore(store);
  return ticket;
}

export async function consumeLoginTicket(ticketId?: string | null) {
  if (!ticketId) {
    return null;
  }

  const store = await readStore();
  const ticket = store.loginTickets[ticketId];
  if (!ticket) {
    return null;
  }

  delete store.loginTickets[ticketId];
  const expired = new Date(ticket.expiresAt).getTime() <= Date.now();
  if (expired || !store.sessions[ticket.sessionId]) {
    await writeStore(store);
    return null;
  }

  await writeStore(store);
  return ticket.sessionId;
}

export async function saveOAuthReturnOrigin(origin: string, maxAgeSeconds = 10 * 60) {
  const store = await readStore();
  const now = Date.now();
  store.oauthReturnOrigin = {
    origin,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + maxAgeSeconds * 1000).toISOString(),
  };
  await writeStore(store);
}

export async function consumeOAuthReturnOrigin() {
  const store = await readStore();
  const record = store.oauthReturnOrigin;
  delete store.oauthReturnOrigin;
  await writeStore(store);
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  return record.origin;
}

export async function getSessionUser(sessionId?: string | null) {
  if (!sessionId) {
    return null;
  }

  const store = await readStore();
  const session = store.sessions[sessionId];
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    if (session) {
      delete store.sessions[sessionId];
      await writeStore(store);
    }
    return null;
  }

  return store.users[session.userId] || null;
}

export async function deleteUserSession(sessionId?: string | null) {
  if (!sessionId) {
    return;
  }

  const store = await readStore();
  delete store.sessions[sessionId];
  await writeStore(store);
}

export async function getUserWorkspace(userId: string) {
  const store = await readStore();
  return {
    styles: store.stylesByUser[userId] || [],
    generations: store.generationsByUser[userId] || [],
  };
}

export async function saveUserStyle(userId: string, style: StyleProfile) {
  const store = await readStore();
  const styles = store.stylesByUser[userId] || [];
  store.stylesByUser[userId] = [style, ...styles.filter((item) => item.id !== style.id)].slice(0, 60);
  await writeStore(store);
  return style;
}

export async function deleteUserStyle(userId: string, styleId: string) {
  const store = await readStore();
  store.stylesByUser[userId] = (store.stylesByUser[userId] || []).filter((style) => style.id !== styleId);
  await writeStore(store);
}

export async function saveGenerationRecord(
  userId: string,
  result: ContinuationResult,
  meta?: {
    sourceTitle?: string;
    selectedArc?: string;
    styleLabel?: string;
    mode?: GenerationMode;
  },
) {
  const store = await readStore();
  const record: GenerationRecord = {
    id: result.id,
    createdAt: result.createdAt,
    title: result.title,
    continuation: result.continuation,
    sourceTitle: meta?.sourceTitle,
    selectedArc: meta?.selectedArc,
    styleLabel: meta?.styleLabel,
    mode: meta?.mode || result.usage.mode,
    provider: result.usage.provider,
    model: result.usage.model,
  };
  const records = store.generationsByUser[userId] || [];
  store.generationsByUser[userId] = [record, ...records.filter((item) => item.id !== record.id)].slice(0, 100);
  await writeStore(store);
  return record;
}
