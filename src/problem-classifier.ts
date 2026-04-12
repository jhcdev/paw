/**
 * Problem Classifier — Hermes-inspired automatic problem categorization.
 *
 * Detects the category/domain of a user prompt and recommends which paw
 * features to auto-activate for best results.
 * No LLM call — pure pattern matching, runs in < 1ms.
 */

export type ProblemCategory =
  | "debugging"
  | "security"
  | "architecture"
  | "performance"
  | "testing"
  | "data"
  | "api"
  | "web"
  | "devops"
  | "refactoring"
  | "explanation"
  | "general";

export type CategoryActivation = {
  /** Short label shown in UI during processing */
  badge: string;
  /** Auto-enable cross-provider verification after response */
  autoVerify: boolean;
  /** Prefer team mode (planner → coder → reviewer → tester) when available */
  preferTeam: boolean;
  /** Upgrade solo → /auto for autonomous diagnosis */
  forceAuto: boolean;
  /** Injected into the prompt to steer the model */
  contextHint: string;
};

export type ClassificationResult = {
  category: ProblemCategory;
  /** 0–1: how confident we are about the category */
  confidence: number;
  activation: CategoryActivation;
};

// ── Feature activation config per category ───────────────────────────────────

const ACTIVATIONS: Record<ProblemCategory, CategoryActivation> = {
  security: {
    badge: "Security",
    autoVerify: true,
    preferTeam: true,
    forceAuto: false,
    contextHint:
      "Focus on security best practices, input validation, authentication, authorization, and OWASP Top 10. Never store secrets in plaintext.",
  },
  debugging: {
    badge: "Debug",
    autoVerify: true,
    preferTeam: false,
    forceAuto: true,
    contextHint:
      "Diagnose root cause systematically. Read error messages and stack traces carefully. Check recent changes first.",
  },
  architecture: {
    badge: "Architecture",
    autoVerify: false,
    preferTeam: true,
    forceAuto: false,
    contextHint:
      "Consider scalability, maintainability, SOLID principles, and separation of concerns.",
  },
  performance: {
    badge: "Performance",
    autoVerify: true,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Profile before optimizing. Focus on algorithmic complexity, caching strategies, and I/O reduction.",
  },
  testing: {
    badge: "Testing",
    autoVerify: true,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Cover happy path, edge cases, error handling, and boundary conditions. Prefer deterministic assertions.",
  },
  data: {
    badge: "Data",
    autoVerify: true,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Consider query efficiency, data integrity, migration safety, and schema evolution.",
  },
  api: {
    badge: "API",
    autoVerify: true,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Follow REST/GraphQL conventions. Validate inputs, handle errors gracefully, and version thoughtfully.",
  },
  web: {
    badge: "Web",
    autoVerify: false,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Consider accessibility, responsiveness, performance, and cross-browser compatibility.",
  },
  devops: {
    badge: "DevOps",
    autoVerify: false,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Ensure idempotency and rollback capability. Harden secrets management and resource limits.",
  },
  refactoring: {
    badge: "Refactor",
    autoVerify: true,
    preferTeam: false,
    forceAuto: false,
    contextHint:
      "Preserve existing behavior while improving structure. Make small, safe, reviewable steps.",
  },
  explanation: {
    badge: "Explain",
    autoVerify: false,
    preferTeam: false,
    forceAuto: false,
    contextHint: "Be clear and concise. Use concrete examples. Build understanding progressively.",
  },
  general: {
    badge: "",
    autoVerify: false,
    preferTeam: false,
    forceAuto: false,
    contextHint: "",
  },
};

// ── Patterns (ordered by descending priority weight) ─────────────────────────

