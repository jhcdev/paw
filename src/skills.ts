import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";

export type Skill = {
  name: string;
  description: string;
  prompt: string;
  source: "builtin" | "user" | "project";
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  context?: "fork";
  skillDir?: string;
};

const SKILLS_DIR = path.join(os.homedir(), ".paw", "skills");
const PROJECT_SKILLS_DIR = ".paw/skills";

const BUILTIN_SKILLS: Skill[] = [
  {
    name: "review",
    description: "Review code for bugs, security, and best practices",
    prompt: "Review the following code for bugs, security vulnerabilities, performance issues, and best practices. Be specific with file:line references.",
    source: "builtin",
  },
  {
    name: "refactor",
    description: "Suggest refactoring improvements",
    prompt: "Analyze the code and suggest refactoring improvements. Focus on readability, maintainability, and reducing complexity. Show before/after examples.",
    source: "builtin",
  },
  {
    name: "test",
    description: "Generate test cases",
    prompt: "Write comprehensive test cases for the code. Cover: unit tests, edge cases, error handling, and boundary conditions.",
    source: "builtin",
  },
  {
    name: "explain",
    description: "Explain code in detail",
    prompt: "Explain this code in detail. Cover: what it does, how it works, key design decisions, and potential issues.",
    source: "builtin",
  },
  {
    name: "optimize",
    description: "Optimize code for performance",
    prompt: "Analyze the code for performance bottlenecks and suggest optimizations. Show benchmarks or complexity analysis where applicable.",
    source: "builtin",
  },
  {
    name: "document",
    description: "Generate documentation",
    prompt: "Generate comprehensive documentation for this code including: JSDoc/TSDoc comments, README sections, usage examples, and API reference.",
    source: "builtin",
  },
  {
    name: "commit",
    description: "Generate a commit message",
    prompt: "Look at the current git diff and generate a conventional commit message. Format: type(scope): description. Include a body if the change is complex.",
    source: "builtin",
  },
];

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2]!.trim() };
}

function toFrontmatter(meta: Record<string, string>, body: string): string {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

function buildSkillFromMeta(
  meta: Record<string, string>,
  body: string,
  source: "user" | "project",
  skillDir?: string,
): Skill | null {
  if (!meta.name || !body) return null;

  const skill: Skill = {
    name: meta.name,
    description: meta.description ?? "",
    prompt: body,
    source,
  };

  // Parse extended frontmatter (hyphenated YAML keys -> camelCase)
  if (meta["argument-hint"]) skill.argumentHint = meta["argument-hint"];
  if (meta["disable-model-invocation"] !== undefined) {
    skill.disableModelInvocation = meta["disable-model-invocation"] === "true";
  }
  if (meta["user-invocable"] !== undefined) {
    skill.userInvocable = meta["user-invocable"] === "true";
  }
  if (meta["allowed-tools"]) {
    skill.allowedTools = meta["allowed-tools"].split(/\s+/).filter(Boolean);
  }
  if (meta.context === "fork") skill.context = "fork";
  if (skillDir) skill.skillDir = skillDir;

  return skill;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function loadSkillsFromDir(dir: string, source: "user" | "project"): Promise<Skill[]> {
  const skills: Skill[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        // Directory-based skill: skills/name/SKILL.md
        const skillMdPath = path.join(fullPath, "SKILL.md");
        try {
          const raw = await fs.readFile(skillMdPath, "utf8");
          const { meta, body } = parseFrontmatter(raw);
          const skill = buildSkillFromMeta(meta, body, source, fullPath);
          if (skill) skills.push(skill);
        } catch { continue; }
      } else if (entry.endsWith(".md")) {
        // Flat file skill: skills/name.md (backward compatible)
        const raw = await fs.readFile(fullPath, "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const skill = buildSkillFromMeta(meta, body, source);
        if (skill) skills.push(skill);
      }
    } catch { continue; }
  }

  return skills;
}

export async function loadSkills(cwd: string): Promise<Skill[]> {
  const skills = [...BUILTIN_SKILLS];

  // Load user skills from ~/.paw/skills/
  await ensureDir(SKILLS_DIR);
  skills.push(...await loadSkillsFromDir(SKILLS_DIR, "user"));

  // Load project skills from .paw/skills/
  skills.push(...await loadSkillsFromDir(path.join(cwd, PROJECT_SKILLS_DIR), "project"));

  return skills;
}

function execCommand(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        resolve(`(command failed: ${error.message})`);
      } else {
        resolve(String(stdout));
      }
    });
  });
}

