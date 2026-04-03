import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName } from "./types.js";

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

const ROLE_PROMPTS: Record<AgentRole, string> = {
  planner: `You are the PLANNER agent in a multi-model team.
Your job: analyze the user's request, break it into clear steps, identify files to change, and produce a detailed plan.
Do NOT write code. Focus on architecture, approach, and step-by-step instructions the coder can follow.
Be specific about file paths, function names, and exact changes needed.`,

  coder: `You are the CODER agent in a multi-model team.
You receive a plan from the planner. Your job: implement it precisely using the available tools.
Write clean, working code. Follow the plan closely. Use tools to read files before editing.
Do NOT explain or plan — just implement.`,

  reviewer: `You are the REVIEWER agent in a multi-model team.
You receive the original request, the plan, and the implementation.
Your job: review for correctness, bugs, edge cases, security issues, and improvements.
Be specific. Point out exact issues with file:line references. Suggest fixes.
Rate: PASS (good to go), MINOR (small issues), or MAJOR (needs rework).`,

  tester: `You are the TESTER agent in a multi-model team.
You receive the original request and the implementation.
Your job: write comprehensive test cases and edge case scenarios.
Focus on: unit tests, integration tests, boundary conditions, error handling, and regression scenarios.
Output concrete test code or detailed test specs the coder can use.`,

  optimizer: `You are the OPTIMIZER agent in a multi-model team.
You receive the original request, implementation, review, and test results.
Your job: suggest performance improvements, code simplification, and best practices.
Focus on: reducing complexity, improving readability, eliminating redundancy, and applying design patterns.
Be specific with before/after code examples.`,
};

const ROLE_LABELS: Record<AgentRole, string> = {
  planner: "Planning",
  coder: "Implementing",
  reviewer: "Reviewing",
  tester: "Testing",
  optimizer: "Optimizing",
};

export class TeamRunner {
  private agents: Map<AgentRole, TeamAgent> = new Map();
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  configure(config: TeamConfig): void {
    for (const [role, cfg] of Object.entries(config)) {
      if (cfg) {
        this.agents.set(role as AgentRole, { role: role as AgentRole, ...cfg });
      }
    }
  }

  getRoles(): { role: AgentRole; provider: ProviderName; model: string }[] {
    return Array.from(this.agents.entries()).map(([role, a]) => ({
      role,
      provider: a.provider,
      model: a.model,
    }));
  }

  /** Returns which roles are active (based on configured providers) */
  getActiveRoles(): AgentRole[] {
    return ALL_ROLES.filter((r) => this.agents.has(r));
  }

  isReady(): boolean {
    return this.agents.has("coder") && this.agents.size >= 2;
  }

