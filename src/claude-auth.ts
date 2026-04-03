import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const CLAUDE_CREDS_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

type ClaudeCredentials = {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
};

export type ClaudeAuth = {
  accessToken: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  expired: boolean;
};

/**
 * Read Claude Code OAuth credentials from ~/.claude/.credentials.json.
 * Returns null if not found or invalid.
 */
export async function readClaudeAuth(): Promise<ClaudeAuth | null> {
  try {
    const raw = await fs.readFile(CLAUDE_CREDS_PATH, "utf8");
    const data = JSON.parse(raw) as ClaudeCredentials;

    const oauth = data.claudeAiOauth;
    if (!oauth?.accessToken) return null;

    const expired = typeof oauth.expiresAt === "number" && oauth.expiresAt < Date.now();

    return {
      accessToken: oauth.accessToken,
      subscriptionType: oauth.subscriptionType,
      rateLimitTier: oauth.rateLimitTier,
      expired,
    };
  } catch {
    return null;
  }
}

/** Check if Claude credentials file exists */
export async function hasClaudeAuth(): Promise<boolean> {
  try {
    await fs.access(CLAUDE_CREDS_PATH);
    return true;
  } catch {
    return false;
  }
}
