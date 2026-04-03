import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createProvider } from "./providers/index.js";
import type { LlmProvider, ProviderName } from "./types.js";

// ── Types ──

export type AgentRole = "planner" | "coder" | "reviewer" | "tester" | "optimizer";
const ALL_ROLES: AgentRole[] = ["planner", "coder", "reviewer", "tester", "optimizer"];

type TeamAgent = {
  role: AgentRole;
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  instance?: LlmProvider;
};

export type TeamConfig = Partial<Record<AgentRole, { provider: ProviderName; model: string; apiKey: string; baseUrl?: string }>>;

export type PhaseResult = {
  role: AgentRole;
  provider: string;
  model: string;
  text: string;
  ms: number;
};

export type TeamResult = {
  phases: PhaseResult[];
  totalMs: number;
};

// ── Role Prompts ──

const ROLE_PROMPTS: Record<AgentRole, string> = {
  planner: `You are the PLANNER agent. Analyze the request, break it into clear steps, identify files to change. Produce a detailed plan. Do NOT write code. Be specific about paths, functions, and exact changes.`,
  coder: `You are the CODER agent. You receive a plan. Implement it precisely. Write clean, working code. Follow the plan closely. Do NOT explain — just implement.`,
  reviewer: `You are the REVIEWER agent. Review for correctness, bugs, edge cases, security. Point out exact issues with file:line refs. Rate: PASS / MINOR / MAJOR.`,
  tester: `You are the TESTER agent. Write comprehensive test cases: unit, integration, boundary, error handling. Output concrete test code.`,
  optimizer: `You are the OPTIMIZER agent. Suggest performance improvements, simplification, best practices. Be specific with before/after examples.`,
};

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "Planning", coder: "Implementing", reviewer: "Reviewing", tester: "Testing", optimizer: "Optimizing",
};

// ── Performance Tracking ──

const SCORES_FILE = path.join(os.homedir(), ".cats-claw", "team-scores.json");

type PerformanceRecord = { totalMs: number; successCount: number; failCount: number; avgMs: number; lastUsed: string };
type ScoresData = { version: 1; records: Partial<Record<ProviderName, Partial<Record<AgentRole, PerformanceRecord>>>> };

async function loadScores(): Promise<ScoresData> {
  try { return JSON.parse(await fs.readFile(SCORES_FILE, "utf8")) as ScoresData; }
  catch { return { version: 1, records: {} }; }
}

