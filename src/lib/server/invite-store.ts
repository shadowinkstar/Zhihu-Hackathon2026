import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type InviteRecord = {
  label: string;
  limit: number;
  used: number;
};

type InviteStore = {
  invitations: Record<string, InviteRecord>;
};

const storePath = path.join(process.cwd(), "data", "invites.json");

const defaultStore: InviteStore = {
  invitations: {
    "ZH-HACK-2026": {
      label: "黑客松内置模型额度",
      limit: 200,
      used: 0,
    },
    "DOGTAIL-DEMO": {
      label: "现场演示备用额度",
      limit: 80,
      used: 0,
    },
  },
};

async function readStore(): Promise<InviteStore> {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as InviteStore;
  } catch {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(defaultStore, null, 2), "utf8");
    return structuredClone(defaultStore);
  }
}

async function writeStore(store: InviteStore) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

export async function getInvite(code: string) {
  const store = await readStore();
  const normalized = code.trim().toUpperCase();
  const record = store.invitations[normalized];

  if (!record) {
    return null;
  }

  return {
    code: normalized,
    label: record.label,
    limit: record.limit,
    used: record.used,
    remaining: Math.max(record.limit - record.used, 0),
  };
}

export async function redeemInvite(code: string, consume: boolean) {
  const store = await readStore();
  const normalized = code.trim().toUpperCase();
  const record = store.invitations[normalized];

  if (!record) {
    return {
      ok: false as const,
      reason: "邀请码不存在",
    };
  }

  if (record.used >= record.limit) {
    return {
      ok: false as const,
      reason: "邀请码额度已用完",
      remaining: 0,
    };
  }

  if (consume) {
    record.used += 1;
    await writeStore(store);
  }

  return {
    ok: true as const,
    code: normalized,
    label: record.label,
    remaining: Math.max(record.limit - record.used, 0),
  };
}
