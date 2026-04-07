import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolHandlers } from "./tools.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+i6xQAAAAASUVORK5CYII=";

let tmpDir: string;
let workspaceDir: string;
let externalDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-tools-test-"));
  workspaceDir = path.join(tmpDir, "workspace");
  externalDir = path.join(tmpDir, "external");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(externalDir, { recursive: true });
});

afterEach(async () => {
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
