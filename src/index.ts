import path from "node:path";
import pc from "picocolors";
import { CodingAgent } from "./agent.js";
import { interactiveLogin, listSavedProviders, logout } from "./auth.js";
import { startRepl } from "./cli.js";
import { mcpCli } from "./mcp-cli.js";
import { formatModelList, getAllModels } from "./model-catalog.js";
import { detectProviders } from "./multi-provider.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./types.js";

type ParsedArgs = {
  cwd: string;
  provider?: ProviderName;
  model?: string;
  prompt?: string;
  showHelp: boolean;
  showTools: boolean;
  doLogout: boolean;
  logoutProvider?: ProviderName;
  doList: boolean;
};

const VALID_PROVIDERS = new Set<string>(["anthropic", "openai", "gemini", "groq", "openrouter", "ollama"]);

function printHelp(): void {
  process.stdout.write(`${pc.bold(pc.cyan("Cat's Claw"))} — Multi-provider terminal coding assistant\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  npm start                          Interactive login + REPL\n`);
  process.stdout.write(`  npm start -- "summarize this"      One-shot prompt\n`);
  process.stdout.write(`  npm start -- --provider gemini     Skip provider menu\n\n`);
  process.stdout.write(`Flags:\n`);
  process.stdout.write(`  --help              Show this help\n`);
  process.stdout.write(`  --tools             List available tools\n`);
  process.stdout.write(`  --cwd <dir>         Set workspace root\n`);
  process.stdout.write(`  --provider <name>   anthropic, openai, gemini, groq, openrouter, ollama\n`);
  process.stdout.write(`  --model <id>        Override model for the session\n`);
  process.stdout.write(`  --list              Show saved credentials\n`);
  process.stdout.write(`  --logout [provider] Remove saved credentials\n\n`);
  process.stdout.write(`MCP Commands:\n`);
  process.stdout.write(`  mcp list                              List MCP servers\n`);
  process.stdout.write(`  mcp add --transport http <name> <url>  Add HTTP/SSE server\n`);
  process.stdout.write(`  mcp add <name> -- <cmd> [args...]      Add stdio server\n`);
  process.stdout.write(`  mcp add-json <name> '<json>'           Add from JSON\n`);
  process.stdout.write(`  mcp remove <name>                      Remove server\n`);
  process.stdout.write(`  mcp get <name>                         Show server config\n`);
}

function parseArgs(argv: string[]): ParsedArgs {
  let cwd = process.cwd();
  let provider: ProviderName | undefined;
  let model: string | undefined;
  const promptParts: string[] = [];
  let showHelp = false;
  let showTools = false;
  let doLogout = false;
  let logoutProvider: ProviderName | undefined;
  let doList = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--help") { showHelp = true; continue; }
    if (arg === "--tools") { showTools = true; continue; }
    if (arg === "--list") { doList = true; continue; }
    if (arg === "--logout") {
      doLogout = true;
      const next = argv[i + 1];
      if (next && VALID_PROVIDERS.has(next)) { logoutProvider = next as ProviderName; i++; }
      continue;
    }
    if (arg === "--cwd") { cwd = path.resolve(argv[i + 1] ?? cwd); i++; continue; }
    if (arg === "--provider") {
      const next = argv[i + 1];
      if (next && VALID_PROVIDERS.has(next)) provider = next as ProviderName;
      i++; continue;
    }
    if (arg === "--model") { model = argv[i + 1]; i++; continue; }
    promptParts.push(arg);
  }

  const parsed: ParsedArgs = { cwd, showHelp, showTools, doLogout, doList };
  if (provider) parsed.provider = provider;
  if (model) parsed.model = model;
  if (logoutProvider) parsed.logoutProvider = logoutProvider;
  if (promptParts.length > 0) parsed.prompt = promptParts.join(" ");
  return parsed;
}

