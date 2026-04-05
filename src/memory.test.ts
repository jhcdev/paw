import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadMemory, appendMemory, saveMemoryIndex, saveMemoryTopic, loadMemoryTopic, listMemoryFiles, formatMemoryInfo } from "./memory.js";

let tmpDir: string;
let fakeHome: string;
let TEST_DIR: string;

function MEMORY_DIR() { return path.join(fakeHome, ".paw", "memory"); }

async function readSafe(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-memory-test-"));
  fakeHome = path.join(tmpDir, "_home");
  TEST_DIR = path.join(tmpDir, "project");
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.mkdir(path.join(fakeHome, ".paw", "memory"), { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadMemory", () => {
  it("returns empty when no PAW.md exists", async () => {
    const { sources, context } = await loadMemory(TEST_DIR);
    // Only global/memory sources if they exist
    const projectSources = sources.filter((s) => s.level === "project" || s.level === "local");
    expect(projectSources).toHaveLength(0);
  });

  it("loads PAW.md from project root", async () => {
    await fs.writeFile(path.join(TEST_DIR, "PAW.md"), "# Project Rules\n- Use TypeScript");
    const { sources } = await loadMemory(TEST_DIR);
    const project = sources.find((s) => s.level === "project");
    expect(project).toBeDefined();
    expect(project!.content).toContain("Use TypeScript");
  });

  it("loads .paw/PAW.md as fallback", async () => {
    await fs.mkdir(path.join(TEST_DIR, ".paw"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, ".paw", "PAW.md"), "# From .paw dir");
    const { sources } = await loadMemory(TEST_DIR);
    const project = sources.find((s) => s.level === "project");
    expect(project).toBeDefined();
    expect(project!.content).toContain("From .paw dir");
  });

  it("prefers PAW.md over .paw/PAW.md", async () => {
    await fs.writeFile(path.join(TEST_DIR, "PAW.md"), "root level");
    await fs.mkdir(path.join(TEST_DIR, ".paw"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, ".paw", "PAW.md"), "nested level");
    const { sources } = await loadMemory(TEST_DIR);
    const project = sources.find((s) => s.level === "project");
    expect(project!.content).toBe("root level");
  });

  it("loads PAW.local.md", async () => {
    await fs.writeFile(path.join(TEST_DIR, "PAW.local.md"), "my personal notes");
    const { sources } = await loadMemory(TEST_DIR);
    const local = sources.find((s) => s.level === "local");
    expect(local).toBeDefined();
    expect(local!.content).toBe("my personal notes");
  });

  it("builds combined context string", async () => {
    await fs.writeFile(path.join(TEST_DIR, "PAW.md"), "project rules");
    await fs.writeFile(path.join(TEST_DIR, "PAW.local.md"), "local rules");
    const { context } = await loadMemory(TEST_DIR);
    expect(context).toContain("Project Instructions");
    expect(context).toContain("project rules");
    expect(context).toContain("Local Instructions");
    expect(context).toContain("local rules");
  });
});

describe("appendMemory", () => {
  it("creates MEMORY.md if not exists", async () => {
    await fs.rm(path.join(MEMORY_DIR(),"MEMORY.md"), { force: true });
    await appendMemory("test note");
    const content = await readSafe(path.join(MEMORY_DIR(),"MEMORY.md"));
    expect(content).toContain("# Paw Memory");
    expect(content).toContain("- test note");
  });

  it("appends to existing MEMORY.md", async () => {
    await saveMemoryIndex("# Paw Memory\n\n- first note\n");
    await appendMemory("second note");
    const content = await readSafe(path.join(MEMORY_DIR(),"MEMORY.md"));
    expect(content).toContain("- first note");
    expect(content).toContain("- second note");
  });
});

describe("saveMemoryTopic / loadMemoryTopic", () => {
  const topic = `test-topic-${Date.now()}`;

  afterEach(async () => {
    await fs.rm(path.join(MEMORY_DIR(),`${topic}.md`), { force: true });
  });

  it("saves and loads a topic file", async () => {
    await saveMemoryTopic(topic, "# Auth Notes\n\nUse JWT for auth.");
    const content = await loadMemoryTopic(topic);
    expect(content).toContain("Use JWT for auth");
  });

  it("returns null for non-existent topic", async () => {
    const content = await loadMemoryTopic("nonexistent-topic-xyz");
    expect(content).toBeNull();
  });
});

describe("listMemoryFiles", () => {
  it("returns array of .md files", async () => {
    await saveMemoryIndex("# test");
    const files = await listMemoryFiles();
    expect(files).toContain("MEMORY.md");
  });
});

describe("formatMemoryInfo", () => {
  it("shows helpful message when no memory loaded", () => {
    const result = formatMemoryInfo([]);
    expect(result).toContain("No memory loaded");
    expect(result).toContain("PAW.md");
  });

  it("lists loaded sources with levels", () => {
    const result = formatMemoryInfo([
      { path: "/home/dev/paw/PAW.md", level: "project", content: "rules" },
      { path: "/root/.paw/PAW.md", level: "global", content: "global rules" },
    ]);
    expect(result).toContain("project");
    expect(result).toContain("global");
    expect(result).toContain("Loaded memory:");
  });
});
