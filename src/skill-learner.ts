/**
 * Cross-session skill learner — Hermes-inspired procedural memory
 * with self-correcting confidence tracking.
 *
 * Every successful auto-agent task is recorded in ~/.paw/learned-tasks.json.
 * Each learned task carries a confidence score (0–1):
 *   - Starts at 1.0 on first record
 *   - +0.1 per future success on a similar task (cap 1.0)
 *   - -0.3 per future failure on a similar task
 *   - Pruned (deleted) when confidence drops below PRUNE_THRESHOLD
 *
 * When a prompt arrives, relevant high-confidence past tasks are injected
 * as cross-session context. After AUTO_SKILL_THRESHOLD high-confidence
 * similar tasks, a global skill is auto-created in ~/.paw/skills/.
 * If that skill's backing tasks decay below SKILL_DELETE_THRESHOLD,
 * the skill file is automatically deleted.
 *
 * Manual controls:
 *   /forget <skill-name>        — delete a named skill + its backing tasks
 *   /forget --category <cat>    — prune all tasks for a category
 *   /forget --all               — wipe the entire learned store
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ProblemCategory } from "./problem-classifier.js";

const LEARNED_TASKS_PATH = path.join(os.homedir(), ".paw", "learned-tasks.json");
const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".paw", "skills");

const AUTO_SKILL_THRESHOLD = 3;   // similar successes before auto-creating a skill
const PRUNE_THRESHOLD = 0.15;     // tasks below this confidence are deleted
const SKILL_DELETE_THRESHOLD = 2; // delete skill file when fewer than this backing tasks remain
const MAX_STORED_TASKS = 300;
const SIMILARITY_THRESHOLD = 0.15;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LearnedTask = {
  id: string;
  goal: string;
  summary: string;
  category: ProblemCategory;
  keywords: string[];
  timestamp: string;
  projectDir: string;
  confidence: number;   // 0–1; starts at 1.0, adjusted by outcome feedback
  successCount: number;
  failCount: number;
  autoSkillName?: string; // set when this task contributed to an auto-skill
};

type Store = {
  version: 1;
  tasks: LearnedTask[];
};

export type RecordResult = {
  autoSkillName?: string;
  matchCount: number;
};

export type ForgetResult = {
  tasksRemoved: number;
  skillsDeleted: string[];
};

// ── Persistence ───────────────────────────────────────────────────────────────

async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(LEARNED_TASKS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
    // Migrate tasks that lack confidence fields (from older store format)
    for (const t of parsed.tasks) {
      if (t.confidence === undefined) t.confidence = 1.0;
      if (t.successCount === undefined) t.successCount = 1;
      if (t.failCount === undefined) t.failCount = 0;
    }
    return parsed;
  } catch {
    return { version: 1, tasks: [] };
  }
}

async function saveStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(LEARNED_TASKS_PATH), { recursive: true });
  await fs.writeFile(LEARNED_TASKS_PATH, JSON.stringify(store, null, 2), "utf8");
}

// ── Text utilities ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "with", "that", "this", "from", "have", "will", "when", "then", "into",
  "some", "what", "where", "which", "there", "their", "they", "your", "more",
  "also", "just", "been", "were", "does", "would", "could", "should",
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    .slice(0, 20);
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let intersection = 0;
  for (const w of b) if (setA.has(w)) intersection++;
  const union = setA.size + b.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isSimilar(task: LearnedTask, category: ProblemCategory, keywords: string[]): boolean {
  return task.category === category && jaccardSimilarity(task.keywords, keywords) >= SIMILARITY_THRESHOLD;
}

// ── Skill file helpers ────────────────────────────────────────────────────────

async function deleteSkillFile(skillName: string): Promise<boolean> {
  const skillPath = path.join(GLOBAL_SKILLS_DIR, `${skillName}.md`);
  try {
    await fs.unlink(skillPath);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a successfully completed auto-agent task.
 * High-confidence patterns above AUTO_SKILL_THRESHOLD trigger auto-skill creation.
 */
