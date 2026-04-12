import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "./tools.js";
import { saveSession, type SessionData } from "./session.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i6xQAAAAASUVORK5CYII=";

let tmpDir: string;
let workspaceDir: string;
let externalDir: string;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-tools-test-"));
  workspaceDir = path.join(tmpDir, "workspace");
  externalDir = path.join(tmpDir, "external");
  fakeHome = path.join(tmpDir, "_home");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(externalDir, { recursive: true });
  await fs.mkdir(fakeHome, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("toolHandlers.read_image", () => {
  it("returns JSON metadata and base64 data for a workspace image", async () => {
    const imagePath = path.join(workspaceDir, "pixel.png");
    const imageBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
    await fs.writeFile(imagePath, imageBuffer);

    const result = await toolHandlers.read_image({ path: "pixel.png" }, workspaceDir);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content) as {
      path: string;
      mimeType: string;
      byteSize: number;
      encoding: string;
      data: string;
    };

    expect(payload.path).toBe(imagePath);
    expect(payload.mimeType).toBe("image/png");
    expect(payload.byteSize).toBe(imageBuffer.length);
    expect(payload.encoding).toBe("base64");
    expect(payload.data).toBe(TINY_PNG_BASE64);
  });

  it("allows absolute image paths outside the workspace", async () => {
    const imagePath = path.join(externalDir, "outside.png");
    const imageBuffer = Buffer.from(TINY_PNG_BASE64, "base64");
    await fs.writeFile(imagePath, imageBuffer);

    const result = await toolHandlers.read_image({ path: imagePath }, workspaceDir);

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content) as {
      path: string;
      mimeType: string;
      byteSize: number;
      encoding: string;
      data: string;
    };
    expect(payload.path).toBe(imagePath);
    expect(payload.mimeType).toBe("image/png");
    expect(payload.byteSize).toBe(imageBuffer.length);
    expect(payload.encoding).toBe("base64");
    expect(payload.data).toBe(TINY_PNG_BASE64);
  });

  it("returns an error when the image file is missing", async () => {
    const result = await toolHandlers.read_image({ path: "missing.png" }, workspaceDir);

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/ENOENT|no such file/i);
  });

  it("returns an error for unsupported image extensions", async () => {
    await fs.writeFile(path.join(workspaceDir, "note.txt"), "not an image", "utf8");

    const result = await toolHandlers.read_image({ path: "note.txt" }, workspaceDir);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unsupported image extension");
  });
});

describe("toolHandlers.session_search", () => {
  async function seedSession(session: SessionData): Promise<void> {
    await saveSession(session);
  }

  it("lists recent sessions when no query is provided", async () => {
    await seedSession({
      id: "recent1",
      provider: "codex",
      model: "gpt-5.4",
      mode: "solo",
      cwd: workspaceDir,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:01:00.000Z",
      entries: [{ role: "user", text: "investigate auth bug", timestamp: "2026-04-12T00:00:01.000Z" }],
    });

    const result = await toolHandlers.session_search({}, workspaceDir);

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("Recent sessions:");
    expect(result.content).toContain("recent1");
  });

  it("returns matching saved sessions for a query", async () => {
    await seedSession({
      id: "auth1",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      mode: "solo",
      cwd: workspaceDir,
      createdAt: "2026-04-12T00:00:00.000Z",
      updatedAt: "2026-04-12T00:02:00.000Z",
      entries: [
        { role: "user", text: "fix jwt auth middleware", timestamp: "2026-04-12T00:00:01.000Z" },
        { role: "assistant", text: "updated auth.ts and login route", timestamp: "2026-04-12T00:00:10.000Z" },
      ],
    });

    const result = await toolHandlers.session_search({ query: "jwt auth" }, workspaceDir);

    expect(result.isError).not.toBe(true);
    expect(result.content).toContain("auth1");
    expect(result.content).toContain("jwt auth middleware");
  });
});