async function main(): Promise<void> {
  // Handle "mcp" subcommand before anything else
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "mcp") {
    const cwd = rawArgs.includes("--cwd")
      ? path.resolve(rawArgs[rawArgs.indexOf("--cwd") + 1] ?? process.cwd())
      : process.cwd();
    await mcpCli(rawArgs.slice(1), cwd);
    return;
  }

  const args = parseArgs(rawArgs);

  if (args.showHelp) { printHelp(); return; }
  if (args.showTools) {
    process.stdout.write(`Available tools:\n`);
    for (const t of toolDefinitions) process.stdout.write(`  ${pc.cyan(t.name)}: ${t.description}\n`);
    return;
  }
  if (args.doList) { await listSavedProviders(); return; }
  if (args.doLogout) { await logout(args.logoutProvider); return; }

  const auth = await interactiveLogin({
    provider: args.provider,
    model: args.model,
  });

  const agent = new CodingAgent({
    provider: auth.provider,
    apiKey: auth.apiKey,
    model: auth.model,
    cwd: args.cwd,
    baseUrl: auth.baseUrl,
  });

  await Promise.all([agent.initMcp(args.cwd), agent.initTeam()]);

  if (args.prompt) {
    // Handle slash commands in one-shot mode
    if (["/status", "/settings", "/providers", "/cost", "/version"].includes(args.prompt)) {
      const registered = agent.getMulti().getRegistered();
      const teamRoles = agent.getTeam().getRoles();
      process.stdout.write(`Cat's Claw v1.0.0\n`);
      process.stdout.write(`Active: ${pc.cyan(agent.getActiveProvider())}/${agent.getActiveModel()}\n`);
      process.stdout.write(`\nProviders (${registered.length}):\n`);
      for (const p of registered) process.stdout.write(`  ${p.name === agent.getActiveProvider() ? "* " : "  "}${p.name} — ${p.model}\n`);
      if (teamRoles.length > 0) {
        process.stdout.write(`\nTeam Roles:\n`);
        for (const r of teamRoles) process.stdout.write(`  ${r.role.padEnd(10)} ${r.provider}/${r.model}\n`);
      }
      process.stdout.write(`\nUsage:\n${agent.tracker.formatReport()}\n`);
      process.stdout.write(`MCP: ${agent.getMcpStatus().length} server(s)\n`);
      await agent.shutdown(); return;
    }
    if (args.prompt === "/model" || args.prompt === "/models" || args.prompt?.startsWith("/models ")) {
      const all = getAllModels();
      const registered = new Set(agent.getMulti().getRegistered().map((p) => p.name));
      process.stdout.write(`Active: ${agent.getActiveProvider()}/${agent.getActiveModel()}\n\n`);
      for (const g of all) {
        if (!registered.has(g.provider) && g.provider !== agent.getActiveProvider()) continue;
        const active = g.provider === agent.getActiveProvider();
        process.stdout.write(`${active ? "* " : "  "}${g.provider}:\n${formatModelList(g.provider, active ? agent.getActiveModel() : undefined)}\n\n`);
      }
      process.stdout.write(`Switch: /model <provider> <number or id>\n`);
      await agent.shutdown(); return;
    }
    if (["/git", "/diff", "/log"].includes(args.prompt)) {
      const { exec: e } = await import("node:child_process");
      const { promisify: p } = await import("node:util");
      const run = p(e);
      try {
        const { stdout: status } = await run("git status --short", { cwd: args.cwd });
        process.stdout.write(`Status:\n${status.trim() || "  (clean)"}\n`);
      } catch { process.stdout.write("Not a git repository.\n"); }
      try {
        const { stdout: diff } = await run("git diff --stat", { cwd: args.cwd });
        if (diff.trim()) process.stdout.write(`\nDiff:\n${diff.trim()}\n`);
      } catch {}
      try {
        const { stdout: log } = await run("git log --oneline -5", { cwd: args.cwd });
        if (log.trim()) process.stdout.write(`\nRecent:\n${log.trim()}\n`);
      } catch {}
      await agent.shutdown(); return;
    }
    if (args.prompt === "/doctor") {
      process.stdout.write(`Cat's Claw v1.0.0\n`);
      process.stdout.write(`Node: ${process.version} | ${process.platform} ${process.arch}\n`);
      process.stdout.write(`Provider: ${agent.getActiveProvider()}/${agent.getActiveModel()}\n`);
      process.stdout.write(`Providers: ${agent.getMulti().getRegistered().map((p) => p.name).join(", ")}\n`);
      process.stdout.write(`MCP: ${agent.getMcpStatus().length} server(s)\n`);
      await agent.shutdown(); return;
    }
    if (args.prompt.startsWith("/team ")) {
      const teamPrompt = args.prompt.slice(6).trim();
      if (!agent.getTeam().isReady()) {
        process.stderr.write(`${pc.red("Error:")} No providers configured for team mode.\n`);
      } else {
        const result = await agent.getTeam().run(teamPrompt, (phase, provider, model) => {
          process.stdout.write(`${pc.gray(`=^.^= ${phase} (${provider}/${model})...`)}\n`);
        });
        for (const p of result.phases) {
          process.stdout.write(`\n${pc.cyan(`--- ${p.role.toUpperCase()} (${p.provider}/${p.model}, ${p.ms}ms) ---`)}\n`);
          process.stdout.write(`${p.text}\n`);
        }
        process.stdout.write(`\n${pc.gray(`Total: ${result.totalMs}ms`)}\n`);
      }
    } else if (args.prompt.startsWith("/ask ")) {
      const parts = args.prompt.slice(5).trim().split(/\s+/);
      const target = parts[0] as ProviderName;
      const askPrompt = parts.slice(1).join(" ");
      if (!target || !askPrompt) {
        process.stderr.write(`Usage: /ask <provider> <prompt>\n`);
      } else {
        const result = await agent.getMulti().ask(target, askPrompt);
        process.stdout.write(`[${target}] ${result.text}\n`);
      }
    } else {
      const result = await agent.runTurn(args.prompt);
      process.stdout.write(`${result.text}\n`);
    }
    await agent.shutdown();
    return;
  }

  await startRepl(agent, { provider: auth.provider, model: auth.model, cwd: args.cwd });
  await agent.shutdown();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red(`Error: ${message}`)}\n`);
  process.exitCode = 1;
});