export async function renderSkill(skill: Skill, args: string, cwd: string): Promise<string> {
  let prompt = skill.prompt;

  // 1. $ARGUMENTS substitution
  const argParts = args.trim() ? args.trim().split(/\s+/) : [];
  const hasArgumentsRef = /\$ARGUMENTS|\$\d+/.test(prompt);

  // Replace indexed forms: $ARGUMENTS[N] then $N shorthand
  prompt = prompt.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx) => argParts[Number(idx)] ?? "");
  prompt = prompt.replace(/\$(\d+)/g, (_, idx) => argParts[Number(idx)] ?? "");
  // Replace full $ARGUMENTS
  prompt = prompt.replace(/\$ARGUMENTS/g, args);

  // If no $ARGUMENTS/$N reference existed and args provided, append
  if (!hasArgumentsRef && args.trim()) {
    prompt += `\n\nARGUMENTS: ${args}`;
  }

  // 2. !`command` dynamic injection
  const cmdPattern = /!`([^`]+)`/g;
  const cmdMatches = [...prompt.matchAll(cmdPattern)];
  for (const m of cmdMatches) {
    const result = await execCommand(m[1]!, cwd, 10000);
    prompt = prompt.replace(m[0], result.trimEnd());
  }

  // 3. ${CLAUDE_SKILL_DIR} substitution
  const skillDir = skill.skillDir ?? cwd;
  prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);

  return prompt;
}

export async function saveSkill(skill: Omit<Skill, "source">, scope: "user" | "project", cwd: string): Promise<void> {
  const dir = scope === "user" ? SKILLS_DIR : path.join(cwd, PROJECT_SKILLS_DIR);
  await ensureDir(dir);
  const content = toFrontmatter(
    { name: skill.name, description: skill.description },
    skill.prompt,
  );
  await fs.writeFile(path.join(dir, `${skill.name}.md`), content, { mode: 0o600 });
}

export async function deleteSkill(name: string, scope: "user" | "project", cwd: string): Promise<boolean> {
  const dir = scope === "user" ? SKILLS_DIR : path.join(cwd, PROJECT_SKILLS_DIR);
  try {
    await fs.unlink(path.join(dir, `${name}.md`));
    return true;
  } catch { return false; }
}

export function formatSkillList(skills: Skill[]): string {
  const grouped: Record<string, Skill[]> = { builtin: [], user: [], project: [] };
  for (const s of skills) (grouped[s.source] ?? []).push(s);

  const formatEntry = (s: Skill): string => {
    const hint = s.argumentHint ? ` ${s.argumentHint}` : "";
    const flags = s.disableModelInvocation ? " (user-only)" : "";
    return `  /${s.name}${hint} — ${s.description}${flags}`;
  };

  const lines: string[] = [];
  if (grouped.builtin.length) {
    lines.push("Built-in:");
    for (const s of grouped.builtin) lines.push(formatEntry(s));
  }
  if (grouped.user.length) {
    lines.push("\nUser (~/.paw/skills/):");
    for (const s of grouped.user) lines.push(formatEntry(s));
  }
  if (grouped.project.length) {
    lines.push("\nProject (.paw/skills/):");
    for (const s of grouped.project) lines.push(formatEntry(s));
  }
  return lines.join("\n");
}
