import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProvider } from "./providers/index.js";
import { detectProviders } from "./multi-provider.js";
import { detectLiveModels } from "./model-catalog.js";
import { loadConfig } from "./config.js";

// ── createProvider ──

describe("createProvider — vllm", () => {
  it("creates an OpenAI-compatible provider for vllm", () => {
    const provider = createProvider({
      provider: "vllm",
      apiKey: "dummy",
      model: "meta-llama/Llama-3-8B-Instruct",
      cwd: "/tmp",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.runTurn).toBe("function");
    expect(typeof provider.clear).toBe("function");
  });

  it("uses 'dummy' when apiKey is empty", () => {
    // Should not throw even with empty apiKey
    expect(() =>
      createProvider({ provider: "vllm", apiKey: "", model: "llama3", cwd: "/tmp" })
    ).not.toThrow();
  });

  it("uses custom baseUrl when provided", () => {
    expect(() =>
      createProvider({
        provider: "vllm",
        apiKey: "token",
        model: "llama3",
        cwd: "/tmp",
        baseUrl: "http://gpu-server:9000",
      })
    ).not.toThrow();
  });
});

// ── detectLiveModels ──

describe("detectLiveModels — vllm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns models from /v1/models response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "meta-llama/Llama-3-8B-Instruct", max_model_len: 8192 },
          { id: "mistralai/Mistral-7B-Instruct-v0.3", max_model_len: 32768 },
        ],
      }),
    }));

    const models = await detectLiveModels("vllm", "dummy", "http://localhost:8000");
    expect(models).toHaveLength(2);
    expect(models![0]!.id).toBe("meta-llama/Llama-3-8B-Instruct");
    expect(models![1]!.id).toBe("mistralai/Mistral-7B-Instruct-v0.3");
  });

  it("returns empty array when server is not reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const models = await detectLiveModels("vllm", "dummy", "http://localhost:8000");
    expect(models).toEqual([]);
  });

  it("returns empty array when server returns non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const models = await detectLiveModels("vllm", "dummy");
    expect(models).toEqual([]);
  });

  it("uses default localhost:8000 when no baseUrl provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await detectLiveModels("vllm", "dummy");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/models",
      expect.any(Object),
    );
  });
});

// ── detectProviders ──

describe("detectProviders — vllm env vars", () => {
  it("detects vllm when VLLM_MODEL is set", async () => {
    const found = await detectProviders({ VLLM_MODEL: "llama3" });
    const vllm = found.find((p) => p.provider === "vllm");
    expect(vllm).toBeDefined();
    expect(vllm!.model).toBe("llama3");
    expect(vllm!.baseUrl).toBe("http://localhost:8000");
    expect(vllm!.apiKey).toBe("dummy");
  });

  it("detects vllm when VLLM_BASE_URL is set", async () => {
    const found = await detectProviders({ VLLM_BASE_URL: "http://gpu-server:9000" });
    const vllm = found.find((p) => p.provider === "vllm");
    expect(vllm).toBeDefined();
    expect(vllm!.baseUrl).toBe("http://gpu-server:9000");
  });

  it("uses VLLM_API_KEY when provided", async () => {
    const found = await detectProviders({
      VLLM_MODEL: "llama3",
      VLLM_API_KEY: "my-secret-token",
    });
    const vllm = found.find((p) => p.provider === "vllm");
    expect(vllm!.apiKey).toBe("my-secret-token");
  });

  it("does not detect vllm when no VLLM_ vars are set", async () => {
    const found = await detectProviders({});
    const vllm = found.find((p) => p.provider === "vllm");
    expect(vllm).toBeUndefined();
  });
});

// ── loadConfig ──

describe("loadConfig — vllm", () => {
  it("loads vllm config with defaults", () => {
    const cfg = loadConfig({ provider: "vllm" });
    expect(cfg.provider).toBe("vllm");
    expect(cfg.apiKey).toBe("dummy");
    expect(cfg.baseUrl).toBe("http://localhost:8000");
  });

  it("uses VLLM_MODEL env when set", () => {
    process.env.VLLM_MODEL = "mistral-7b";
    const cfg = loadConfig({ provider: "vllm" });
    expect(cfg.model).toBe("mistral-7b");
    delete process.env.VLLM_MODEL;
  });

  it("uses VLLM_API_KEY when set", () => {
    process.env.VLLM_API_KEY = "secret";
    const cfg = loadConfig({ provider: "vllm" });
    expect(cfg.apiKey).toBe("secret");
    delete process.env.VLLM_API_KEY;
  });
});
