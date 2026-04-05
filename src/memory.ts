/**
 * Memory System — Cross-session project memory and instructions.
 *
 * Hierarchy (loaded at session start, higher = more specific):
 *   1. ~/.paw/PAW.md           — User-wide global instructions
 *   2. ./PAW.md or .paw/PAW.md — Project instructions (shared with team)
 *   3. ./PAW.local.md          — Personal local instructions (git-ignored)
 *   4. ~/.paw/memory/MEMORY.md — Auto memory index (cross-session learning)
 *
 * Auto memory: agent saves useful context automatically.
 * Topic files in ~/.paw/memory/*.md for detailed notes.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type MemorySource = {
  path: string;
  level: "global" | "project" | "local" | "memory";
  content: string;
};

function getMemoryDir() { return path.join(os.homedir(), ".paw", "memory"); }
function getMemoryIndex() { return path.join(getMemoryDir(), "MEMORY.md"); }
function getGlobalPawMd() { return path.join(os.homedir(), ".paw", "PAW.md"); }
const MAX_MEMORY_LINES = 200;

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Load all memory sources for a project.
 * Returns combined context string for injection into AI prompts.
 */
export async function loadMemory(cwd: string): Promise<{
  sources: MemorySource[];
  context: string;
}> {
  const sources: MemorySource[] = [];

  // 1. Global: ~/.paw/PAW.md
  const globalContent = await readFileSafe(getGlobalPawMd());
  if (globalContent?.trim()) {
    sources.push({ path: getGlobalPawMd(), level: "global", content: globalContent.trim() });
  }

  // 2. Project: ./PAW.md or .paw/PAW.md
  const projectPaths = [
    path.join(cwd, "PAW.md"),
    path.join(cwd, ".paw", "PAW.md"),
  ];
  for (const p of projectPaths) {
    const content = await readFileSafe(p);
    if (content?.trim()) {
      sources.push({ path: p, level: "project", content: content.trim() });
      break; // Only load the first found
    }
  }

  // 3. Local: ./PAW.local.md
  const localContent = await readFileSafe(path.join(cwd, "PAW.local.md"));
  if (localContent?.trim()) {
    sources.push({ path: path.join(cwd, "PAW.local.md"), level: "local", content: localContent.trim() });
  }

  // 4. Auto memory index: ~/.paw/memory/MEMORY.md (first 200 lines)
  const memoryContent = await readFileSafe(getMemoryIndex());
  if (memoryContent?.trim()) {
    const lines = memoryContent.split("\n").slice(0, MAX_MEMORY_LINES);
    sources.push({ path: getMemoryIndex(), level: "memory", content: lines.join("\n").trim() });
  }

  // Build combined context
  const parts: string[] = [];
  for (const s of sources) {
    const label = s.level === "global" ? "Global Instructions"
      : s.level === "project" ? "Project Instructions"
      : s.level === "local" ? "Local Instructions"
      : "Memory";
    parts.push(`## ${label}\n${s.content}`);
  }

  return {
    sources,
    context: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
  };
}

/**
 * Load a specific topic file from memory.
 */
export async function loadMemoryTopic(topic: string): Promise<string | null> {
  const filePath = path.join(getMemoryDir(), `${topic}.md`);
  return readFileSafe(filePath);
}

/**
 * Save or update the auto memory index.
 */
export async function saveMemoryIndex(content: string): Promise<void> {
  await ensureDir(getMemoryDir());
  await fs.writeFile(getMemoryIndex(), content, { mode: 0o600 });
}

/**
 * Save a topic file to memory.
 */
export async function saveMemoryTopic(topic: string, content: string): Promise<void> {
  await ensureDir(getMemoryDir());
  const filePath = path.join(getMemoryDir(), `${topic}.md`);
  await fs.writeFile(filePath, content, { mode: 0o600 });
}

/**
 * Append a note to the memory index.
 */
export async function appendMemory(note: string): Promise<void> {
  await ensureDir(getMemoryDir());
  const existing = await readFileSafe(getMemoryIndex()) ?? "";
  const updated = existing.trim()
    ? `${existing.trim()}\n- ${note}\n`
    : `# Paw Memory\n\n- ${note}\n`;
  await fs.writeFile(getMemoryIndex(), updated, { mode: 0o600 });
}

/**
 * List all memory files.
 */
export async function listMemoryFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(getMemoryDir());
    return files.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * Format memory info for display.
 */
export function formatMemoryInfo(sources: MemorySource[]): string {
  if (sources.length === 0) {
    return "No memory loaded.\n\nCreate PAW.md in your project root or ~/.paw/PAW.md for global instructions.";
  }

  const lines: string[] = ["Loaded memory:"];
  for (const s of sources) {
    const lineCount = s.content.split("\n").length;
    lines.push(`  ${s.level.padEnd(8)} ${s.path} (${lineCount} lines)`);
  }

  lines.push("");
  lines.push("Files:");
  lines.push("  PAW.md         — Project instructions (shared)");
  lines.push("  PAW.local.md   — Personal instructions (git-ignored)");
  lines.push("  ~/.paw/PAW.md  — Global instructions");
  lines.push("  ~/.paw/memory/ — Auto memory (cross-session)");

  return lines.join("\n");
}
