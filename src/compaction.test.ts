import { describe, it, expect } from "vitest";
import {
  shouldCompact,
  buildCompactionPrompt,
  buildCompactedMessages,
  compactCodexHistory,
  estimateTokens,
  estimateMessagesTokens,
  type CompactionMessage,
} from "./compaction.js";

function makeMessages(count: number): CompactionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "assistant" as const,
    text: `Message ${i + 1}: ${"content ".repeat(10)}`,
  }));
}

describe("shouldCompact", () => {
  it("returns false when below threshold", () => {
    expect(shouldCompact(10)).toBe(false);
    expect(shouldCompact(29)).toBe(false);
    expect(shouldCompact(30)).toBe(false);
  });

  it("returns true when above threshold", () => {
    expect(shouldCompact(31)).toBe(true);
    expect(shouldCompact(50)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(shouldCompact(11, 10)).toBe(true);
    expect(shouldCompact(9, 10)).toBe(false);
  });
});

describe("buildCompactionPrompt", () => {
  it("returns empty prompt when messages fit in keepRecent", () => {
    const msgs = makeMessages(5);
    const { prompt, toSummarize, toKeep } = buildCompactionPrompt(msgs, 8);

    expect(prompt).toBe("");
    expect(toSummarize).toHaveLength(0);
    expect(toKeep).toEqual(msgs);
  });

  it("splits messages into summarize and keep", () => {
    const msgs = makeMessages(20);
    const { toSummarize, toKeep } = buildCompactionPrompt(msgs, 8);

    expect(toSummarize).toHaveLength(12);
    expect(toKeep).toHaveLength(8);
    // toKeep should be the last 8
    expect(toKeep[0]!.text).toBe(msgs[12]!.text);
  });

  it("generates a summarization prompt", () => {
    const msgs = makeMessages(20);
    const { prompt } = buildCompactionPrompt(msgs, 8);

    expect(prompt).toContain("Summarize this conversation");
    expect(prompt).toContain("Key decisions");
    expect(prompt).toContain("File paths");
    expect(prompt).toContain("Message 1");
  });

  it("includes focus instruction when provided", () => {
    const msgs = makeMessages(20);
    const { prompt } = buildCompactionPrompt(msgs, 8, "API authentication");

    expect(prompt).toContain("Focus especially on: API authentication");
  });

  it("truncates verbose messages in prompt to 500 chars", () => {
    const msgs: CompactionMessage[] = [
      { role: "user", text: "A".repeat(1000) },
      ...makeMessages(10),
    ];
    const { prompt } = buildCompactionPrompt(msgs, 5);

    // The 1000-char message should be truncated to 500 + "..."
    expect(prompt).toContain("...");
    const aCount = (prompt.match(/A/g) ?? []).length;
    expect(aCount).toBeLessThan(1000); // truncated from 1000
  });
});

describe("buildCompactedMessages", () => {
  it("produces summary + kept messages", () => {
    const kept: CompactionMessage[] = [
      { role: "user", text: "recent question" },
      { role: "assistant", text: "recent answer" },
    ];
    const result = buildCompactedMessages("This is the summary", kept);

    expect(result).toHaveLength(3); // summary + 2 kept
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.text).toContain("[Conversation Summary]");
    expect(result[0]!.text).toContain("This is the summary");
    expect(result[1]!.text).toBe("recent question");
    expect(result[2]!.text).toBe("recent answer");
  });

  it("includes memory context when provided", () => {
    const kept: CompactionMessage[] = [{ role: "user", text: "hi" }];
    const result = buildCompactedMessages("summary", kept, "Use TypeScript always");

    expect(result).toHaveLength(3); // summary + memory + kept
    expect(result[1]!.role).toBe("system");
    expect(result[1]!.text).toContain("[Context]");
    expect(result[1]!.text).toContain("Use TypeScript always");
  });

  it("omits memory block when not provided", () => {
    const kept: CompactionMessage[] = [{ role: "user", text: "hi" }];
    const result = buildCompactedMessages("summary", kept);

    expect(result).toHaveLength(2); // summary + kept
  });
});

describe("compactCodexHistory", () => {
  it("returns history unchanged when within keepRecent", () => {
    const history = [
      { role: "user" as const, text: "hello" },
      { role: "assistant" as const, text: "hi" },
    ];
    const result = compactCodexHistory(history, "summary", 8);
    expect(result).toEqual(history);
  });

  it("replaces old entries with summary + recent", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      text: `msg ${i}`,
    }));

    const result = compactCodexHistory(history, "Previous work summary", 8);

    expect(result).toHaveLength(9); // 1 summary + 8 kept
    expect(result[0]!.role).toBe("assistant");
    expect(result[0]!.text).toContain("[Previous conversation summary]");
    expect(result[0]!.text).toContain("Previous work summary");
    // Last entry should be the last entry of original
    expect(result[result.length - 1]!.text).toBe("msg 19");
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2); // 5/4 = 1.25, ceil = 2
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums token estimates across messages", () => {
    const msgs: CompactionMessage[] = [
      { role: "user", text: "a".repeat(100) },  // 25 tokens
      { role: "assistant", text: "b".repeat(200) }, // 50 tokens
    ];
    expect(estimateMessagesTokens(msgs)).toBe(75);
  });

  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});
