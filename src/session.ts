import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { VerifyHistoryEntry } from "./agent.js";

function getSessionsDir(): string {
  return path.join(os.homedir(), ".paw", "sessions");
}

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
  inputHistory?: string[];
  verifyHistory?: VerifyHistoryEntry[];
  writerId?: string;
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

export type SessionSearchMatch = {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  updatedAt: string;
  turns: number;
  preview: string;
  score: number;
  matchedSnippets: { role: SessionEntry["role"]; text: string }[];
};

async function ensureDir(): Promise<void> {
  await fs.mkdir(getSessionsDir(), { recursive: true });
}


function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const next = text.indexOf(needle, index);
    if (next === -1) break;
    count += 1;
    index = next + needle.length;
  }
  return count;
}

function buildSnippet(text: string, terms: string[], maxLength = 160): string {
  const lower = text.toLowerCase();
  let matchIndex = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
      matchIndex = idx;
    }
  }

  if (matchIndex === -1) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
}


export function createSessionId(): string {
  return randomUUID().slice(0, 8);
}

export async function saveSession(data: SessionData): Promise<void> {
  await ensureDir();
  const filePath = path.join(getSessionsDir(), `${data.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function loadSession(id: string): Promise<SessionData | null> {
  try {
    const filePath = path.join(getSessionsDir(), `${id}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function listSessions(limit = 10): Promise<SessionSummary[]> {
  await ensureDir();
  try {
    const files = await fs.readdir(getSessionsDir());
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(getSessionsDir(), file), "utf8");
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
    await fs.unlink(path.join(getSessionsDir(), `${id}.json`));
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
  const filePath = path.join(getSessionsDir(), `${id}.json`);
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

export async function searchSessions(query: string, limit = 5, excludeId?: string): Promise<SessionSearchMatch[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  await ensureDir();
  const terms = tokenizeQuery(trimmed);
  if (terms.length === 0) return [];

  try {
    const files = await fs.readdir(getSessionsDir());
    const matches: SessionSearchMatch[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(getSessionsDir(), file), 'utf8');
        const data = JSON.parse(raw) as SessionData;
        if (excludeId && data.id === excludeId) continue;

        let score = 0;
        const snippets: { role: SessionEntry['role']; text: string }[] = [];

        for (const entry of data.entries) {
          const lower = entry.text.toLowerCase();
          const termScore = terms.reduce((sum, term) => sum + countOccurrences(lower, term), 0);
          const exactPhraseBonus = lower.includes(trimmed.toLowerCase()) ? 3 : 0;
          const entryScore = termScore + exactPhraseBonus;
          if (entryScore <= 0) continue;
          score += entryScore;
          if (snippets.length < 3) {
            snippets.push({
              role: entry.role,
              text: buildSnippet(entry.text.replace(/\s+/g, ' ').trim(), terms),
            });
          }
        }

        if (score === 0) continue;

        const userEntries = data.entries.filter((entry) => entry.role === 'user');
        const lastUser = userEntries[userEntries.length - 1];
        matches.push({
          id: data.id,
          provider: data.provider,
          model: data.model,
          cwd: data.cwd,
          updatedAt: data.updatedAt,
          turns: userEntries.length,
          preview: lastUser?.text.slice(0, 60) ?? '(empty)',
          score,
          matchedSnippets: snippets,
        });
      } catch {
        continue;
      }
    }

    return matches
      .sort((a, b) => (b.score - a.score) || (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
      .slice(0, limit);
  } catch {
    return [];
  }
}
