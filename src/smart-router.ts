/**
 * Smart Router — automatically selects the best execution mode
 * based on the user's message content.
 *
 * Instead of users manually choosing /auto, /pipe, /team, solo,
 * the router analyzes the prompt and picks the optimal mode.
 */

export type RouteDecision =
  | { mode: "solo" }
  | { mode: "auto"; reason: string }
  | { mode: "pipe"; command: string; subMode: "analyze" | "fix" }
  | { mode: "team"; reason: string }
  | { mode: "skill"; skillName: string; context: string };

const AUTO_REASON = "Complex implementation task detected";

// Patterns that suggest autonomous mode (EN + KO + ZH + JA)
const AUTO_PATTERNS = [
  /\b(implement|build|create|add|write|develop|make)\b/i,
  /\b(refactor|rewrite|redesign|restructure|migrate)\b/i,
  /\b(fix all|resolve all|update all|convert all)\b/i,
  /\b(set up|setup|configure|initialize|bootstrap)\b/i,
  /\b(find|identify|analyze|investigate|diagnose)\b.*\b(weak points?|issues?|problems?|bugs?|errors?)\b/i,
  /\b(find|identify|analyze|investigate|diagnose)\b.*\b(fix|repair|resolve)\b/i,
  /\b(fix|repair|resolve)\b.*\b(issues?|problems?|bugs?|errors?|tests?|build)\b/i,
  /(구현|만들어|추가해|개발|생성|작성해)/,
  /(리팩토링|리팩터|재작성|마이그레이션)/,
  /(모두|모든|전부|전체).*(수정|고치|해결|변환)/,
  /(설정|셋업|초기화|구성|세팅)/,
  /(파악|분석|진단).*(고치|고쳐|수정|해결)/,
  /(약점|문제점|문제|오류|에러|버그).*(고치|고쳐|수정|해결)/,
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

  // 2. Check for skill patterns
  for (const [pattern, skillName] of SKILL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { mode: "skill", skillName, context: trimmed };
    }
  }

  // 3. Check for auto patterns (large tasks)
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

  // 4. Check for team patterns (if multiple providers available)
  if (hasMultipleProviders) {
    for (const pattern of TEAM_PATTERNS) {
      if (pattern.test(trimmed) && trimmed.length > 20) {
        return { mode: "team", reason: "Quality-sensitive task detected" };
      }
    }
  }

  // 5. If already in team mode, use team
  if (isTeamMode) {
    return { mode: "team", reason: "Team mode active" };
  }

  // 6. Default: solo
  return { mode: "solo" };
}
