import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadMemory, appendMemory, saveMemoryIndex, saveMemoryTopic, loadMemoryTopic } from "./memory.js";

let tmpDir: string;
let fakeHome: string;
let TEST_PROJECT: string;

function MEMORY_DIR() { return path.join(fakeHome, ".paw", "memory"); }

async function readSafe(p: string): Promise<string | null> {
  try { return await fs.readFile(p, "utf8"); } catch { return null; }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-integ-"));
  fakeHome = path.join(tmpDir, "_home");
  TEST_PROJECT = path.join(tmpDir, "project");
  await fs.mkdir(TEST_PROJECT, { recursive: true });
  await fs.mkdir(path.join(fakeHome, ".paw", "memory"), { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Functional: Memory injection into prompt ──

describe("memory injection into agent prompt", () => {
  it("injects memory context into the first prompt", async () => {
    await fs.writeFile(path.join(TEST_PROJECT, "PAW.md"), "Always use semicolons in TypeScript.");
    const { context } = await loadMemory(TEST_PROJECT);

    // Simulate what agent.runTurn does
    let prompt = "write a hello world function";
    let memoryInjected = false;
    if (!memoryInjected && context) {
      prompt = `[Context]\n${context}\n\n[User]\n${prompt}`;
      memoryInjected = true;
    }

    expect(prompt).toContain("[Context]");
    expect(prompt).toContain("Always use semicolons");
    expect(prompt).toContain("[User]");
    expect(prompt).toContain("write a hello world function");
  });

  it("does NOT inject memory on second turn", async () => {
    await fs.writeFile(path.join(TEST_PROJECT, "PAW.md"), "project rules");
    const { context } = await loadMemory(TEST_PROJECT);

    let memoryInjected = false;

    // First turn
    let prompt1 = "first message";
    if (!memoryInjected && context) {
      prompt1 = `[Context]\n${context}\n\n[User]\n${prompt1}`;
      memoryInjected = true;
    }
    expect(prompt1).toContain("[Context]");

    // Second turn
    let prompt2 = "second message";
    if (!memoryInjected && context) {
      prompt2 = `[Context]\n${context}\n\n[User]\n${prompt2}`;
      memoryInjected = true;
    }
    expect(prompt2).toBe("second message"); // no injection
  });

  it("re-injects memory after clear()", async () => {
    await fs.writeFile(path.join(TEST_PROJECT, "PAW.md"), "project rules");
    const { context } = await loadMemory(TEST_PROJECT);

    let memoryInjected = false;

    // First turn — injected
    let prompt1 = "hello";
    if (!memoryInjected && context) {
      prompt1 = `[Context]\n${context}\n\n[User]\n${prompt1}`;
      memoryInjected = true;
    }
    expect(prompt1).toContain("[Context]");

    // Simulate clear()
    memoryInjected = false;

    // Next turn after clear — should inject again
    let prompt2 = "hello again";
    if (!memoryInjected && context) {
      prompt2 = `[Context]\n${context}\n\n[User]\n${prompt2}`;
      memoryInjected = true;
    }
    expect(prompt2).toContain("[Context]");
    expect(prompt2).toContain("project rules");
  });
});

// ── Functional: /remember workflow ──

describe("/remember → next session workflow", () => {
  it("saves a note and it appears in next session's memory load", async () => {
    // Clean slate
    await fs.rm(path.join(MEMORY_DIR(), "MEMORY.md"), { force: true });

    // Session 1: user does /remember
    await appendMemory("this project uses Prisma ORM");
    await appendMemory("deploy target is AWS Lambda");

    // Session 2: load memory — should contain both notes
    const { sources, context } = await loadMemory(TEST_PROJECT);
    const memorySrc = sources.find((s) => s.level === "memory");
    expect(memorySrc).toBeDefined();
    expect(memorySrc!.content).toContain("Prisma ORM");
    expect(memorySrc!.content).toContain("AWS Lambda");
    expect(context).toContain("Prisma ORM");
  });
});

// ── Functional: Memory hierarchy ──

describe("memory source hierarchy", () => {
  it("loads all levels in correct order: global → project → local → memory", async () => {
    // Setup all levels
    const globalDir = path.join(os.homedir(), ".paw");
    const globalPaw = path.join(globalDir, "PAW.md");
    const originalGlobal = await readSafe(globalPaw);

    try {
      await fs.writeFile(globalPaw, "global: always be concise");
      await fs.writeFile(path.join(TEST_PROJECT, "PAW.md"), "project: use React 19");
      await fs.writeFile(path.join(TEST_PROJECT, "PAW.local.md"), "local: my API key is in .env.local");
      await saveMemoryIndex("# Paw Memory\n\n- remember: auth uses JWT");

      const { sources, context } = await loadMemory(TEST_PROJECT);

      // All 4 levels should be present
      const levels = sources.map((s) => s.level);
      expect(levels).toContain("global");
      expect(levels).toContain("project");
      expect(levels).toContain("local");
      expect(levels).toContain("memory");

      // Context should include all
      expect(context).toContain("always be concise");
      expect(context).toContain("use React 19");
      expect(context).toContain("my API key is in .env.local");
      expect(context).toContain("auth uses JWT");

      // Order: global first, then project, local, memory
      const globalIdx = context.indexOf("Global Instructions");
      const projectIdx = context.indexOf("Project Instructions");
      const localIdx = context.indexOf("Local Instructions");
      const memoryIdx = context.indexOf("Memory");
      expect(globalIdx).toBeLessThan(projectIdx);
      expect(projectIdx).toBeLessThan(localIdx);
      expect(localIdx).toBeLessThan(memoryIdx);
    } finally {
      if (originalGlobal !== null) {
        await fs.writeFile(globalPaw, originalGlobal);
      } else {
        await fs.rm(globalPaw, { force: true });
      }
    }
  });
});

// ── Functional: 200 line limit ──

describe("memory index 200 line limit", () => {
  it("only loads first 200 lines of MEMORY.md", async () => {
    // Overwrite with 300 lines (clean state for this test)
    const lines = Array.from({ length: 300 }, (_, i) => `- note ${i + 1}`);
    const content = `# Memory\n\n${lines.join("\n")}\n`;
    await fs.mkdir(MEMORY_DIR(), { recursive: true });
    await fs.writeFile(path.join(MEMORY_DIR(), "MEMORY.md"), content);

    const { sources } = await loadMemory(TEST_PROJECT);
    const memorySrc = sources.find((s) => s.level === "memory");
    expect(memorySrc).toBeDefined();

    const loadedLines = memorySrc!.content.split("\n");
    expect(loadedLines.length).toBeLessThanOrEqual(200);
    expect(memorySrc!.content).toContain("note 1");
    expect(memorySrc!.content).not.toContain("note 250");
  });
});

// ── Functional: Topic files for detailed memory ──

describe("topic files for cross-session knowledge", () => {
  const topic = `integ-test-${Date.now()}`;

  afterEach(async () => {
    await fs.rm(path.join(MEMORY_DIR(), `${topic}.md`), { force: true });
  });

  it("saves architecture decisions and retrieves them next session", async () => {
    // Session 1: save detailed architecture notes
    await saveMemoryTopic(topic, [
      "# Architecture Decisions",
      "",
      "## Database",
      "- PostgreSQL with Prisma ORM",
      "- Connection pooling via PgBouncer",
      "",
      "## Auth",
      "- JWT with refresh tokens",
      "- Stored in httpOnly cookies",
    ].join("\n"));

    // Session 2: retrieve them
    const content = await loadMemoryTopic(topic);
    expect(content).toContain("PostgreSQL with Prisma ORM");
    expect(content).toContain("JWT with refresh tokens");
    expect(content).toContain("httpOnly cookies");
  });
});
