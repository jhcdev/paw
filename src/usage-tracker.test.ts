import { describe, it, expect } from "vitest";
import { UsageTracker } from "./usage-tracker.js";

describe("UsageTracker", () => {
  describe("record", () => {
    it("tracks usage for a single provider/model", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);

      const breakdown = tracker.getBreakdown();
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]!.provider).toBe("anthropic");
      expect(breakdown[0]!.model).toBe("claude-sonnet-4-20250514");
      expect(breakdown[0]!.inputTokens).toBe(1000);
      expect(breakdown[0]!.outputTokens).toBe(500);
      expect(breakdown[0]!.requests).toBe(1);
    });

    it("accumulates across multiple calls", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);
      tracker.record("anthropic", "claude-sonnet-4-20250514", 2000, 1000);

      const breakdown = tracker.getBreakdown();
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]!.inputTokens).toBe(3000);
      expect(breakdown[0]!.outputTokens).toBe(1500);
      expect(breakdown[0]!.requests).toBe(2);
    });

    it("tracks multiple providers separately", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);
      tracker.record("codex", "gpt-5.4", 2000, 800);
      tracker.record("ollama", "qwen3", 3000, 1200);

      const breakdown = tracker.getBreakdown();
      expect(breakdown).toHaveLength(3);
    });
  });

  describe("getBreakdown", () => {
    it("returns empty array when no usage", () => {
      const tracker = new UsageTracker();
      expect(tracker.getBreakdown()).toEqual([]);
    });

    it("calculates totalTokens", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);

      const breakdown = tracker.getBreakdown();
      expect(breakdown[0]!.totalTokens).toBe(1500);
    });

    it("estimates cost for Anthropic models", () => {
      const tracker = new UsageTracker();
      // Sonnet: $3/1M input, $15/1M output
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1_000_000, 100_000);

      const breakdown = tracker.getBreakdown();
      // Cost = (1M/1M * 3) + (100K/1M * 15) = 3 + 1.5 = 4.5
      expect(breakdown[0]!.estimatedCost).toBe(4.5);
    });

    it("shows zero cost for Codex (subscription)", () => {
      const tracker = new UsageTracker();
      tracker.record("codex", "gpt-5.4", 1_000_000, 500_000);

      const breakdown = tracker.getBreakdown();
      expect(breakdown[0]!.estimatedCost).toBe(0);
    });

    it("uses fallback pricing for unknown models", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-unknown-model", 1_000_000, 100_000);

      const breakdown = tracker.getBreakdown();
      // Falls back to anthropic default: $3/1M input, $15/1M output
      expect(breakdown[0]!.estimatedCost).toBeGreaterThan(0);
    });

    it("sorts by totalTokens descending", () => {
      const tracker = new UsageTracker();
      tracker.record("ollama", "qwen3", 100, 50);
      tracker.record("anthropic", "claude-sonnet-4-20250514", 10000, 5000);
      tracker.record("codex", "gpt-5.4", 1000, 500);

      const breakdown = tracker.getBreakdown();
      expect(breakdown[0]!.provider).toBe("anthropic");
      expect(breakdown[1]!.provider).toBe("codex");
      expect(breakdown[2]!.provider).toBe("ollama");
    });
  });

  describe("getTotal", () => {
    it("returns zeros when no usage", () => {
      const tracker = new UsageTracker();
      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(0);
      expect(total.outputTokens).toBe(0);
      expect(total.totalTokens).toBe(0);
      expect(total.estimatedCost).toBe(0);
    });

    it("sums across all providers", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);
      tracker.record("codex", "gpt-5.4", 2000, 800);
      tracker.record("ollama", "qwen3", 3000, 1200);

      const total = tracker.getTotal();
      expect(total.inputTokens).toBe(6000);
      expect(total.outputTokens).toBe(2500);
      expect(total.totalTokens).toBe(8500);
    });

    it("sums estimated costs", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1_000_000, 100_000);
      tracker.record("codex", "gpt-5.4", 1_000_000, 500_000);

      const total = tracker.getTotal();
      expect(total.estimatedCost).toBe(4.5); // only anthropic costs
    });
  });

  describe("formatReport", () => {
    it("returns message when no usage", () => {
      const tracker = new UsageTracker();
      expect(tracker.formatReport()).toBe("No usage recorded yet.");
    });

    it("includes provider/model breakdown", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1500, 800);

      const report = tracker.formatReport();
      expect(report).toContain("anthropic/claude-sonnet-4-20250514");
      expect(report).toContain("1.5k in");
      expect(report).toContain("1 req");
    });

    it("shows (free) for zero-cost providers", () => {
      const tracker = new UsageTracker();
      tracker.record("codex", "gpt-5.4", 5000, 2000);

      const report = tracker.formatReport();
      expect(report).toContain("(free)");
    });

    it("shows estimated cost with $ sign", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 100_000, 50_000);

      const report = tracker.formatReport();
      expect(report).toContain("~$");
    });

    it("formats large numbers with k/M suffix", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1_500_000, 800_000);

      const report = tracker.formatReport();
      expect(report).toContain("1.5M in");
      expect(report).toContain("800.0k out");
    });

    it("includes total line", () => {
      const tracker = new UsageTracker();
      tracker.record("anthropic", "claude-sonnet-4-20250514", 1000, 500);
      tracker.record("codex", "gpt-5.4", 2000, 800);

      const report = tracker.formatReport();
      expect(report).toContain("Total:");
      expect(report).toContain("Estimated cost:");
    });
  });
});
