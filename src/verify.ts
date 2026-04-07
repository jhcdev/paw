import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { MultiProvider } from "./multi-provider.js";
import type { ProviderName } from "./types.js";

const execFileAsync = promisify(execFile);

export type VerifyIssue = {
  severity: "info" | "warning" | "error";
  file: string;
  description: string;
};

export type VerifyVerdict = "pass" | "warn" | "block";

export type VerifyCheck = {
  name: string;
  command: string;
  source: "script" | "fallback";
  ok: boolean;
  summary: string;
  fullOutput: string;
  output: string;
};

export type VerifyResult = {
  verified: boolean;
  verdict: VerifyVerdict;
  confidence: number;
  issues: VerifyIssue[];
  checks: VerifyCheck[];
  blockingSummary: string[];
  provider: string;
  ms: number;
};

type TrackedChange = {
  file: string;
  type: "write" | "edit";
  oldContent?: string;
  newContent?: string;
};

const CHECK_ORDER = ["check", "build", "test", "lint"] as const;
const CHECK_TIMEOUT_MS: Record<(typeof CHECK_ORDER)[number], number> = {
  check: 30_000,
  build: 45_000,
  test: 60_000,
  lint: 45_000,
};
const CHANGE_SECTION_LIMIT = 3_500;
const CHECK_OUTPUT_LIMIT = 1_200;

const REVIEW_SYSTEM_PROMPT = `You are a strict code reviewer validating a local code change.
Use both the code-change evidence and the command results.
A failed verification command is blocking unless it is clearly unrelated noise.
Focus on correctness, regressions, security issues, missing edge cases, and invalid assumptions.

Respond in this exact format:
VERDICT: <PASS|WARN|BLOCK>
CONFIDENCE: <0-100>
ISSUES:
[severity: info|warning|error] [file: <filename>] <description>
[severity: info|warning|error] [file: <filename>] <description>
...
END

Rules:
- Use BLOCK when tests/build/typecheck failed or you found a must-fix issue.
- Use WARN when changes look mostly fine but there are non-blocking concerns.
- Use PASS only when the change looks safe and checks are green.
- Keep each issue to one line.`;

function clip(text: string | undefined, limit: number): string {
  const normalized = (text ?? "").trim();
  if (!normalized) return "(empty)";
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, Math.max(0, limit - 1)).trimEnd() + "…";
}

function formatChangeSection(change: TrackedChange): string {
  const header = `File: ${change.file} (${change.type})`;
  if (change.type === "write") {
    return `${header}\nAfter:\n\`\`\`\n${clip(change.newContent, CHANGE_SECTION_LIMIT)}\n\`\`\``;
  }

  const parts = [header];
  if (change.oldContent !== undefined) {
    parts.push(`Before:\n\`\`\`\n${clip(change.oldContent, CHANGE_SECTION_LIMIT)}\n\`\`\``);
  }
  if (change.newContent !== undefined) {
    parts.push(`After:\n\`\`\`\n${clip(change.newContent, CHANGE_SECTION_LIMIT)}\n\`\`\``);
  }
  return parts.join("\n");
}

function formatCheckSection(checks: VerifyCheck[]): string {
  if (checks.length === 0) return "Verification checks:\n(no local scripts detected)";
  return [
    "Verification checks:",
    ...checks.map((check) => {
      const icon = check.ok ? "PASS" : "FAIL";
      return `- ${icon} ${check.name}: ${check.command} [${check.source}]`
        + `\nSummary: ${check.summary}`
        + `\n${check.output || "(no output)"}`;
    }),
  ].join("\n");
}

function buildReviewPrompt(changes: TrackedChange[], checks: VerifyCheck[]): string {
  const sections = changes.map(formatChangeSection);
  return `${REVIEW_SYSTEM_PROMPT}\n\n${formatCheckSection(checks)}\n\nReview these code changes:\n\n${sections.join("\n\n---\n\n")}`;
}

