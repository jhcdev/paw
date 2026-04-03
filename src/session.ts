import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const SESSIONS_DIR = path.join(os.homedir(), ".cats-claw", "sessions");

export type SessionEntry = {
  role: "system" | "user" | "assistant";
  text: string;
  timestamp: string;
};

export type SessionData = {
  id: string;
  provider: string;
  model: string;
  mode: "solo" | "team";
  cwd: string;
  createdAt: string;
  updatedAt: string;
  entries: SessionEntry[];
};

export type SessionSummary = {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  updatedAt: string;
  turns: number;
  preview: string;
};

async function ensureDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

export function createSessionId(): string {
  return randomUUID().slice(0, 8);
}

export async function saveSession(data: SessionData): Promise<void> {
  await ensureDir();
  const filePath = path.join(SESSIONS_DIR, `${data.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function listSessions(limit = 10): Promise<SessionSummary[]> {
  await ensureDir();
  try {
    const files = await fs.readdir(SESSIONS_DIR);
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(SESSIONS_DIR, file), "utf8");
        const data = JSON.parse(raw) as SessionData;
        const userEntries = data.entries.filter((e) => e.role === "user");
        const lastUser = userEntries[userEntries.length - 1];
        sessions.push({
          id: data.id,
          provider: data.provider,
          model: data.model,
          cwd: data.cwd,
          updatedAt: data.updatedAt,
          turns: userEntries.length,
          preview: lastUser?.text.slice(0, 60) ?? "(empty)",
        });
      } catch { continue; }
    }

    return sessions
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function getLastSessionId(): Promise<string | null> {
  const sessions = await listSessions(1);
  return sessions[0]?.id ?? null;
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(SESSIONS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

/** Watch a session file for changes (from other terminals) — instant via fs.watch */
export function watchSession(
  id: string,
  onChange: (data: SessionData) => void,
): () => void {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastContent = "";

  const reload = async () => {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      if (raw !== lastContent) {
        lastContent = raw;
        onChange(JSON.parse(raw) as SessionData);
      }
    } catch {}
  };

  try {
    const { watch } = require("node:fs") as typeof import("node:fs");
    const watcher = watch(filePath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(reload, 50); // 50ms debounce to batch rapid writes
    });
    return () => { watcher.close(); if (debounce) clearTimeout(debounce); };
  } catch {
    // Fallback to polling if fs.watch fails
    const interval = setInterval(reload, 500);
    return () => clearInterval(interval);
  }
}

/** Append an entry to a session file atomically */
export async function appendToSession(id: string, entry: SessionEntry): Promise<void> {
  const data = await loadSession(id);
  if (!data) return;
  data.entries.push(entry);
  data.updatedAt = new Date().toISOString();
  await saveSession(data);
}
