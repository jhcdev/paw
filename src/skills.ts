import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type Skill = {
  name: string;
  description: string;
  prompt: string;
  source: "builtin" | "user" | "project";
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

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function loadSkillsFromDir(dir: string, source: "user" | "project"): Promise<Skill[]> {
  const skills: Skill[] = [];
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, file), "utf8");
        const { meta, body } = parseFrontmatter(raw);
        if (meta.name && body) {
          skills.push({
            name: meta.name,
            description: meta.description ?? "",
            prompt: body,
            source,
          });
        }
      } catch { continue; }
    }
  } catch {}
  return skills;
}

export async function loadSkills(cwd: string): Promise<Skill[]> {
  const skills = [...BUILTIN_SKILLS];

  // Load user skills from ~/.paw/skills/*.md
  await ensureDir(SKILLS_DIR);
  skills.push(...await loadSkillsFromDir(SKILLS_DIR, "user"));

  // Load project skills from .paw/skills/*.md
  skills.push(...await loadSkillsFromDir(path.join(cwd, PROJECT_SKILLS_DIR), "project"));

  return skills;
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

  const lines: string[] = [];
  if (grouped.builtin.length) {
    lines.push("Built-in:");
    for (const s of grouped.builtin) lines.push(`  /${s.name} — ${s.description}`);
  }
  if (grouped.user.length) {
    lines.push("\nUser (~/.paw/skills/):");
    for (const s of grouped.user) lines.push(`  /${s.name} — ${s.description}`);
  }
  if (grouped.project.length) {
    lines.push("\nProject (.paw/skills/):");
    for (const s of grouped.project) lines.push(`  /${s.name} — ${s.description}`);
  }
  return lines.join("\n");
}
