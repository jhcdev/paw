import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type Skill = {
  name: string;
  description: string;
  prompt: string;
  source: "builtin" | "user" | "project";
};

const SKILLS_DIR = path.join(os.homedir(), ".cats-claw", "skills");
const PROJECT_SKILLS_DIR = ".cats-claw/skills";

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

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function loadSkills(cwd: string): Promise<Skill[]> {
  const skills = [...BUILTIN_SKILLS];

  // Load user skills from ~/.cats-claw/skills/
  try {
    await ensureDir(SKILLS_DIR);
    const files = await fs.readdir(SKILLS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(SKILLS_DIR, file), "utf8");
        const skill = JSON.parse(raw) as Skill;
        skill.source = "user";
        skills.push(skill);
      } catch { continue; }
    }
  } catch {}

  // Load project skills from .cats-claw/skills/
  try {
    const projectDir = path.join(cwd, PROJECT_SKILLS_DIR);
    const files = await fs.readdir(projectDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(projectDir, file), "utf8");
        const skill = JSON.parse(raw) as Skill;
        skill.source = "project";
        skills.push(skill);
      } catch { continue; }
    }
  } catch {}

  return skills;
}

export async function saveSkill(skill: Omit<Skill, "source">, scope: "user" | "project", cwd: string): Promise<void> {
  const dir = scope === "user" ? SKILLS_DIR : path.join(cwd, PROJECT_SKILLS_DIR);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, `${skill.name}.json`), JSON.stringify(skill, null, 2), { mode: 0o600 });
}

export async function deleteSkill(name: string, scope: "user" | "project", cwd: string): Promise<boolean> {
  const dir = scope === "user" ? SKILLS_DIR : path.join(cwd, PROJECT_SKILLS_DIR);
  try {
    await fs.unlink(path.join(dir, `${name}.json`));
    return true;
  } catch { return false; }
}

export function formatSkillList(skills: Skill[]): string {
  const grouped: Record<string, Skill[]> = { builtin: [], user: [], project: [] };
  for (const s of skills) (grouped[s.source] ?? []).push(s);

  const lines: string[] = [];
  if (grouped.builtin.length) {
    lines.push("Built-in:");
    for (const s of grouped.builtin) lines.push(`  /${s.name} — ${s.description}`);
  }
  if (grouped.user.length) {
    lines.push("\nUser (~/.cats-claw/skills/):");
    for (const s of grouped.user) lines.push(`  /${s.name} — ${s.description}`);
  }
  if (grouped.project.length) {
    lines.push("\nProject (.cats-claw/skills/):");
    for (const s of grouped.project) lines.push(`  /${s.name} — ${s.description}`);
  }
  return lines.join("\n");
}
