import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SafetyCheck = {
  level: RiskLevel;
  tool: string;
  reason: string;
  requiresConfirm: boolean;
  autoCheckpoint: boolean;
};

export type SafetyConfig = {
  enabled: boolean;
  autoCheckpoint: boolean;
  blockCritical: boolean;
  onPrompt?: import("./types.js").UserPromptCallback;
};

// LOW risk patterns — read-only tools
const LOW_RISK_TOOLS = new Set(["list_files", "read_file", "search_text", "glob", "web_fetch"]);

// MEDIUM risk tools — file modification
const MEDIUM_RISK_TOOLS = new Set(["write_file", "edit_file"]);

// CRITICAL patterns — must block entirely
const CRITICAL_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f?\s+\/[^/\s]{0,3}(?:\s|$)/i, // rm -rf / or near-root paths
  /rm\s+-[a-z]*f[a-z]*r?\s+\/[^/\s]{0,3}(?:\s|$)/i,
  /mkfs/i,
  /dd\s+if=/i,
  /:\(\)\s*\{/,                            // fork bomb
  /shutdown/i,
  /reboot/i,
  />\s*\/dev\/sd/i,
  /curl[^|]*\|\s*(?:ba)?sh/i,
  /wget[^|]*\|\s*(?:ba)?sh/i,
];

// HIGH risk patterns — dangerous but potentially legitimate
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\b/i,                               // any rm
  /git\s+reset/i,
  /git\s+checkout\s+--\s*\./i,
  /git\s+clean/i,
  /drop\s+table/i,
  /delete\s+from/i,
  /truncate\s+/i,
  /docker\s+rm\b/i,
  /docker\s+rmi\b/i,
  /docker\s+system\s+prune/i,
  /npm\s+publish/i,
  /yarn\s+publish/i,
  /terraform\s+destroy/i,
  /terraform\s+apply/i,
  /kubectl\s+delete/i,
  /helm\s+uninstall/i,
  /chmod\s+.*\/(?:etc|usr|bin|sbin|lib|var|sys|proc)/i,
  /chown\s+.*\/(?:etc|usr|bin|sbin|lib|var|sys|proc)/i,
  /(?:rm|del|delete|remove|drop|destroy|prune|clean|reset|wipe|clear)\b.*(?:--force|-f)\b/i,
  /(?:--force|-f)\b.*(?:rm|del|delete|remove|drop|destroy|prune|clean|reset|wipe|clear)\b/i,
];

export function classifyRisk(toolName: string, input: Record<string, unknown>): SafetyCheck {
  // Read-only tools
  if (LOW_RISK_TOOLS.has(toolName)) {
    return { level: "low", tool: toolName, reason: "Read-only operation with no side effects", requiresConfirm: false, autoCheckpoint: false };
  }

  // File modification tools
  if (MEDIUM_RISK_TOOLS.has(toolName)) {
    return { level: "medium", tool: toolName, reason: "Modifies files but reversible", requiresConfirm: false, autoCheckpoint: false };
  }

  // Shell command classification
  if (toolName === "run_shell") {
    const command = typeof input.command === "string" ? input.command : "";

    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(command)) {
        return {
          level: "critical",
          tool: toolName,
          reason: `Command matches critical risk pattern: ${pattern.source}`,
          requiresConfirm: false,
          autoCheckpoint: false,
        };
      }
    }

    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(command)) {
        return {
          level: "high",
          tool: toolName,
          reason: `Command matches high risk pattern: "${command}"`,
          requiresConfirm: true,
          autoCheckpoint: true,
        };
      }
    }

    // Unmatched shell command — medium risk
    return { level: "medium", tool: toolName, reason: "Shell command with no destructive patterns detected", requiresConfirm: false, autoCheckpoint: false };
  }

  // Unknown tools — treat as medium
  return { level: "medium", tool: toolName, reason: "Unknown tool", requiresConfirm: false, autoCheckpoint: false };
}

export async function createCheckpoint(cwd: string): Promise<{ ok: boolean; stashRef?: string; error?: string }> {
  try {
    // Only stash if inside a git repo
    await execAsync("git rev-parse --is-inside-work-tree", { cwd });
    const { stdout } = await execAsync('git stash push -m "paw-safety-checkpoint"', { cwd });
    const ref = stdout.trim();
    return { ok: true, stashRef: ref };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function restoreCheckpoint(cwd: string, stashRef: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execAsync(`git stash pop ${stashRef}`, { cwd });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