  private getOrCreate(role: AgentRole): LlmProvider {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent configured for role "${role}"`);
    if (!agent.instance) {
      agent.instance = createProvider({
        provider: agent.provider,
        apiKey: agent.apiKey,
        model: agent.model,
        cwd: this.cwd,
        baseUrl: agent.baseUrl,
      });
    }
    return agent.instance;
  }

  async run(
    prompt: string,
    onPhase: (phase: string, provider: string, model: string) => void,
  ): Promise<TeamResult> {
    const totalStart = Date.now();
    const phases: PhaseResult[] = [];
    const activeRoles = this.getActiveRoles();

    // Build pipeline based on available roles
    // Always: plan → code. Then optional: review, test, optimize (parallel where possible)
    let planText = "";
    let codeText = "";

    // Phase 1: Plan (if planner exists, else coder plans)
    if (activeRoles.includes("planner")) {
      const agent = this.agents.get("planner")!;
      onPhase(ROLE_LABELS.planner, agent.provider, agent.model);
      const start = Date.now();
      const result = await this.getOrCreate("planner").runTurn(
        `${ROLE_PROMPTS.planner}\n\nUser request:\n${prompt}`,
      );
      planText = result.text;
      phases.push({ role: "planner", provider: agent.provider, model: agent.model, text: result.text, ms: Date.now() - start });
    }

    // Phase 2: Code
    {
      const agent = this.agents.get("coder")!;
      onPhase(ROLE_LABELS.coder, agent.provider, agent.model);
      const start = Date.now();
      const codePrompt = planText
        ? `${ROLE_PROMPTS.coder}\n\nOriginal request:\n${prompt}\n\nPlan from planner:\n${planText}`
        : `${ROLE_PROMPTS.coder}\n\nUser request:\n${prompt}`;
      const result = await this.getOrCreate("coder").runTurn(codePrompt);
      codeText = result.text;
      phases.push({ role: "coder", provider: agent.provider, model: agent.model, text: result.text, ms: Date.now() - start });
    }

    // Phase 3: Review + Test in parallel (if both exist)
    const parallelPhases: Promise<PhaseResult>[] = [];

    if (activeRoles.includes("reviewer")) {
      parallelPhases.push((async () => {
        const agent = this.agents.get("reviewer")!;
        onPhase(ROLE_LABELS.reviewer, agent.provider, agent.model);
        const start = Date.now();
        const result = await this.getOrCreate("reviewer").runTurn(
          `${ROLE_PROMPTS.reviewer}\n\nOriginal request:\n${prompt}\n\nPlan:\n${planText || "(no separate plan)"}\n\nImplementation:\n${codeText}`,
        );
        return { role: "reviewer" as AgentRole, provider: agent.provider, model: agent.model, text: result.text, ms: Date.now() - start };
      })());
    }

    if (activeRoles.includes("tester")) {
      parallelPhases.push((async () => {
        const agent = this.agents.get("tester")!;
        onPhase(ROLE_LABELS.tester, agent.provider, agent.model);
        const start = Date.now();
        const result = await this.getOrCreate("tester").runTurn(
          `${ROLE_PROMPTS.tester}\n\nOriginal request:\n${prompt}\n\nImplementation:\n${codeText}`,
        );
        return { role: "tester" as AgentRole, provider: agent.provider, model: agent.model, text: result.text, ms: Date.now() - start };
      })());
    }

    const parallelResults = await Promise.allSettled(parallelPhases);
    for (const r of parallelResults) {
      if (r.status === "fulfilled") phases.push(r.value);
    }

    // Phase 4: Optimize (runs last, has full context)
    if (activeRoles.includes("optimizer")) {
      const agent = this.agents.get("optimizer")!;
      onPhase(ROLE_LABELS.optimizer, agent.provider, agent.model);
      const reviewText = phases.find((p) => p.role === "reviewer")?.text ?? "";
      const testText = phases.find((p) => p.role === "tester")?.text ?? "";
      const start = Date.now();
      const result = await this.getOrCreate("optimizer").runTurn(
        `${ROLE_PROMPTS.optimizer}\n\nOriginal request:\n${prompt}\n\nImplementation:\n${codeText}\n\nReview:\n${reviewText || "(none)"}\n\nTests:\n${testText || "(none)"}`,
      );
      phases.push({ role: "optimizer", provider: agent.provider, model: agent.model, text: result.text, ms: Date.now() - start });
    }

    return { phases, totalMs: Date.now() - totalStart };
  }
}

/**
 * Efficiency scores per provider per role (0-10).
 * Based on model strengths:
 * - anthropic: best reasoning/planning, strong code review
 * - gemini: best long-context, fast coding, good at analysis
 * - openai: balanced, strong at structured output and testing
 * - groq: fastest inference, good for quick tasks like testing
 * - openrouter: depends on model, treat as balanced
 * - ollama: local, best for lightweight/parallel tasks
 */
const EFFICIENCY: Record<ProviderName, Record<AgentRole, number>> = {
  anthropic:   { planner: 10, coder: 8, reviewer: 9, tester: 7, optimizer: 8 },
  gemini:      { planner: 8,  coder: 9, reviewer: 7, tester: 8, optimizer: 7 },
  openai:      { planner: 9,  coder: 8, reviewer: 8, tester: 9, optimizer: 9 },
  groq:        { planner: 6,  coder: 7, reviewer: 6, tester: 10, optimizer: 6 },
  openrouter:  { planner: 7,  coder: 7, reviewer: 7, tester: 7, optimizer: 7 },
  ollama:      { planner: 5,  coder: 6, reviewer: 5, tester: 6, optimizer: 5 },
};

/**
 * Auto-configure team using Hungarian-style greedy assignment.
 * Maximizes total efficiency score across all role-provider pairs.
 * No duplicate assignments (each provider gets at most 1 role).
 */
export function autoConfigureTeam(
  available: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[],
): TeamConfig {
  if (available.length === 0) return {};

  const providerMap = new Map(available.map((p) => [p.provider, p]));
  const numProviders = available.length;

  // Scale roles to available providers
  const rolesToAssign: AgentRole[] =
    numProviders >= 5 ? ["planner", "coder", "reviewer", "tester", "optimizer"] :
    numProviders >= 4 ? ["planner", "coder", "reviewer", "tester"] :
    numProviders >= 3 ? ["planner", "coder", "reviewer"] :
    numProviders >= 2 ? ["planner", "coder"] :
    ["coder"];

  // Build score matrix: [role][provider] = score
  const providerNames = available.map((p) => p.provider);

  // Greedy assignment: pick the highest-scoring (role, provider) pair, assign it, repeat
  const config: TeamConfig = {};
  const usedProviders = new Set<ProviderName>();
  const usedRoles = new Set<AgentRole>();

  // Create all possible (role, provider, score) triples and sort by score desc
  const candidates: { role: AgentRole; provider: ProviderName; score: number }[] = [];
  for (const role of rolesToAssign) {
    for (const pName of providerNames) {
      candidates.push({ role, provider: pName, score: EFFICIENCY[pName]?.[role] ?? 5 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Greedy assign: highest score first, skip conflicts
  for (const c of candidates) {
    if (usedRoles.has(c.role) || usedProviders.has(c.provider)) continue;
    config[c.role] = providerMap.get(c.provider)!;
    usedRoles.add(c.role);
    usedProviders.add(c.provider);
    if (usedRoles.size === rolesToAssign.length) break;
  }

  // Fallback: any unassigned role gets the best remaining provider (allow reuse)
  for (const role of rolesToAssign) {
    if (config[role]) continue;
    let bestScore = -1;
    let bestProvider: ProviderName | null = null;
    for (const pName of providerNames) {
      const score = EFFICIENCY[pName]?.[role] ?? 5;
      if (score > bestScore) { bestScore = score; bestProvider = pName; }
    }
    if (bestProvider) config[role] = providerMap.get(bestProvider)!;
  }

  return config;
}
