import type { ProviderName } from "./types.js";

type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  requests: number;
};

// Approximate pricing per 1M tokens (USD) — updated as of mid-2025
const PRICING: Record<string, { input: number; output: number }> = {
  // Codex (subscription-based, no per-token cost)
  "gpt-5.4": { input: 0, output: 0 },
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-opus-4-20250514": { input: 15.00, output: 75.00 },
};

// Fallback pricing by provider
const PROVIDER_DEFAULT_PRICING: Partial<Record<ProviderName, { input: number; output: number }>> = {
  anthropic: { input: 3.00, output: 15.00 },
  codex: { input: 0, output: 0 },
};

export class UsageTracker {
  private usage: Map<string, ProviderUsage> = new Map();

  /** Record usage for a provider/model combination */
  record(provider: ProviderName, model: string, inputTokens: number, outputTokens: number): void {
    const key = `${provider}/${model}`;
    const existing = this.usage.get(key) ?? { inputTokens: 0, outputTokens: 0, requests: 0 };
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.requests++;
    this.usage.set(key, existing);
  }

  /** Get per-provider breakdown */
  getBreakdown(): {
    key: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests: number;
    estimatedCost: number;
  }[] {
    const results: ReturnType<UsageTracker["getBreakdown"]> = [];

    for (const [key, usage] of this.usage) {
      const [provider, model] = key.split("/", 2);
      const pricing = PRICING[model!] ?? PROVIDER_DEFAULT_PRICING[provider as ProviderName];
      const cost = pricing
        ? (usage.inputTokens / 1_000_000) * pricing.input + (usage.outputTokens / 1_000_000) * pricing.output
        : 0;

      results.push({
        key,
        provider: provider!,
        model: model!,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        requests: usage.requests,
        estimatedCost: Math.round(cost * 10000) / 10000,
      });
    }

    return results.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /** Get total across all providers */
  getTotal(): { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number } {
    const breakdown = this.getBreakdown();
    return {
      inputTokens: breakdown.reduce((s, b) => s + b.inputTokens, 0),
      outputTokens: breakdown.reduce((s, b) => s + b.outputTokens, 0),
      totalTokens: breakdown.reduce((s, b) => s + b.totalTokens, 0),
      estimatedCost: breakdown.reduce((s, b) => s + b.estimatedCost, 0),
    };
  }

  /** Format for display */
  formatReport(): string {
    const breakdown = this.getBreakdown();
    if (breakdown.length === 0) return "No usage recorded yet.";

    const lines: string[] = [];

    for (const b of breakdown) {
      const cost = b.estimatedCost > 0 ? ` ~$${b.estimatedCost.toFixed(4)}` : " (free)";
      lines.push(`  ${b.key}`);
      lines.push(`    ${fmt(b.inputTokens)} in / ${fmt(b.outputTokens)} out / ${b.requests} req${cost}`);
    }

    const total = this.getTotal();
    const totalCost = total.estimatedCost > 0 ? `  ~$${total.estimatedCost.toFixed(4)}` : "  (free)";
    lines.push("");
    lines.push(`  Total: ${fmt(total.inputTokens)} in / ${fmt(total.outputTokens)} out`);
    lines.push(`  Estimated cost:${totalCost}`);

    return lines.join("\n");
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