export async function recordLearnedTask(
  goal: string,
  summary: string,
  category: ProblemCategory,
  projectDir: string,
): Promise<RecordResult> {
  const store = await loadStore();
  const keywords = extractKeywords(goal);

  // Count high-confidence similar past tasks
  const similar = store.tasks.filter(
    (t) => isSimilar(t, category, keywords) && t.confidence >= 0.5,
  );

  const task: LearnedTask = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    goal: goal.slice(0, 400),
    summary: summary.slice(0, 500),
    category,
    keywords,
    timestamp: new Date().toISOString(),
    projectDir,
    confidence: 1.0,
    successCount: 1,
    failCount: 0,
  };

  store.tasks.push(task);
  if (store.tasks.length > MAX_STORED_TASKS) {
    store.tasks = store.tasks.slice(-MAX_STORED_TASKS);
  }

  await saveStore(store);

  const matchCount = similar.length + 1;

  if (matchCount >= AUTO_SKILL_THRESHOLD) {
    const baseKeyword = keywords[0] ?? "task";
    const autoSkillName = `auto-${category}-${baseKeyword}`
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 32);
    // Tag backing tasks with the skill name so we can prune them later
    for (const t of similar) {
      if (!t.autoSkillName) t.autoSkillName = autoSkillName;
    }
    task.autoSkillName = autoSkillName;
    await saveStore(store);
    return { autoSkillName, matchCount };
  }

  return { matchCount };
}

/**
 * Feed outcome back into learned tasks so the store self-corrects.
 *
 * "success" → +0.1 confidence on matching tasks (cap 1.0)
 * "failure" → -0.3 confidence on matching tasks; prune below PRUNE_THRESHOLD;
 *             if a skill's backing tasks drop to fewer than SKILL_DELETE_THRESHOLD, delete the skill
 *
 * Returns names of any auto-skills that were deleted.
 */
export async function updateTaskOutcome(
  goal: string,
  category: ProblemCategory,
  outcome: "success" | "failure",
): Promise<string[]> {
  const store = await loadStore();
  const keywords = extractKeywords(goal);
  const deletedSkills: string[] = [];

  for (const task of store.tasks) {
    if (!isSimilar(task, category, keywords)) continue;

    if (outcome === "success") {
      task.successCount += 1;
      task.confidence = Math.min(1.0, task.confidence + 0.1);
    } else {
      task.failCount += 1;
      task.confidence = Math.max(0, task.confidence - 0.3);
    }
  }

  // Prune low-confidence tasks
  const pruned = store.tasks.filter((t) => t.confidence < PRUNE_THRESHOLD);
  store.tasks = store.tasks.filter((t) => t.confidence >= PRUNE_THRESHOLD);

  // Check if any auto-skill lost too many backing tasks
  const affectedSkills = new Set(pruned.map((t) => t.autoSkillName).filter(Boolean) as string[]);
  for (const skillName of affectedSkills) {
    const remaining = store.tasks.filter((t) => t.autoSkillName === skillName && t.confidence >= 0.5).length;
    if (remaining < SKILL_DELETE_THRESHOLD) {
      const deleted = await deleteSkillFile(skillName);
      if (deleted) deletedSkills.push(skillName);
      // Untag backing tasks so they can contribute to a future skill if they recover
      for (const t of store.tasks) {
        if (t.autoSkillName === skillName) t.autoSkillName = undefined;
      }
    }
  }

  await saveStore(store);
  return deletedSkills;
}

/**
 * Find past tasks relevant to the current prompt.
 * Only returns tasks with confidence >= 0.4 to avoid poisoning context with bad patterns.
 */
export async function findRelevantTasks(
  goal: string,
  category: ProblemCategory,
  limit = 3,
): Promise<LearnedTask[]> {
  const store = await loadStore();
  if (store.tasks.length === 0) return [];

  const keywords = extractKeywords(goal);

  return store.tasks
    .filter((t) => t.confidence >= 0.4) // only high-confidence patterns
    .map((t) => ({
      task: t,
      score:
        (t.category === category ? 0.4 : 0) +
        jaccardSimilarity(t.keywords, keywords) * 0.6,
    }))
    .filter((x) => x.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.task);
}

/**
 * Auto-create a global skill in ~/.paw/skills/.
 * Skips silently if the skill already exists (don't overwrite user edits).
 */
