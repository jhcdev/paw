import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadSkills, renderSkill, formatSkillList, type Skill } from "./skills.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paw-skills-test-"));
  fakeHome = path.join(tmpDir, "_home");
  await fs.mkdir(path.join(fakeHome, ".paw", "skills"), { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: create a flat skill file
async function createFlatSkill(dir: string, filename: string, frontmatter: Record<string, string>, body: string) {
  await fs.mkdir(dir, { recursive: true });
  const lines = ["---", ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), "---", "", body];
  await fs.writeFile(path.join(dir, filename), lines.join("\n"), "utf8");
}

// Helper: create a directory-based skill (SKILL.md)
async function createDirSkill(baseDir: string, skillName: string, frontmatter: Record<string, string>, body: string) {
  const skillDir = path.join(baseDir, skillName);
  await fs.mkdir(skillDir, { recursive: true });
  const lines = ["---", ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`), "---", "", body];
  await fs.writeFile(path.join(skillDir, "SKILL.md"), lines.join("\n"), "utf8");
}

describe("loadSkills", () => {
  it("includes builtin skills", async () => {
    const skills = await loadSkills(tmpDir);
    const builtins = skills.filter(s => s.source === "builtin");
    expect(builtins.length).toBeGreaterThan(0);
    expect(builtins.find(s => s.name === "review")).toBeDefined();
    expect(builtins.find(s => s.name === "commit")).toBeDefined();
  });

  it("loads flat file skills from .paw/skills/", async () => {
    const dir = path.join(tmpDir, ".paw", "skills");
    await createFlatSkill(dir, "deploy.md", { name: "deploy", description: "Deploy app" }, "Deploy $ARGUMENTS");

    const skills = await loadSkills(tmpDir);
    const deploy = skills.find(s => s.name === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.source).toBe("project");
    expect(deploy!.description).toBe("Deploy app");
  });

  it("loads directory-based skills (SKILL.md)", async () => {
    const dir = path.join(tmpDir, ".paw", "skills");
    await createDirSkill(dir, "explain-code", {
      name: "explain-code",
      description: "Explains code with diagrams",
    }, "When explaining code, include an analogy.");

    const skills = await loadSkills(tmpDir);
    const skill = skills.find(s => s.name === "explain-code");
    expect(skill).toBeDefined();
    expect(skill!.source).toBe("project");
    expect(skill!.prompt).toContain("analogy");
    expect(skill!.skillDir).toBe(path.join(dir, "explain-code"));
  });

  it("parses extended frontmatter fields", async () => {
    const dir = path.join(tmpDir, ".paw", "skills");
    await createFlatSkill(dir, "deploy.md", {
      name: "deploy",
      description: "Deploy the app",
      "argument-hint": "[environment]",
      "disable-model-invocation": "true",
      "user-invocable": "true",
      "allowed-tools": "Bash Read",
      context: "fork",
    }, "Deploy to $ARGUMENTS");

    const skills = await loadSkills(tmpDir);
    const deploy = skills.find(s => s.name === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.argumentHint).toBe("[environment]");
    expect(deploy!.disableModelInvocation).toBe(true);
    expect(deploy!.userInvocable).toBe(true);
    expect(deploy!.allowedTools).toEqual(["Bash", "Read"]);
    expect(deploy!.context).toBe("fork");
  });

  // Note: user skills from ~/.paw/skills/ use a module-level constant (os.homedir() at import time),
  // so mocking homedir doesn't affect it. User skill loading is tested via the flat file pattern above.

  it("handles empty project directory gracefully", async () => {
    // Create empty .paw/skills/
    await fs.mkdir(path.join(tmpDir, ".paw", "skills"), { recursive: true });
    const skills = await loadSkills(tmpDir);
    // Should have builtins + possibly real user skills, but no project skills
    const projectSkills = skills.filter(s => s.source === "project");
    expect(projectSkills).toHaveLength(0);
  });
});

describe("renderSkill", () => {
  const baseSkill: Skill = {
    name: "test",
    description: "Test skill",
    prompt: "Fix issue $ARGUMENTS",
    source: "builtin",
  };

  it("replaces $ARGUMENTS with args", async () => {
    const result = await renderSkill(baseSkill, "123", tmpDir);
    expect(result).toBe("Fix issue 123");
  });

  it("replaces $ARGUMENTS[N] with indexed args", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Migrate $ARGUMENTS[0] from $ARGUMENTS[1] to $ARGUMENTS[2]" };
    const result = await renderSkill(skill, "SearchBar React Vue", tmpDir);
    expect(result).toBe("Migrate SearchBar from React to Vue");
  });

  it("replaces $N shorthand with indexed args", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Migrate $0 from $1 to $2" };
    const result = await renderSkill(skill, "SearchBar React Vue", tmpDir);
    expect(result).toBe("Migrate SearchBar from React to Vue");
  });

  it("appends ARGUMENTS when no $ARGUMENTS reference in prompt", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Deploy the application" };
    const result = await renderSkill(skill, "production", tmpDir);
    expect(result).toContain("Deploy the application");
    expect(result).toContain("ARGUMENTS: production");
  });

  it("does not append ARGUMENTS when args are empty", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Deploy the application" };
    const result = await renderSkill(skill, "", tmpDir);
    expect(result).toBe("Deploy the application");
    expect(result).not.toContain("ARGUMENTS:");
  });

  it("handles missing indexed args gracefully", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Do $0 and $1 and $2" };
    const result = await renderSkill(skill, "first", tmpDir);
    expect(result).toBe("Do first and  and ");
  });

  it("executes !`command` and replaces with output", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Current dir: !`echo hello-world`" };
    const result = await renderSkill(skill, "", tmpDir);
    expect(result).toContain("hello-world");
    expect(result).not.toContain("!`");
  });

  it("handles failed !`command` gracefully", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Result: !`nonexistent-command-xyz 2>/dev/null`" };
    const result = await renderSkill(skill, "", tmpDir);
    expect(result).toContain("(command failed:");
  });

  it("replaces ${CLAUDE_SKILL_DIR} with skillDir", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Run ${CLAUDE_SKILL_DIR}/scripts/test.sh", skillDir: "/my/skill/dir" };
    const result = await renderSkill(skill, "", tmpDir);
    expect(result).toBe("Run /my/skill/dir/scripts/test.sh");
  });

  it("falls back to cwd when no skillDir", async () => {
    const skill: Skill = { ...baseSkill, prompt: "Run ${CLAUDE_SKILL_DIR}/test.sh" };
    const result = await renderSkill(skill, "", tmpDir);
    expect(result).toBe(`Run ${tmpDir}/test.sh`);
  });
});

describe("formatSkillList", () => {
  it("shows argumentHint after skill name", () => {
    const skills: Skill[] = [
      { name: "deploy", description: "Deploy app", prompt: "", source: "user", argumentHint: "[env]" },
    ];
    const result = formatSkillList(skills);
    expect(result).toContain("/deploy [env]");
  });

  it("shows (user-only) for disableModelInvocation", () => {
    const skills: Skill[] = [
      { name: "deploy", description: "Deploy app", prompt: "", source: "user", disableModelInvocation: true },
    ];
    const result = formatSkillList(skills);
    expect(result).toContain("(user-only)");
  });

  it("groups by source", () => {
    const skills: Skill[] = [
      { name: "review", description: "Review", prompt: "", source: "builtin" },
      { name: "my-tool", description: "My tool", prompt: "", source: "user" },
      { name: "proj-tool", description: "Project", prompt: "", source: "project" },
    ];
    const result = formatSkillList(skills);
    expect(result).toContain("Built-in:");
    expect(result).toContain("User");
    expect(result).toContain("Project");
  });
});