async function saveScores(data: ScoresData): Promise<void> {
  await fs.mkdir(path.dirname(SCORES_FILE), { recursive: true });
  await fs.writeFile(SCORES_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function recordPerformance(provider: ProviderName, role: AgentRole, ms: number, success: boolean): Promise<void> {
  const data = await loadScores();
  if (!data.records[provider]) data.records[provider] = {};
  const rec = data.records[provider]![role] ?? { totalMs: 0, successCount: 0, failCount: 0, avgMs: 0, lastUsed: "" };
  if (success) { rec.successCount++; rec.totalMs += ms; rec.avgMs = Math.round(rec.totalMs / rec.successCount); }
  else { rec.failCount++; }
  rec.lastUsed = new Date().toISOString();
  data.records[provider]![role] = rec;
  await saveScores(data);
}

// ── Baseline scores ──

const BASELINE: Record<ProviderName, Record<AgentRole, number>> = {
  anthropic:  { planner: 10, coder: 8, reviewer: 9, tester: 7, optimizer: 8 },
  gemini:     { planner: 8,  coder: 9, reviewer: 7, tester: 8, optimizer: 7 },
  openai:     { planner: 9,  coder: 8, reviewer: 8, tester: 9, optimizer: 9 },
  groq:       { planner: 6,  coder: 7, reviewer: 6, tester: 10, optimizer: 6 },
  openrouter: { planner: 7,  coder: 7, reviewer: 7, tester: 7, optimizer: 7 },
  ollama:     { planner: 5,  coder: 6, reviewer: 5, tester: 6, optimizer: 5 },
};

/** Blend baseline + real performance. More data → more weight on real metrics. */
async function getLiveScores(): Promise<Record<ProviderName, Record<AgentRole, number>>> {
  const data = await loadScores();
  const result: Record<string, Record<string, number>> = {};
  for (const provider of Object.keys(BASELINE) as ProviderName[]) {
    result[provider] = {};
    for (const role of ALL_ROLES) {
      const base = BASELINE[provider][role];
      const rec = data.records[provider]?.[role];
      if (!rec || rec.successCount < 3) { result[provider][role] = base; continue; }
      const speed = Math.max(1, Math.min(10, 10 - (rec.avgMs / 5000)));
      const reliability = (rec.successCount / (rec.successCount + rec.failCount)) * 10;
      result[provider][role] = Math.round(Math.max(1, Math.min(10, base * 0.3 + speed * 0.4 + reliability * 0.3)) * 10) / 10;
    }
  }
  return result as Record<ProviderName, Record<AgentRole, number>>;
}

/** Public: get scores for /providers display */
export async function getTeamScores(): Promise<{ provider: ProviderName; role: AgentRole; score: number; uses: number }[]> {
  const live = await getLiveScores();
  const data = await loadScores();
  const out: { provider: ProviderName; role: AgentRole; score: number; uses: number }[] = [];
  for (const provider of Object.keys(BASELINE) as ProviderName[]) {
    for (const role of ALL_ROLES) {
      const rec = data.records[provider]?.[role];
      out.push({ provider, role, score: live[provider][role], uses: rec ? rec.successCount + rec.failCount : 0 });
    }
  }
  return out;
}

// ── Team Runner ──

export class TeamRunner {
  private agents: Map<AgentRole, TeamAgent> = new Map();
  private cwd: string;

  constructor(cwd: string) { this.cwd = cwd; }

  configure(config: TeamConfig): void {
    for (const [role, cfg] of Object.entries(config)) {
      if (cfg) this.agents.set(role as AgentRole, { role: role as AgentRole, ...cfg });
    }
  }

  getRoles(): { role: AgentRole; provider: ProviderName; model: string }[] {
    return Array.from(this.agents.entries()).map(([role, a]) => ({ role, provider: a.provider, model: a.model }));
  }

  isReady(): boolean { return this.agents.has("coder"); }

  private getOrCreate(role: AgentRole): LlmProvider {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent for role "${role}"`);
    if (!agent.instance) {
      agent.instance = createProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, cwd: this.cwd, baseUrl: agent.baseUrl });
    }
    return agent.instance;
  }

  private async runPhase(role: AgentRole, prompt: string, onPhase: (p: string, prov: string, m: string) => void): Promise<PhaseResult> {
    const agent = this.agents.get(role)!;
    onPhase(ROLE_LABELS[role], agent.provider, agent.model);
    const start = Date.now();
    try {
      const result = await this.getOrCreate(role).runTurn(`${ROLE_PROMPTS[role]}\n\n${prompt}`);
      const ms = Date.now() - start;
      await recordPerformance(agent.provider, role, ms, true).catch(() => {});
      return { role, provider: agent.provider, model: agent.model, text: result.text, ms };
    } catch (err) {
      const ms = Date.now() - start;
      await recordPerformance(agent.provider, role, ms, false).catch(() => {});
      return { role, provider: agent.provider, model: agent.model, text: `[Error: ${err instanceof Error ? err.message : String(err)}]`, ms };
    }
  }

  async run(prompt: string, onPhase: (phase: string, provider: string, model: string) => void): Promise<TeamResult> {
    const totalStart = Date.now();
    const phases: PhaseResult[] = [];

    // Phase 1: Plan (sequential — everything depends on this)
    const plan = await this.runPhase("planner", `User request:\n${prompt}`, onPhase);
    phases.push(plan);

    // Phase 2: Code (sequential — review/test depend on this)
    const code = await this.runPhase("coder", `Original request:\n${prompt}\n\nPlan:\n${plan.text}`, onPhase);
    phases.push(code);

    // Phase 3: Review + Test (PARALLEL — independent of each other)
    const parallel = await Promise.allSettled([
      this.runPhase("reviewer", `Original request:\n${prompt}\n\nPlan:\n${plan.text}\n\nImplementation:\n${code.text}`, onPhase),
      this.runPhase("tester", `Original request:\n${prompt}\n\nImplementation:\n${code.text}`, onPhase),
    ]);
    for (const r of parallel) { if (r.status === "fulfilled") phases.push(r.value); }

    // Phase 4: Optimize (sequential — needs all prior context)
    const reviewText = phases.find((p) => p.role === "reviewer")?.text ?? "";
    const testText = phases.find((p) => p.role === "tester")?.text ?? "";
    const opt = await this.runPhase("optimizer",
      `Original request:\n${prompt}\n\nImplementation:\n${code.text}\n\nReview:\n${reviewText || "(none)"}\n\nTests:\n${testText || "(none)"}`,
      onPhase,
    );
    phases.push(opt);

    return { phases, totalMs: Date.now() - totalStart };
  }
}

// ── Auto-configure ──

/**
 * Always assigns ALL 5 roles, even with 1-2 providers.
 * Uses live scores. Allows duplicate assignments.
 * Each role gets the highest-scoring available provider.
 */
export async function autoConfigureTeam(
  available: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[],
): Promise<TeamConfig> {
  if (available.length === 0) return {};

  const scores = await getLiveScores();
  const providerMap = new Map(available.map((p) => [p.provider, p]));
  const providerNames = available.map((p) => p.provider);
  const config: TeamConfig = {};

  // For each role, pick the provider with the highest live score
  for (const role of ALL_ROLES) {
    let bestScore = -1;
    let bestProvider: ProviderName | null = null;
    for (const pName of providerNames) {
      const score = scores[pName]?.[role] ?? BASELINE[pName]?.[role] ?? 5;
      if (score > bestScore) { bestScore = score; bestProvider = pName; }
    }
    if (bestProvider) config[role] = providerMap.get(bestProvider)!;
  }

  return config;
}
