import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// HTTP/SSE transports are dynamically imported in connectServer
type StreamableHTTPClientTransport = import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;
type SSEClientTransport = import("@modelcontextprotocol/sdk/client/sse.js").SSEClientTransport;
import pc from "picocolors";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types.js";

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

type ConnectedServer = {
  name: string;
  client: Client;
  transport: unknown;
  tools: ToolDefinition[];
};

const CONFIG_PATHS = [
  ".mcp.json",
  ".cats-claw/mcp.json",
];

export type McpServerEntry = {
  name: string;
  config: McpServerConfig;
  connected: boolean;
  toolCount: number;
};

export class McpManager {
  private servers: ConnectedServer[] = [];
  private cwd: string = "";

  async loadAndConnect(cwd: string): Promise<void> {
    this.cwd = cwd;
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
    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;

    if (config.type === "http" || (config.url && config.type !== "sse" && config.type !== "stdio")) {
      if (!config.url) throw new Error(`${name}: missing "url" for http transport`);
      const { StreamableHTTPClientTransport: HttpTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const headers: Record<string, string> = { ...(config.headers ?? {}) };
      transport = new HttpTransport(new URL(config.url), { requestInit: { headers } }) as unknown as StreamableHTTPClientTransport;
    } else if (config.type === "sse") {
      if (!config.url) throw new Error(`${name}: missing "url" for sse transport`);
      const { SSEClientTransport: SseTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      transport = new SseTransport(new URL(config.url)) as unknown as SSEClientTransport;
    } else {
      if (!config.command) throw new Error(`${name}: missing "command" for stdio transport`);
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: {
          ...process.env as Record<string, string>,
          ...(config.env ?? {}),
        },
        cwd,
      });
    }

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

  async getFullStatus(): Promise<McpServerEntry[]> {
    const config = await this.findConfig(this.cwd);
    const configServers = config?.mcpServers ?? {};
    const entries: McpServerEntry[] = [];

    for (const [name, cfg] of Object.entries(configServers)) {
      const connected = this.servers.some((s) => s.name === name);
      const server = this.servers.find((s) => s.name === name);
      entries.push({
        name,
        config: cfg,
        connected,
        toolCount: server?.tools.length ?? 0,
      });
    }
    return entries;
  }

  private getConfigFilePath(): string {
    return path.join(this.cwd, ".mcp.json");
  }

  async readConfigFile(): Promise<McpConfigFile> {
    const filePath = this.getConfigFilePath();
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as McpConfigFile;
    } catch {
      return { mcpServers: {} };
    }
  }

  async writeConfigFile(config: McpConfigFile): Promise<void> {
    const filePath = this.getConfigFilePath();
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
  }

  async addServer(name: string, config: McpServerConfig): Promise<{ ok: boolean; error?: string }> {
    const file = await this.readConfigFile();
    if (!file.mcpServers) file.mcpServers = {};
    file.mcpServers[name] = config;
    await this.writeConfigFile(file);
    // Try to connect immediately
    try {
      await this.connectServer(name, config, this.cwd);
      return { ok: true };
    } catch (err) {
      // Connection failed — remove from config so broken entries don't persist
      delete file.mcpServers[name];
      await this.writeConfigFile(file);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async removeServer(name: string): Promise<void> {
    // Disconnect if connected
    const idx = this.servers.findIndex((s) => s.name === name);
    if (idx >= 0) {
      try { await this.servers[idx]!.client.close(); } catch {}
      this.servers.splice(idx, 1);
    }
    // Remove from config
    const file = await this.readConfigFile();
    if (file.mcpServers) {
      delete file.mcpServers[name];
      await this.writeConfigFile(file);
    }
  }
}
