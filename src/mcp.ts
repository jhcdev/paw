import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// SSE transport import is conditional below
import pc from "picocolors";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types.js";

type McpServerConfig = {
  type?: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
};

type McpConfigFile = {
  mcpServers?: Record<string, McpServerConfig>;
};

type ConnectedServer = {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDefinition[];
};

const CONFIG_PATHS = [
  ".mcp.json",
  ".cats-claw/mcp.json",
];

export class McpManager {
  private servers: ConnectedServer[] = [];

  async loadAndConnect(cwd: string): Promise<void> {
    const config = await this.findConfig(cwd);
    if (!config?.mcpServers) return;

    const entries = Object.entries(config.mcpServers);
    if (entries.length === 0) return;

    process.stdout.write(`${pc.gray("Connecting to MCP servers...")}\n`);

    const results = await Promise.allSettled(
      entries.map(([name, cfg]) => this.connectServer(name, cfg, cwd)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        process.stderr.write(`${pc.yellow("MCP warning:")} ${result.reason}\n`);
      }
    }

    const totalTools = this.servers.reduce((sum, s) => sum + s.tools.length, 0);
    if (this.servers.length > 0) {
      process.stdout.write(
        `${pc.green("+")} ${this.servers.length} MCP server(s) connected, ${totalTools} tool(s) available\n`,
      );
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.servers.flatMap((s) =>
      s.tools.map((t) => ({
        ...t,
        name: `mcp_${s.name}_${t.name}`,
        description: `[${s.name}] ${t.description}`,
      })),
    );
  }

  getToolHandlers(): Record<string, ToolHandler> {
    const handlers: Record<string, ToolHandler> = {};

    for (const server of this.servers) {
      for (const tool of server.tools) {
        const fullName = `mcp_${server.name}_${tool.name}`;
        handlers[fullName] = async (input: Record<string, unknown>): Promise<ToolResult> => {
          const result = await server.client.callTool({
            name: tool.name,
            arguments: input,
          });

          const content = Array.isArray(result.content)
            ? result.content
                .map((c: { type?: string; text?: string }) =>
                  c.type === "text" ? c.text ?? "" : JSON.stringify(c),
                )
                .join("\n")
            : typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content);

          return {
            content,
            isError: result.isError === true,
          };
        };
      }
    }

    return handlers;
  }

  getStatus(): { name: string; toolCount: number }[] {
    return this.servers.map((s) => ({ name: s.name, toolCount: s.tools.length }));
  }

  getConfigPaths(): string[] {
    return [...CONFIG_PATHS];
  }

  async disconnect(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.client.close();
      } catch {
        // ignore cleanup errors
      }
    }
    this.servers = [];
  }

  private async findConfig(cwd: string): Promise<McpConfigFile | null> {
    // Check project-level configs
    for (const rel of CONFIG_PATHS) {
      const full = path.join(cwd, rel);
      try {
        const raw = await fs.readFile(full, "utf8");
        return JSON.parse(raw) as McpConfigFile;
      } catch {
        continue;
      }
    }

    // Check home directory
    const homeConfig = path.join(os.homedir(), ".cats-claw", "mcp.json");
    try {
      const raw = await fs.readFile(homeConfig, "utf8");
      return JSON.parse(raw) as McpConfigFile;
    } catch {
      return null;
    }
  }

  private async connectServer(name: string, config: McpServerConfig, cwd: string): Promise<void> {
    if (config.type === "sse" || config.url) {
      // SSE servers are not yet supported in this implementation
      process.stdout.write(`${pc.yellow("  skip")} ${name} (SSE not yet supported)\n`);
      return;
    }

    if (!config.command) {
      throw new Error(`${name}: missing "command" in config`);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: {
        ...process.env as Record<string, string>,
        ...(config.env ?? {}),
      },
      cwd,
    });

    const client = new Client({
      name: "cats-claw",
      version: "1.0.0",
    });

    try {
      await client.connect(transport);
    } catch (err) {
      throw new Error(`${name}: failed to connect — ${err instanceof Error ? err.message : String(err)}`);
    }

    let tools: ToolDefinition[] = [];
    try {
      const result = await client.listTools();
      tools = (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: (t.inputSchema as ToolDefinition["input_schema"]) ?? {
          type: "object" as const,
          properties: {},
        },
      }));
    } catch {
      // Server connected but has no tools
    }

    process.stdout.write(`${pc.green("  +")} ${pc.cyan(name)} — ${tools.length} tool(s)\n`);

    this.servers.push({ name, client, transport, tools });
  }
}