function parseResponse(text: string, fallbackFile: string): { verdict: VerifyVerdict; confidence: number; issues: VerifyIssue[] } {
  const verdictMatch = text.match(/VERDICT:\s*(PASS|WARN|BLOCK)/i);
  const verdict = (verdictMatch?.[1]?.toLowerCase() as VerifyVerdict | undefined) ?? "warn";
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
        issues.push({ severity: "info", file: fallbackFile, description: trimmed });
      }
    }
  }

  return { verdict, confidence, issues };
}

async function loadScripts(cwd: string): Promise<Partial<Record<(typeof CHECK_ORDER)[number], string>>> {
  try {
    const raw = await fs.readFile(`${cwd}/package.json`, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const found: Partial<Record<(typeof CHECK_ORDER)[number], string>> = {};
    for (const name of CHECK_ORDER) {
      if (typeof scripts[name] === "string" && scripts[name]!.trim()) {
        found[name] = scripts[name]!;
      }
    }
    return found;
  } catch {
    return {};
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalBin(cwd: string, name: string): Promise<string | null> {
  const candidates = process.platform === "win32"
    ? [`${cwd}/node_modules/.bin/${name}.cmd`, `${cwd}/node_modules/.bin/${name}`]
    : [`${cwd}/node_modules/.bin/${name}`];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function buildCheckSpecs(cwd: string): Promise<{
  name: (typeof CHECK_ORDER)[number];
  command: string;
  exec: string;
  args: string[];
  source: "script" | "fallback";
}[]> {
  const scripts = await loadScripts(cwd);
  const specs: {
    name: (typeof CHECK_ORDER)[number];
    command: string;
    exec: string;
    args: string[];
    source: "script" | "fallback";
  }[] = [];

  for (const name of CHECK_ORDER) {
    if (scripts[name]) {
      specs.push({
        name,
        command: `npm run --silent ${name}`,
        exec: "npm",
        args: ["run", "--silent", name],
        source: "script",
      });
      continue;
    }

    if (name === "check" && await exists(`${cwd}/tsconfig.json`)) {
      const tscBin = await resolveLocalBin(cwd, "tsc");
      if (tscBin) {
        specs.push({
          name,
          command: `${tscBin} --noEmit -p tsconfig.json`,
          exec: tscBin,
          args: ["--noEmit", "-p", "tsconfig.json"],
          source: "fallback",
        });
      }
      continue;
    }

    if (name === "test" && (await exists(`${cwd}/vitest.config.ts`) || await exists(`${cwd}/vitest.config.js`))) {
      const vitestBin = await resolveLocalBin(cwd, "vitest");
      if (vitestBin) {
        specs.push({
          name,
          command: `${vitestBin} run`,
          exec: vitestBin,
          args: ["run"],
          source: "fallback",
        });
      }
      continue;
    }

    if (name === "lint") {
      const hasEslintConfig =
        await exists(`${cwd}/eslint.config.js`) ||
        await exists(`${cwd}/eslint.config.mjs`) ||
        await exists(`${cwd}/.eslintrc`) ||
        await exists(`${cwd}/.eslintrc.js`) ||
        await exists(`${cwd}/.eslintrc.cjs`) ||
        await exists(`${cwd}/.eslintrc.json`);
      if (hasEslintConfig) {
        const eslintBin = await resolveLocalBin(cwd, "eslint");
        if (eslintBin) {
          specs.push({
            name,
            command: `${eslintBin} .`,
            exec: eslintBin,
            args: ["."],
            source: "fallback",
          });
        }
      }
    }
  }

  return specs;
}

function extractMeaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      !line.startsWith("> ")
      && !/^RUN\s+/i.test(line)
      && !/^Start at\b/i.test(line)
      && !/^Duration\b/i.test(line)
    );
}

function summarizeCommandOutput(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "(no output)";
  const lines = extractMeaningfulLines(cleaned);
  const tail = lines.slice(-8).join("\n");
  return clip(tail || cleaned, CHECK_OUTPUT_LIMIT);
}

function normalizeFullOutput(text: string): string {
  const cleaned = text.trim();
  return cleaned || "(no output)";
}

function summarizeCheck(check: Pick<VerifyCheck, "name" | "ok" | "output">): string {
  const lines = extractMeaningfulLines(check.output);
  if (check.ok) {
    const interesting =
      lines.find((line) => /tests?\s+\d+|passed|ok\b|compiled|build/i.test(line))
      ?? lines[0];
    return interesting ? clip(interesting, 160) : `${check.name} passed`;
  }

  const primary =
    lines.find((line) => /error TS\d+|AssertionError|failed|FAIL|Expected|Cannot find|No tests/i.test(line))
    ?? lines[0]
    ?? `${check.name} failed`;
  const secondary = lines.find((line) => line !== primary);
  return secondary ? `${clip(primary, 120)} — ${clip(secondary, 120)}` : clip(primary, 160);
}

async function runVerificationChecks(cwd: string): Promise<VerifyCheck[]> {
  const specs = await buildCheckSpecs(cwd);
  const checks: VerifyCheck[] = [];

  for (const spec of specs) {
    try {
      const { stdout, stderr } = await execFileAsync(spec.exec, spec.args, {
        cwd,
        timeout: CHECK_TIMEOUT_MS[spec.name],
        maxBuffer: 1024 * 1024,
      });
      const fullOutput = normalizeFullOutput([stdout, stderr].filter(Boolean).join("\n"));
      const output = summarizeCommandOutput(fullOutput);
      checks.push({
        name: spec.name,
        command: spec.command,
        source: spec.source,
        ok: true,
        summary: summarizeCheck({ name: spec.name, ok: true, output }),
        fullOutput,
        output,
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const fullOutput = normalizeFullOutput([err.stdout, err.stderr, err.message].filter(Boolean).join("\n"));
      const output = summarizeCommandOutput(fullOutput);
      checks.push({
        name: spec.name,
        command: spec.command,
        source: spec.source,
        ok: false,
        summary: summarizeCheck({ name: spec.name, ok: false, output }),
        fullOutput,
        output,
      });
    }
  }

  return checks;
}

function buildCheckIssues(checks: VerifyCheck[]): VerifyIssue[] {
  return checks
    .filter((check) => !check.ok)
    .map((check) => ({
      severity: "error" as const,
      file: `[check:${check.name}]`,
      description: `${check.command} failed — ${check.summary}`,
    }));
}

function mergeIssues(primary: VerifyIssue[], derived: VerifyIssue[]): VerifyIssue[] {
  const seen = new Set<string>();
  const merged: VerifyIssue[] = [];
  for (const issue of [...primary, ...derived]) {
    const key = `${issue.severity}|${issue.file}|${issue.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }
  return merged;
}

function buildBlockingSummary(checks: VerifyCheck[]): string[] {
  return checks
    .filter((check) => !check.ok)
    .map((check) => `${check.name}: ${check.summary}`);
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
    const existing = this.changes.find((change) => change.file === file);
    if (existing) {
      existing.type = type;
      existing.oldContent ??= oldContent;
      if (newContent !== undefined) existing.newContent = newContent;
      return;
    }
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
    const checks = await runVerificationChecks(this.cwd);
    const prompt = buildReviewPrompt(this.changes, checks);

    try {
      const result = await this.multi.ask(reviewerName, prompt, this.preferredModel ?? undefined, this.preferredEffort ?? undefined);
      const parsed = parseResponse(result.text, fallbackFile);
      const checkIssues = buildCheckIssues(checks);
      const issues = mergeIssues(parsed.issues, checkIssues);
      const hasErrors = issues.some((issue) => issue.severity === "error");
      const verdict: VerifyVerdict = hasErrors ? "block" : parsed.verdict;
      return {
        verified: verdict !== "block",
        verdict,
        confidence: parsed.confidence,
        issues,
        checks,
        blockingSummary: buildBlockingSummary(checks),
        provider: reviewerName,
        ms: Date.now() - start,
      };
    } catch {
      return {
        verified: false,
        verdict: "block",
        confidence: 0,
        issues: [{ severity: "error", file: fallbackFile, description: "Verification failed: provider error" }],
        checks,
        blockingSummary: buildBlockingSummary(checks),
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
