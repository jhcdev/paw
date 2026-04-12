/**
 * Smart Router — automatically selects the best execution mode
 * based on the user's message content.
 *
 * Instead of users manually choosing /auto, /pipe, /team, solo,
 * the router analyzes the prompt and picks the optimal mode.
 */

export type RouteDecision =
  | { mode: "solo" }
  | { mode: "builtin"; command: string }
  | { mode: "auto"; reason: string }
  | { mode: "pipe"; command: string; subMode: "analyze" | "fix" }
  | { mode: "team"; reason: string }
  | { mode: "skill"; skillName: string; context: string };

const AUTO_REASON = "Complex implementation task detected";

function buildRecallCommand(message: string): string {
  const trimmed = message.trim();
  const recentOnly = [
    /\bwhat were we working on\b/i,
    /\bshow recent sessions\b/i,
    /\brecent sessions\b/i,
    /\bwhat did we do recently\b/i,
    /우리가 뭐했지/,
    /최근 세션/,
    /뭘 했었지/,
  ].some((pattern) => pattern.test(trimmed));

  if (recentOnly) return "/sessions";

  const cleaned = trimmed
    .replace(/\b(do you remember|remember when|what did we do about|how did we fix|last time|in the previous session)\b/gi, " ")
    .replace(/(지난번|예전에|전에 했던|이전에 했던|우리가 뭐했지|어떻게 고쳤지|뭘 했었지)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();

  return cleaned ? `/sessions ${cleaned}` : "/sessions";
}

const BUILTIN_PATTERNS: { pattern: RegExp; command: string | ((message: string) => string) }[] = [
  { pattern: /\b(what (tools|tooling) (can you use|do you have)|available tools|tool list)\b/i, command: "/tools" },
  { pattern: /(사용 가능한 도구|툴 목록|도구 목록|쓸 수 있는 도구|사용가능한 도구)/, command: "/tools" },
  { pattern: /\b(what skills do you have|available skills|skill list|show skills)\b/i, command: "/skills" },
  { pattern: /(스킬 목록|사용 가능한 스킬|쓸 수 있는 스킬)/, command: "/skills" },
  { pattern: /\b(show memory|what do you remember|memory status|loaded memory)\b/i, command: "/memory" },
  { pattern: /(메모리 보여|기억하고 있는 것|저장된 메모리|메모리 상태)/, command: "/memory" },
  { pattern: /\b(list sessions|show sessions|past sessions|recent sessions)\b/i, command: "/sessions" },
  { pattern: /(세션 목록|지난 세션|최근 세션|과거 세션)/, command: "/sessions" },
  { pattern: /\b((show|current|what(?:'s| is))\s+(paw\s+)?(status|providers?|model|usage|cost)|provider status|model status|usage status|cost status)\b/i, command: "/status" },
  { pattern: /(상태 보여|현재 상태|provider 상태|모델 상태|사용량 상태|비용 상태)/, command: "/status" },
  { pattern: /\b(what files changed|show git status|show diff|recent commits|git status)\b/i, command: "/git" },
  { pattern: /(변경된 파일|깃 상태|git 상태|최근 커밋|diff 보여)/, command: "/git" },
  { pattern: /\b(agent status|show agents|subagent status|spawn status|parallel tasks)\b/i, command: "/agents status" },
  { pattern: /(에이전트 상태|서브에이전트 상태|spawn 상태|병렬 작업 상태)/, command: "/agents status" },
  { pattern: /\b(remember when|what did we do|what were we working on|last time|previous session|how did we fix)\b/i, command: buildRecallCommand },
  { pattern: /(지난번|예전에|전에 했던|우리가 뭐했지|어떻게 고쳤지|이전에 했던|뭘 했었지)/, command: buildRecallCommand },
];

// Patterns that suggest autonomous mode (EN + KO + ZH + JA)
const AUTO_PATTERNS = [
  /\b(implement|build|create|add|write|develop|make)\b/i,
  /\b(refactor|rewrite|redesign|restructure|migrate)\b/i,
  /\b(fix all|resolve all|update all|convert all)\b/i,
  /\b(set up|setup|configure|initialize|bootstrap)\b/i,
  /\b(find|identify|analyze|investigate|diagnose)\b.*\b(weak points?|issues?|problems?|bugs?|errors?)\b/i,
  /\b(find|identify|analyze|investigate|diagnose)\b.*\b(fix|repair|resolve)\b/i,
  /\b(find|identify|analyze|investigate|diagnose|audit)\b.*\b(improve|strengthen|harden|reinforce)\b/i,
  /\b(weak points?|weak areas?|gaps?|areas? to improve)\b.*\b(improve|strengthen|harden|reinforce)\b/i,
  /\b(fix|repair|resolve)\b.*\b(issues?|problems?|bugs?|errors?|tests?|build)\b/i,
  /(구현|만들어|추가해|개발|생성|작성해)/,
  /(리팩토링|리팩터|재작성|마이그레이션)/,
  /(모두|모든|전부|전체).*(수정|고치|해결|변환)/,
  /(설정|셋업|초기화|구성|세팅)/,
  /(파악|분석|진단).*(고치|고쳐|수정|해결)/,
  /(약점|문제점|문제|오류|에러|버그).*(고치|고쳐|수정|해결)/,
  /(강화|보강|개선).*(부분|지점|곳|기능).*(찾|파악|분석).*(강화|보강|개선)/,
  /(부분|지점|곳|기능).*(찾|파악|분석).*(강화|보강|개선)/,
  /(고치|고쳐|수정|해결).*(문제|오류|에러|버그|테스트|빌드)/,
  /(実装|作成|追加|開発)/,
  /(创建|实现|添加|开发)/,
];

// Patterns that suggest pipe mode
const PIPE_PATTERNS = [
  /^(run|execute|start)\s+(npm|yarn|pnpm|node|python|go|cargo|make|docker|kubectl)/i,
  /^(npm|yarn|pnpm)\s+(test|run|build|start|lint)/i,
  /^(tsc|eslint|prettier|jest|vitest|mocha|pytest)/i,
  /^(docker|docker-compose|kubectl|terraform|aws)/i,
  /^(git\s+(push|pull|merge|rebase|bisect))/i,
];

// Patterns that suggest team mode
const TEAM_PATTERNS = [
  /\b(with tests?|and review|and optimize|production.?ready|comprehensive)\b/i,
  /\b(full|complete|thorough|robust|battle.?tested)\b/i,
];

// Patterns for built-in skills (EN + KO + ZH + JA)
const SKILL_PATTERNS: [RegExp, string][] = [
  [/\b(review|check)\b.*\b(code|file|function|module|class)\b/i, "review"],
  [/(리뷰|검토|코드\s*리뷰|코드\s*검토)/, "review"],
  [/\b(explain|what does|how does|what is)\b/i, "explain"],
  [/(설명|이해|뭐하는|어떻게\s*동작)/, "explain"],
  [/\b(optimize|make.*faster|improve.*performance|speed up)\b/i, "optimize"],
  [/(최적화|성능\s*개선|빠르게)/, "optimize"],
  [/\b(test|write tests?|add tests?|generate tests?)\b/i, "test"],
  [/(테스트\s*(작성|추가|생성|만들))/, "test"],
  [/\b(document|add docs?|write docs?|jsdoc|tsdoc)\b/i, "document"],
  [/(문서화|문서\s*(작성|추가|생성))/, "document"],
  [/\b(commit|git commit|commit message)\b/i, "commit"],
  [/(커밋\s*메시지|커밋\s*작성)/, "commit"],
  [/\b(refactor)\b.*\b(this|the|my|code|module|file)\b/i, "refactor"],
  [/(리팩토링|리팩터링)/, "refactor"],
];

function isStrongAutoRequest(message: string): boolean {
  if (message.length < 12) return false;
  return AUTO_PATTERNS.slice(4).some((pattern) => pattern.test(message));
}

export function routeMessage(message: string, isTeamMode: boolean, hasMultipleProviders: boolean): RouteDecision {
  const trimmed = message.trim();

  // 1. Check for pipe patterns (only pure shell commands, no mixed natural language)
  const isShellOnly = /^[a-zA-Z0-9_\-./\s:@^~=]+$/.test(trimmed) && trimmed.length < 100;
  if (isShellOnly) {
    for (const pattern of PIPE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          mode: "pipe",
          command: trimmed.replace(/^(run|execute|start)\s+/i, ""),
          subMode: "analyze",
        };
      }
    }
  }

  // 2. Check for builtin command intents
  for (const entry of BUILTIN_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return {
        mode: "builtin",
        command: typeof entry.command === "function" ? entry.command(trimmed) : entry.command,
      };
    }
  }

  // 3. Check for skill patterns
  for (const [pattern, skillName] of SKILL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { mode: "skill", skillName, context: trimmed };
    }
  }

  // 4. Check for auto patterns (large tasks)
  // Only trigger auto for genuinely complex tasks — require longer prompts
  // to avoid routing simple "작성해줘" or "create X" to slow autonomous mode
  const hasCJK = /[\u3000-\u9fff\uac00-\ud7af]/.test(trimmed);
  const minLen = hasCJK ? 30 : 50;
  if (isStrongAutoRequest(trimmed)) {
    return { mode: "auto", reason: AUTO_REASON };
  }
  for (const pattern of AUTO_PATTERNS) {
    if (pattern.test(trimmed) && trimmed.length > minLen) {
      return { mode: "auto", reason: AUTO_REASON };
    }
  }

  // 5. Check for team patterns (if multiple providers available)
  if (hasMultipleProviders) {
    for (const pattern of TEAM_PATTERNS) {
      if (pattern.test(trimmed) && trimmed.length > 20) {
        return { mode: "team", reason: "Quality-sensitive task detected" };
      }
    }
  }

  // 6. If already in team mode, use team
  if (isTeamMode) {
    return { mode: "team", reason: "Team mode active" };
  }

  // 7. Default: solo
  return { mode: "solo" };
}
