import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");

type CodexAuth = {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
};

export type CodexCredentials = {
  accessToken: string;
  accountId?: string;
  authMode: string;
  email?: string;
};

/**
 * Read Codex CLI auth from ~/.codex/auth.json.
 * Returns null if not found or invalid.
 */
export async function readCodexAuth(): Promise<CodexCredentials | null> {
  try {
    const raw = await fs.readFile(CODEX_AUTH_PATH, "utf8");
    const data = JSON.parse(raw) as CodexAuth;

    // Prefer explicit API key if set
    if (data.OPENAI_API_KEY && typeof data.OPENAI_API_KEY === "string") {
      return {
        accessToken: data.OPENAI_API_KEY,
        authMode: "api_key",
      };
    }

    // Use OAuth access_token
    if (data.tokens?.access_token) {
      return {
        accessToken: data.tokens.access_token,
        accountId: data.tokens.account_id,
        authMode: data.auth_mode ?? "chatgpt",
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Check if codex auth file exists */
export async function hasCodexAuth(): Promise<boolean> {
  try {
    await fs.access(CODEX_AUTH_PATH);
    return true;
  } catch {
    return false;
  }
}