const PATTERNS: Array<{ category: ProblemCategory; weight: number; matchers: RegExp[] }> = [
  {
    category: "security",
    weight: 10,
    matchers: [
      /\b(security|secure|authent|authoriz|oauth|jwt|token|secret|password|credential|encrypt|decrypt|hash|salt|csrf|xss|sql.?inject|vulnerabilit|pentest|exploit|attack|privilege|acl|rbac|cors|tls|ssl|owasp)\b/i,
      /(보안|인증|취약점|암호화|권한|비밀번호|토큰)/,
    ],
  },
  {
    category: "debugging",
    weight: 9,
    matchers: [
      /\b(bug|error|exception|crash|fail(?:ed|ing)?|broken|stack.?trace|undefined.?is.?not|null.?pointer|segfault|memory.?leak|race.?condition|deadlock|traceback|debug|diagnose|why.*not.?work|doesn'?t.?work|not.?working)\b/i,
      /(버그|에러|오류|크래시|안\s*됨|안\s*되는|실패|예외|왜\s*안|문제가)/,
    ],
  },
  {
    category: "architecture",
    weight: 8,
    matchers: [
      /\b(architect|design.?pattern|system.?design|microservice|monolith|domain.?driven|event.?driven|cqrs|ddd|solid|clean.?arch|hexagonal|layered|scalab|modular|decouple|abstraction|dependency.?inject)\b/i,
      /(아키텍처|설계|구조|패턴|마이크로서비스|의존성\s*주입)/,
    ],
  },
  {
    category: "performance",
    weight: 7,
    matchers: [
      /\b(performance|perf|optim(?:ize|ization|ise)?|speed.?up|slow|latency|throughput|bottleneck|profil(?:e|ing)|benchmark|memory.?usage|cpu.?usage|cach(?:e|ing)|memoiz|lazy.?load|bundle.?size)\b/i,
      /(성능|최적화|속도|느린|지연|병목|캐시)/,
    ],
  },
  {
    category: "testing",
    weight: 7,
    matchers: [
      /\b(unit.?tests?|integration.?tests?|e2e|end.?to.?end|test.?coverage|mock(?:ing)?|stub|spy|fixture|jest|vitest|pytest|mocha|cypress|playwright|tdd|bdd|write.?tests?|add.?tests?|generate.?tests?|test\s+(?:the|for|this|my)|(?:write|create|add)\s+tests?)\b/i,
      /(테스트\s*(작성|추가|생성|만들)|단위\s*테스트|통합\s*테스트|커버리지)/,
    ],
  },
  {
    category: "data",
    weight: 6,
    matchers: [
      /\b(database|sql|query|schema|migration|orm|prisma|sequelize|mongodb|postgres|mysql|sqlite|redis|elasticsearch|data.?model|relation|transaction|aggregate|etl|data.?transform)\b/i,
      /(데이터베이스|쿼리|스키마|마이그레이션|데이터\s*모델)/,
    ],
  },
  {
    category: "api",
    weight: 6,
    matchers: [
      /\b(rest(?:ful)?|graphql|grpc|endpoint|http\s*(?:get|post|put|patch|delete)|webhook|rate.?limit|pagination|api.?version(?:ing)?|openapi|swagger|middleware)\b/i,
      /(API|엔드포인트|라우트|미들웨어|웹훅)/,
    ],
  },
  {
    category: "web",
    weight: 6,
    matchers: [
      /\b(react|vue|angular|svelte|next\.?js|nuxt|html|css|tailwind|styled.?component|component|ui|ux|frontend|layout|responsive|animation|dom|hook|zustand|redux)\b/i,
      /(프론트엔드|컴포넌트|스타일|레이아웃|반응형)/,
    ],
  },
  {
    category: "devops",
    weight: 6,
    matchers: [
      /\b(docker|kubernetes|k8s|ci\/cd|pipeline|deploy(?:ment)?|terraform|ansible|helm|nginx|github.?action|gitlab.?ci|jenkins|prometheus|grafana|aws|gcp|azure|serverless|container)\b/i,
      /(도커|배포|쿠버네티스|파이프라인|모니터링|클라우드)/,
    ],
  },
  {
    category: "refactoring",
    weight: 5,
    matchers: [
      /\b(refactor|clean.?up|restructure|simplif(?:y|ication)|dry|extract\s+(?:function|class|method)|consolidat|technical.?debt|code.?smell)\b/i,
      /(리팩토링|정리|구조\s*개선|단순화|중복\s*제거)/,
    ],
  },
  {
    category: "explanation",
    weight: 4,
    matchers: [
      /\b(explain|what\s+is|how\s+does|why\s+does|what\s+does|walk\s+me\s+through|tell\s+me\s+about|describe|clarify|help\s+me\s+understand)\b/i,
      /(설명|이해|무엇|어떻게\s*동작|왜|알려줘|보여줘)/,
    ],
  },
];

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify a user message into a problem category.
 * Runs synchronously — no LLM, no I/O, < 1ms.
 */
export function classifyProblem(message: string): ClassificationResult {
  const text = message.trim();
  if (!text) {
    return { category: "general", confidence: 0, activation: ACTIVATIONS.general };
  }

  const scores = new Map<ProblemCategory, number>();

  for (const { category, weight, matchers } of PATTERNS) {
    let hits = 0;
    for (const rx of matchers) {
      const globalRx = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g");
      hits += (text.match(globalRx) ?? []).length;
    }
    if (hits > 0) {
      scores.set(category, (scores.get(category) ?? 0) + hits * weight);
    }
  }

  if (scores.size === 0) {
    return { category: "general", confidence: 0, activation: ACTIVATIONS.general };
  }

  let topCategory: ProblemCategory = "general";
  let topScore = 0;
  let totalScore = 0;

  for (const [cat, score] of scores) {
    totalScore += score;
    if (score > topScore) {
      topScore = score;
      topCategory = cat;
    }
  }

  // Confidence: share of top score relative to total, boosted for strong signal
  const ratio = topScore / Math.max(1, totalScore);
  const boost = topScore >= 20 ? 0.3 : topScore >= 10 ? 0.2 : topScore >= 5 ? 0.1 : 0;
  const confidence = Math.min(1, ratio + boost);

  return {
    category: topCategory,
    confidence,
    activation: ACTIVATIONS[topCategory],
  };
}