export async function autoCreateSkill(
  skillName: string,
  goal: string,
  category: ProblemCategory,
): Promise<string> {
  await fs.mkdir(GLOBAL_SKILLS_DIR, { recursive: true });
  const skillPath = path.join(GLOBAL_SKILLS_DIR, `${skillName}.md`);

  try {
    await fs.access(skillPath);
    return skillPath; // already exists
  } catch {
    // create it
  }

  const content = [
    "---",
    `name: ${skillName}`,
    `description: Auto-learned from repeated ${category} tasks`,
    "---",
    "",
    goal.slice(0, 400),
  ].join("\n");

  await fs.writeFile(skillPath, content, "utf8");
  return skillPath;
}

/**
 * Forget learned tasks and auto-skills.
 *
 * /forget <skill-name>         — delete skill file + backing tasks
 * /forget --category <cat>     — remove all tasks for that category
 * /forget --all                — wipe the entire learned store
 */
export async function forgetLearned(spec: string): Promise<ForgetResult> {
  const store = await loadStore();
  const skillsDeleted: string[] = [];
  let tasksRemoved = 0;

  if (spec === "--all") {
    tasksRemoved = store.tasks.length;
    // Delete all auto-created skill files referenced in the store
    const skillNames = new Set(store.tasks.map((t) => t.autoSkillName).filter(Boolean) as string[]);
    for (const name of skillNames) {
      if (await deleteSkillFile(name)) skillsDeleted.push(name);
    }
    store.tasks = [];
  } else if (spec.startsWith("--category ")) {
    const cat = spec.slice("--category ".length).trim() as ProblemCategory;
    const removed = store.tasks.filter((t) => t.category === cat);
    tasksRemoved = removed.length;
    // Delete auto-skills that had no surviving tasks
    const skillNames = new Set(removed.map((t) => t.autoSkillName).filter(Boolean) as string[]);
    store.tasks = store.tasks.filter((t) => t.category !== cat);
    for (const name of skillNames) {
      const surviving = store.tasks.filter((t) => t.autoSkillName === name).length;
      if (surviving === 0 && await deleteSkillFile(name)) skillsDeleted.push(name);
    }
  } else {
    // Treat as skill name: remove skill file + its backing tasks
    const skillName = spec.trim();
    const deleted = await deleteSkillFile(skillName);
    if (deleted) skillsDeleted.push(skillName);
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((t) => t.autoSkillName !== skillName);
    tasksRemoved = before - store.tasks.length;
  }

  await saveStore(store);
  return { tasksRemoved, skillsDeleted };
}

// ── Learn-mode persistence ────────────────────────────────────────────────────

const LEARN_CONFIG_PATH = path.join(os.homedir(), ".paw", "learn-config.json");

export type LearnMode = "auto" | "ask" | "off";

export async function loadLearnMode(): Promise<LearnMode> {
  try {
    const raw = await fs.readFile(LEARN_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { mode?: string };
    if (parsed.mode === "auto" || parsed.mode === "ask" || parsed.mode === "off") {
      return parsed.mode;
    }
  } catch {}
  return "auto";
}

export async function saveLearnMode(mode: LearnMode): Promise<void> {
  await fs.mkdir(path.dirname(LEARN_CONFIG_PATH), { recursive: true });
  await fs.writeFile(LEARN_CONFIG_PATH, JSON.stringify({ mode }, null, 2), "utf8");
}

/**
 * Return a summary of the learned task store (for /memory or status display).
 */
export async function getLearnedSummary(): Promise<string> {
  const store = await loadStore();
  if (store.tasks.length === 0) return "No learned tasks yet.";

  const byCategory = new Map<string, { count: number; avgConf: number }>();
  for (const t of store.tasks) {
    const entry = byCategory.get(t.category) ?? { count: 0, avgConf: 0 };
    entry.count += 1;
    entry.avgConf += t.confidence;
    byCategory.set(t.category, entry);
  }

  const lines = [`Learned tasks: ${store.tasks.length} across ${byCategory.size} categories`];
  for (const [cat, { count, avgConf }] of [...byCategory.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const avg = (avgConf / count * 100).toFixed(0);
    lines.push(`  ${cat.padEnd(14)} ${count}x  avg confidence: ${avg}%`);
  }
  lines.push("\nCommands: /forget <skill> | /forget --category <cat> | /forget --all");
  return lines.join("\n");
}
