import type { MultiProvider } from "./multi-provider.js";
import type { ProviderName } from "./types.js";

export type VerifyIssue = {
  severity: "info" | "warning" | "error";
  file: string;
  description: string;
};

export type VerifyResult = {
  verified: boolean;
  confidence: number;
  issues: VerifyIssue[];
  provider: string;
  ms: number;
};

type TrackedChange = {
  file: string;
  type: "write" | "edit";
  oldContent?: string;
  newContent?: string;
};

const REVIEW_SYSTEM_PROMPT = `You are a strict code reviewer. Analyze code changes for problems.
Check specifically for:
- N+1 query patterns
- Race conditions
- Security vulnerabilities (injection, XSS, CSRF, path traversal, etc.)
- Logic errors
- Missing error handling at system boundaries
- Incorrect business logic

Respond in this exact format:
CONFIDENCE: <0-100>
ISSUES:
[severity: info|warning|error] [file: <filename>] <description>
[severity: info|warning|error] [file: <filename>] <description>
...
END

If no issues found, write ISSUES: followed by END with nothing in between.
Be concise. Each issue on one line.`;

function buildReviewPrompt(changes: TrackedChange[]): string {
  const sections = changes.map((c) => {
    const header = `File: ${c.file} (${c.type})`;
    if (c.type === "write" && c.newContent) {
      return `${header}\n\`\`\`\n${c.newContent.slice(0, 4000)}\n\`\`\``;
    }
    if (c.type === "edit") {
      const parts: string[] = [header];
      if (c.oldContent) parts.push(`Before:\n\`\`\`\n${c.oldContent.slice(0, 2000)}\n\`\`\``);
      if (c.newContent) parts.push(`After:\n\`\`\`\n${c.newContent.slice(0, 2000)}\n\`\`\``);
      return parts.join("\n");
    }
    return header;
  });
  return `${REVIEW_SYSTEM_PROMPT}\n\nReview these code changes:\n\n${sections.join("\n\n---\n\n")}`;
}

function parseResponse(text: string, fallbackFile: string): { confidence: number; issues: VerifyIssue[] } {
  const confidenceMatch = text.match(/CONFIDENCE:\s*(\d+)/i);
  const confidence = confidenceMatch ? Math.min(100, Math.max(0, parseInt(confidenceMatch[1]!, 10))) : 50;

  const issues: VerifyIssue[] = [];
  const issuesSection = text.match(/ISSUES:([\s\S]*?)END/i);
  if (issuesSection) {
    const lines = issuesSection[1]!.trim().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/\[severity:\s*(info|warning|error)\]\s*\[file:\s*([^\]]+)\]\s*(.+)/i);
      if (match) {
        issues.push({
          severity: match[1]!.toLowerCase() as VerifyIssue["severity"],
          file: match[2]!.trim(),
          description: match[3]!.trim(),
        });
      } else {
        // Fallback: treat unparsed lines as info
        issues.push({ severity: "info", file: fallbackFile, description: trimmed });
      }
    }
  }

  return { confidence, issues };
}

export class Verifier {
  private changes: TrackedChange[] = [];
  private multi: MultiProvider;
  private primaryProvider: ProviderName;
  private preferredProvider: ProviderName | null = null;
  private preferredModel: string | null = null;
  private preferredEffort: string | null = null;
  private cwd: string;

  constructor(multi: MultiProvider, primaryProvider: ProviderName, cwd: string) {
    this.multi = multi;
    this.primaryProvider = primaryProvider;
    this.cwd = cwd;
  }

  /** Set a specific provider/model/effort to use for verification. Pass null to auto-select. */
  setProvider(provider: ProviderName | null, model?: string | null, effort?: string | null): void {
    this.preferredProvider = provider;
    this.preferredModel = model ?? null;
    this.preferredEffort = effort ?? null;
  }

  getProvider(): ProviderName | null {
    return this.preferredProvider;
  }

  getModel(): string | null {
    return this.preferredModel;
  }

  getEffort(): string | null {
    return this.preferredEffort;
  }

  setEffort(effort: string | null): void {
    this.preferredEffort = effort;
  }

  trackChange(file: string, type: "write" | "edit", oldContent?: string, newContent?: string): void {
    this.changes.push({ file, type, oldContent, newContent });
  }

  async verify(): Promise<VerifyResult> {
    const start = Date.now();
    const registered = this.multi.getRegistered();
    let reviewerName: ProviderName;
    if (this.preferredProvider && registered.some((r) => r.name === this.preferredProvider)) {
      reviewerName = this.preferredProvider;
    } else {
      const alt = registered.find((r) => r.name !== this.primaryProvider);
      reviewerName = alt ? alt.name : this.primaryProvider;
    }
    const fallbackFile = this.changes[0]?.file ?? "unknown";

    const prompt = buildReviewPrompt(this.changes);

    try {
      const result = await this.multi.ask(reviewerName, prompt, this.preferredModel ?? undefined, this.preferredEffort ?? undefined);
      const { confidence, issues } = parseResponse(result.text, fallbackFile);
      const hasErrors = issues.some((i) => i.severity === "error");
      return {
        verified: !hasErrors,
        confidence,
        issues,
        provider: reviewerName,
        ms: Date.now() - start,
      };
    } catch {
      return {
        verified: false,
        confidence: 0,
        issues: [{ severity: "error", file: fallbackFile, description: "Verification failed: provider error" }],
        provider: reviewerName,
        ms: Date.now() - start,
      };
    }
  }

  clear(): void {
    this.changes = [];
  }

  hasPendingChanges(): boolean {
    return this.changes.length > 0;
  }
}
