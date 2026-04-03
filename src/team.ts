import { createProvider } from "./providers/index.js";
import type { AgentTurnResult, LlmProvider, ProviderName } from "./types.js";

export type AgentRole = "planner" | "coder" | "reviewer";

type TeamAgent = {
  role: AgentRole;
  provider: ProviderName;
  model: string;
  apiKey: string;
  baseUrl?: string;
  instance?: LlmProvider;
};

export type TeamConfig = {
  planner?: { provider: ProviderName; model: string; apiKey: string; baseUrl?: string };
  coder?: { provider: ProviderName; model: string; apiKey: string; baseUrl?: string };
  reviewer?: { provider: ProviderName; model: string; apiKey: string; baseUrl?: string };
};

export type TeamResult = {
  plan: { provider: string; model: string; text: string; ms: number };
  implementation: { provider: string; model: string; text: string; ms: number };
  review: { provider: string; model: string; text: string; ms: number };
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

  isReady(): boolean {
    return this.agents.size >= 2;
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

    // Phase 1: Plan
    const plannerAgent = this.agents.get("planner") ?? this.agents.get("coder")!;
    onPhase("Planning", plannerAgent.provider, plannerAgent.model);
    const planner = this.getOrCreate(this.agents.has("planner") ? "planner" : "coder");
    const planStart = Date.now();
    const planResult = await planner.runTurn(`${ROLE_PROMPTS.planner}\n\nUser request:\n${prompt}`);
    const plan = {
      provider: plannerAgent.provider,
      model: plannerAgent.model,
      text: planResult.text,
      ms: Date.now() - planStart,
    };

    // Phase 2: Implement
    const coderAgent = this.agents.get("coder")!;
    onPhase("Implementing", coderAgent.provider, coderAgent.model);
    const coder = this.getOrCreate("coder");
    const codeStart = Date.now();
    const codeResult = await coder.runTurn(
      `${ROLE_PROMPTS.coder}\n\nOriginal request:\n${prompt}\n\nPlan from planner:\n${planResult.text}`,
    );
    const implementation = {
      provider: coderAgent.provider,
      model: coderAgent.model,
      text: codeResult.text,
      ms: Date.now() - codeStart,
    };

    // Phase 3: Review
    const reviewerAgent = this.agents.get("reviewer") ?? this.agents.get("planner") ?? this.agents.get("coder")!;
    const reviewRole: AgentRole = this.agents.has("reviewer") ? "reviewer" : this.agents.has("planner") ? "planner" : "coder";
    onPhase("Reviewing", reviewerAgent.provider, reviewerAgent.model);
    const reviewer = this.getOrCreate(reviewRole);
    const reviewStart = Date.now();
    const reviewResult = await reviewer.runTurn(
      `${ROLE_PROMPTS.reviewer}\n\nOriginal request:\n${prompt}\n\nPlan:\n${planResult.text}\n\nImplementation:\n${codeResult.text}`,
    );
    const review = {
      provider: reviewerAgent.provider,
      model: reviewerAgent.model,
      text: reviewResult.text,
      ms: Date.now() - reviewStart,
    };

    return { plan, implementation, review, totalMs: Date.now() - totalStart };
  }
}

/** Auto-configure team from available providers */
export function autoConfigureTeam(
  available: { provider: ProviderName; apiKey: string; model: string; baseUrl?: string }[],
): TeamConfig {
  if (available.length === 0) return {};

  // Priority for each role (strongest model for planning/review, fastest for coding)
  const rolePreference: Record<AgentRole, ProviderName[]> = {
    planner: ["anthropic", "openai", "gemini", "openrouter", "groq", "ollama"],
    coder: ["gemini", "anthropic", "openai", "openrouter", "groq", "ollama"],
    reviewer: ["openai", "anthropic", "gemini", "openrouter", "groq", "ollama"],
  };

  const config: TeamConfig = {};
  const providerMap = new Map(available.map((p) => [p.provider, p]));

  for (const role of ["planner", "coder", "reviewer"] as AgentRole[]) {
    for (const preferred of rolePreference[role]) {
      const p = providerMap.get(preferred);
      if (p) {
        config[role] = p;
        break;
      }
    }
  }

  return config;
}
