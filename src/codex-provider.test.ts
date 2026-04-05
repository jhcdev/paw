import { describe, it, expect } from "vitest";
import { CodexProvider } from "./providers/codex.js";

describe("CodexProvider — conversation history", () => {
  it("first turn sends prompt without history prefix", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });
    const prompt = provider.buildPromptWithHistory("hello");

    expect(prompt).toBe("hello");
    expect(prompt).not.toContain("[Previous conversation]");
  });

  it("includes history in prompt after first turn", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });
    provider.pushHistory("user", "hello");
    provider.pushHistory("assistant", "Hi there!");

    const prompt = provider.buildPromptWithHistory("what did I say?");

    expect(prompt).toContain("[Previous conversation]");
    expect(prompt).toContain("> hello");
    expect(prompt).toContain("AI: Hi there!");
    expect(prompt).toContain("[Current message]");
    expect(prompt).toContain("what did I say?");
  });

  it("clear() resets history so next prompt has no context", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });
    provider.pushHistory("user", "hello");
    provider.pushHistory("assistant", "Hi!");

    provider.clear();

    const prompt = provider.buildPromptWithHistory("fresh start");
    expect(prompt).toBe("fresh start");
    expect(prompt).not.toContain("[Previous conversation]");
    expect(provider.getHistory()).toHaveLength(0);
  });

  it("limits history to last 10 entries", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });

    for (let i = 0; i < 15; i++) {
      provider.pushHistory("user", `message ${i}`);
      provider.pushHistory("assistant", `response ${i}`);
    }
    // 30 entries total, should only include last 10

    const prompt = provider.buildPromptWithHistory("final");
    expect(prompt).toContain("[Previous conversation]");
    // Last 10 entries = entries 20-29 = messages 10-14
    expect(prompt).toContain("> message 14");
    expect(prompt).toContain("AI: response 14");
    // Early entries should be excluded
    expect(prompt).not.toContain("> message 0");
    expect(prompt).not.toContain("AI: response 0");
  });

  it("truncates long messages in history to 300 chars", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });
    const longMessage = "A".repeat(500);
    provider.pushHistory("user", longMessage);
    provider.pushHistory("assistant", "ok");

    const prompt = provider.buildPromptWithHistory("next");
    const historySection = prompt.split("[Current message]")[0]!;
    // Should not contain the full 500 chars
    const aCount = (historySection.match(/A/g) ?? []).length;
    expect(aCount).toBeLessThan(500); // truncated from 500, not full length
  });

  it("multiple turns accumulate history", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp" });
    provider.pushHistory("user", "first");
    provider.pushHistory("assistant", "response 1");
    provider.pushHistory("user", "second");
    provider.pushHistory("assistant", "response 2");
    provider.pushHistory("user", "third");
    provider.pushHistory("assistant", "response 3");

    const prompt = provider.buildPromptWithHistory("fourth");
    expect(prompt).toContain("> first");
    expect(prompt).toContain("> second");
    expect(prompt).toContain("> third");
    expect(prompt).toContain("AI: response 1");
    expect(prompt).toContain("AI: response 2");
    expect(prompt).toContain("AI: response 3");
    expect(prompt).toContain("fourth");
  });

  it("effort setting is independent of history", () => {
    const provider = new CodexProvider({ model: "gpt-5.4", cwd: "/tmp", effort: "high" });
    expect(provider.getEffort()).toBe("high");

    provider.pushHistory("user", "hello");
    provider.pushHistory("assistant", "hi");
    provider.setEffort("low");

    expect(provider.getEffort()).toBe("low");
    expect(provider.getHistory()).toHaveLength(2);
  });
});
