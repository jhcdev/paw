import { promises as fs } from "node:fs";
import path from "node:path";
import pc from "picocolors";

type McpServerConfig = {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

function configPath(cwd: string): string {
  return path.join(cwd, ".mcp.json");
}

async function readConfig(cwd: string): Promise<McpConfigFile> {
  try {
    const raw = await fs.readFile(configPath(cwd), "utf8");
    return JSON.parse(raw) as McpConfigFile;
  } catch {
    return { mcpServers: {} };
  }
}

async function writeConfig(cwd: string, config: McpConfigFile): Promise<void> {
  await fs.writeFile(configPath(cwd), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function mcpCli(argv: string[], cwd: string): Promise<void> {
  const sub = argv[0];

  if (!sub || sub === "help") {
    printMcpHelp();
    return;
  }

  if (sub === "list") {
    await mcpList(cwd);
    return;
  }

  if (sub === "add") {
    await mcpAdd(argv.slice(1), cwd);
    return;
  }

  if (sub === "add-json") {
    await mcpAddJson(argv.slice(1), cwd);
    return;
  }

  if (sub === "remove") {
    const name = argv[1];
    if (!name) {
      process.stderr.write(`${pc.red("Error:")} server name required.\nUsage: mcp remove <name>\n`);
      process.exitCode = 1;
      return;
    }
    await mcpRemove(name, cwd);
    return;
  }

  if (sub === "get") {
    const name = argv[1];
    if (!name) {
      process.stderr.write(`${pc.red("Error:")} server name required.\nUsage: mcp get <name>\n`);
      process.exitCode = 1;
      return;
    }
    await mcpGet(name, cwd);
    return;
  }

  process.stderr.write(`${pc.red("Error:")} unknown mcp command "${sub}".\n`);
  printMcpHelp();
  process.exitCode = 1;
}

function printMcpHelp(): void {
  process.stdout.write(`${pc.bold("Cat's Claw MCP")} — Manage MCP servers\n\n`);
  process.stdout.write(`Commands:\n`);
  process.stdout.write(`  mcp list                              List configured servers\n`);
  process.stdout.write(`  mcp add [options] <name> [-- cmd...]   Add a server\n`);
  process.stdout.write(`  mcp add-json <name> '<json>'           Add server from JSON config\n`);
  process.stdout.write(`  mcp remove <name>                      Remove a server\n`);
  process.stdout.write(`  mcp get <name>                         Show server details\n\n`);
  process.stdout.write(`Add options:\n`);
  process.stdout.write(`  --transport <stdio|http|sse>   Transport type (default: stdio)\n`);
  process.stdout.write(`  --env KEY=VALUE                Set environment variable (repeatable)\n`);
  process.stdout.write(`  --header KEY:VALUE             Set HTTP header (repeatable)\n\n`);
  process.stdout.write(`Examples:\n`);
  process.stdout.write(`  ${pc.gray("# HTTP server")}\n`);
  process.stdout.write(`  mcp add --transport http notion https://mcp.notion.com/mcp\n\n`);
  process.stdout.write(`  ${pc.gray("# SSE server")}\n`);
  process.stdout.write(`  mcp add --transport sse atlassian https://mcp.atlassian.com/v1/sse\n\n`);
  process.stdout.write(`  ${pc.gray("# HTTP with auth header")}\n`);
  process.stdout.write(`  mcp add --transport http github https://api.github.com/mcp \\\n`);
  process.stdout.write(`    --header "Authorization:Bearer your-token"\n\n`);
  process.stdout.write(`  ${pc.gray("# Stdio server")}\n`);
  process.stdout.write(`  mcp add --transport stdio --env API_KEY=abc myserver -- npx -y @some/package\n\n`);
  process.stdout.write(`  ${pc.gray("# JSON config")}\n`);
  process.stdout.write(`  mcp add-json weather '{"type":"http","url":"https://api.weather.com/mcp"}'\n`);
}

async function mcpList(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  const servers = config.mcpServers ?? {};
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    process.stdout.write("No MCP servers configured.\n");
    process.stdout.write(`Config file: ${pc.gray(configPath(cwd))}\n`);
    return;
  }

  process.stdout.write(`${pc.bold("MCP Servers")} (${entries.length}):\n\n`);
  for (const [name, cfg] of entries) {
    const transport = cfg.type ?? (cfg.command ? "stdio" : "http");
    const target = cfg.url ?? (cfg.command ? `${cfg.command} ${(cfg.args ?? []).join(" ")}` : "");
    process.stdout.write(`  ${pc.cyan(name)}\n`);
    process.stdout.write(`    Transport: ${transport}\n`);
    process.stdout.write(`    Target:    ${target}\n`);
    if (cfg.env && Object.keys(cfg.env).length > 0) {
      process.stdout.write(`    Env:       ${Object.keys(cfg.env).join(", ")}\n`);
    }
    if (cfg.headers && Object.keys(cfg.headers).length > 0) {
      process.stdout.write(`    Headers:   ${Object.keys(cfg.headers).join(", ")}\n`);
    }
    process.stdout.write("\n");
  }
  process.stdout.write(`Config: ${pc.gray(configPath(cwd))}\n`);
}

async function mcpAdd(argv: string[], cwd: string): Promise<void> {
  let transport = "stdio";
  const envVars: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let name = "";
  let url = "";
  const cmdArgs: string[] = [];
  let pastDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (pastDoubleDash) {
      cmdArgs.push(arg);
      continue;
    }

    if (arg === "--") { pastDoubleDash = true; continue; }
    if (arg === "--transport") { transport = argv[++i] ?? "stdio"; continue; }
    if (arg === "--env") {
      const val = argv[++i] ?? "";
      const eq = val.indexOf("=");
      if (eq > 0) envVars[val.slice(0, eq)] = val.slice(eq + 1);
      continue;
    }
    if (arg === "--header") {
      const val = argv[++i] ?? "";
      const colon = val.indexOf(":");
      if (colon > 0) headers[val.slice(0, colon).trim()] = val.slice(colon + 1).trim();
      continue;
    }
    if (arg.startsWith("--")) continue;

    // Positional: first is name, second is URL (for http/sse)
    if (!name) { name = arg; continue; }
    if (!url) { url = arg; continue; }
  }

  if (!name) {
    process.stderr.write(`${pc.red("Error:")} server name required.\n`);
    process.exitCode = 1;
    return;
  }

  const config = await readConfig(cwd);
  if (!config.mcpServers) config.mcpServers = {};

  if (transport === "http" || transport === "sse") {
    if (!url) {
      process.stderr.write(`${pc.red("Error:")} URL required for ${transport} transport.\n`);
      process.exitCode = 1;
      return;
    }
    const entry: McpServerConfig = { type: transport as "http" | "sse", url };
    if (Object.keys(headers).length > 0) entry.headers = headers;
    if (Object.keys(envVars).length > 0) entry.env = envVars;
    config.mcpServers[name] = entry;
  } else {
    // stdio
    const command = cmdArgs[0];
    if (!command) {
      process.stderr.write(`${pc.red("Error:")} command required after -- for stdio transport.\n`);
      process.stderr.write(`Example: mcp add myserver -- npx -y @some/package\n`);
      process.exitCode = 1;
      return;
    }
    const entry: McpServerConfig = {
      type: "stdio",
      command,
      args: cmdArgs.slice(1),
    };
    if (Object.keys(envVars).length > 0) entry.env = envVars;
    config.mcpServers[name] = entry;
  }

  await writeConfig(cwd, config);
  process.stdout.write(`${pc.green("+")} Added "${name}" (${transport})\n`);
  process.stdout.write(`  Config: ${configPath(cwd)}\n`);
  process.stdout.write(`  Restart Cat's Claw to connect.\n`);
}

async function mcpAddJson(argv: string[], cwd: string): Promise<void> {
  const name = argv[0];
  const json = argv[1];

  if (!name || !json) {
    process.stderr.write(`${pc.red("Error:")} name and JSON config required.\n`);
    process.stderr.write(`Usage: mcp add-json <name> '<json>'\n`);
    process.exitCode = 1;
    return;
  }

  let parsed: McpServerConfig;
  try {
    parsed = JSON.parse(json) as McpServerConfig;
  } catch {
    process.stderr.write(`${pc.red("Error:")} invalid JSON.\n`);
    process.exitCode = 1;
    return;
  }

  const config = await readConfig(cwd);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[name] = parsed;
  await writeConfig(cwd, config);

  process.stdout.write(`${pc.green("+")} Added "${name}" from JSON\n`);
  process.stdout.write(`  Config: ${configPath(cwd)}\n`);
}

async function mcpRemove(name: string, cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config.mcpServers?.[name]) {
    process.stderr.write(`${pc.red("Error:")} server "${name}" not found.\n`);
    process.exitCode = 1;
    return;
  }
  delete config.mcpServers[name];
  await writeConfig(cwd, config);
  process.stdout.write(`${pc.green("-")} Removed "${name}"\n`);
}

async function mcpGet(name: string, cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  const server = config.mcpServers?.[name];
  if (!server) {
    process.stderr.write(`${pc.red("Error:")} server "${name}" not found.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${pc.bold(name)}:\n`);
  process.stdout.write(JSON.stringify(server, null, 2) + "\n");
}
