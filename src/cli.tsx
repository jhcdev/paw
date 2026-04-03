import { exec } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import tty from "node:tty";
import { promisify } from "node:util";
import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import type { CodingAgent } from "./agent.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./types.js";

const execAsync = promisify(exec);

type StartReplOptions = {
  provider: ProviderName;
  model: string;
  cwd: string;
};

type ChatEntry = {
  role: "system" | "user" | "assistant";
  text: string;
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

const CAT_MOODS = [
  "purring softly...",
  "sharpening claws...",
  "chasing a bug...",
  "knocking things off the table...",
  "napping on the keyboard...",
  "hunting for solutions...",
  "grooming the code...",
  "pouncing on the problem...",
];

function randomCatMood(): string {
  return CAT_MOODS[Math.floor(Math.random() * CAT_MOODS.length)]!;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show all commands" },
  { name: "/tools", desc: "available tools" },
  { name: "/mcp", desc: "MCP server status" },
  { name: "/model", desc: "current model info" },
  { name: "/cost", desc: "token usage" },
  { name: "/git", desc: "git status" },
  { name: "/diff", desc: "git diff" },
  { name: "/log", desc: "recent commits" },
  { name: "/history", desc: "export conversation" },
  { name: "/compact", desc: "compress conversation" },
  { name: "/init", desc: "generate project context" },
  { name: "/doctor", desc: "diagnostics check" },
  { name: "/version", desc: "show version" },
  { name: "/clear", desc: "reset chat" },
  { name: "/exit", desc: "quit" },
];

function App({ agent, options }: { agent: CodingAgent; options: StartReplOptions }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([
    { role: "system", text: "Meow~ Ready to code! Try /help, /tools, /clear, or /exit." },
  ]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [thinkMsg, setThinkMsg] = useState("purring softly...");
  const [turnCount, setTurnCount] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mcpMode, setMcpMode] = useState<"off" | "list" | "add-name" | "add-cmd" | "add-args" | "remove">("off");
  const [mcpServers, setMcpServers] = useState<{ name: string; connected: boolean; toolCount: number; command?: string }[]>([]);
  const [mcpCursor, setMcpCursor] = useState(0);
  const [mcpAddName, setMcpAddName] = useState("");
  const [mcpAddCmd, setMcpAddCmd] = useState("");

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ") || isBusy) return [];
    const q = input.toLowerCase();
    return COMMANDS.filter((c) => c.name.startsWith(q));
  }, [input, isBusy]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") exit();

    // Ctrl+L = clear
    if (key.ctrl && ch === "l" && !isBusy && mcpMode === "off") {
      agent.clear();
      setTurnCount(0);
      setEntries([{ role: "system", text: "Conversation cleared." }]);
      return;
    }

    // Ctrl+K = compact
    if (key.ctrl && ch === "k" && !isBusy && mcpMode === "off") {
      agent.clear();
      const summary = entries
        .filter((e) => e.role === "assistant")
        .slice(-3)
        .map((e) => e.text.slice(0, 200))
        .join("\n---\n");
      setEntries([
        { role: "system", text: "Conversation compacted. Recent context preserved." },
        ...(summary ? [{ role: "system" as const, text: `Summary of recent:\n${summary}` }] : []),
      ]);
      return;
    }

    // MCP mode keys
    if (mcpMode === "list") {
      if (key.escape || ch === "b" || ch === "q") { setMcpMode("off"); return; }
      if (ch === "a") { setMcpMode("add-name"); setMcpAddName(""); setInput(""); return; }
      if (ch === "r" && mcpServers.length > 0) { setMcpMode("remove"); setMcpCursor(0); return; }
      return;
    }
    if (mcpMode === "remove") {
      if (key.escape) { setMcpMode("list"); return; }
      if (key.downArrow) { setMcpCursor((i) => Math.min(i + 1, mcpServers.length - 1)); return; }
      if (key.upArrow) { setMcpCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const srv = mcpServers[mcpCursor];
        if (srv) {
          agent.removeMcpServer(srv.name).then(() => {
            agent.getMcpFullStatus().then((list) => {
              setMcpServers(list.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount, command: s.config.command })));
              setMcpCursor(0);
              setMcpMode("list");
            });
          });
        }
        return;
      }
      return;
    }

    if (key.escape && !isBusy) exit();

    if (suggestions.length > 0 && mcpMode === "off") {
      if (key.downArrow) {
        setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.tab) {
        const selected = suggestions[selectedIdx];
        if (selected) setInput(selected.name);
        setSelectedIdx(0);
        return;
      }
    }
  });

  const sidebarLines = useMemo(
    () => [
      "  ~( Tips )~",
      "",
      "  Type naturally to chat.",
      "  /help   - all commands",
      "",
      "  Esc to quit anytime.",
    ],
    [],
  );

  const submit = useCallback(
    async (value: string) => {
      const line = value.trim();
      if (!line || isBusy) return;
      setInput("");

      // ── MCP add flow ──
      if (mcpMode === "add-name") {
        if (!line) { setMcpMode("list"); return; }
        setMcpAddName(line);
        setMcpMode("add-cmd");
        setInput("");
        return;
      }
      if (mcpMode === "add-cmd") {
        if (!line) { setMcpMode("list"); return; }
        setMcpAddCmd(line);
        setMcpMode("add-args");
        setInput("");
        return;
      }
      if (mcpMode === "add-args") {
        const args = line ? line.split(/\s+/) : [];
        try {
          await agent.addMcpServer(mcpAddName, { command: mcpAddCmd, args });
        } catch {}
        const list = await agent.getMcpFullStatus();
        setMcpServers(list.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount, command: s.config.command })));
        setMcpMode("list");
        setInput("");
        return;
      }

      // ── exit ──
      if (line === "/exit" || line === "/quit") { exit(); return; }

      // ── clear ──
      if (line === "/clear") {
        agent.clear();
        setTurnCount(0);
        setEntries([{ role: "system", text: "Conversation cleared." }]);
        return;
      }

      // ── help ──
      if (line === "/help") {
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: [
            "Commands:",
            "  /help      - this menu",
            "  /tools     - available tools",
            "  /mcp       - MCP server status",
            "  /model     - current model info",
            "  /cost      - token usage",
            "  /git       - git status",
            "  /diff      - git diff",
            "  /log       - recent git commits",
            "  /history   - export conversation",
            "  /compact   - compress conversation",
            "  /init      - generate project context",
            "  /doctor    - diagnostics check",
            "  /version   - show version",
            "  /clear     - reset chat",
            "  /exit      - quit",
          ].join("\n") },
        ]);
        return;
      }

      // ── mcp ──
      if (line === "/mcp") {
        const list = await agent.getMcpFullStatus();
        setMcpServers(list.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount, command: s.config.command })));
        setMcpCursor(0);
        setMcpMode("list");
        return;
      }

      // ── tools ──
      if (line === "/tools") {
        const builtIn = toolDefinitions.map((t) => `  ${t.name} - ${t.description}`).join("\n");
        const mcpTools = agent.getMcpTools();
        const mcpSection = mcpTools.length > 0
          ? "\n\nMCP Tools:\n" + mcpTools.map((t) => `  ${t.name} - ${t.description}`).join("\n")
          : "";
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: `Built-in Tools:\n${builtIn}${mcpSection}` },
        ]);
        return;
      }

      // ── model ──
      if (line === "/model") {
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: `Provider: ${PROVIDER_LABELS[options.provider] ?? options.provider}\nModel:    ${options.model}\nCWD:      ${options.cwd}` },
        ]);
        return;
      }

      // ── cost ──
      if (line === "/cost") {
        const usage = agent.getUsage();
        if (options.provider === "ollama") {
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `Turns: ${turnCount}\nLocal model — token tracking not applicable.` },
          ]);
        } else {
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `Turns: ${turnCount}\nInput:  ${formatTokens(usage.inputTokens)} tokens\nOutput: ${formatTokens(usage.outputTokens)} tokens\nTotal:  ${formatTokens(usage.inputTokens + usage.outputTokens)} tokens` },
          ]);
        }
        return;
      }

      // ── git ──
      if (line === "/git") {
        try {
          const { stdout } = await execAsync("git status --short", { cwd: options.cwd });
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: stdout.trim() || "(working tree clean)" },
          ]);
        } catch {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Not a git repository." }]);
        }
        return;
      }

      // ── diff ──
      if (line === "/diff") {
        try {
          const { stdout } = await execAsync("git diff --stat", { cwd: options.cwd });
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: stdout.trim() || "(no changes)" },
          ]);
        } catch {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Not a git repository." }]);
        }
        return;
      }

      // ── log ──
      if (line === "/log") {
        try {
          const { stdout } = await execAsync("git log --oneline -10", { cwd: options.cwd });
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: stdout.trim() || "(no commits)" },
          ]);
        } catch {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Not a git repository." }]);
        }
        return;
      }

      // ── history ──
      if (line === "/history") {
        const exportPath = path.join(options.cwd, `chat-${Date.now()}.md`);
        const content = entries.map((e) => {
          if (e.role === "user") return `**You:** ${e.text}`;
          if (e.role === "assistant") return `**Assistant:** ${e.text}`;
          return `*${e.text}*`;
        }).join("\n\n");
        try {
          await fsPromises.writeFile(exportPath, content, "utf8");
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `Exported to ${path.basename(exportPath)}` },
          ]);
        } catch (err) {
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `Export failed: ${err instanceof Error ? err.message : String(err)}` },
          ]);
        }
        return;
      }

      // ── compact ──
      if (line === "/compact") {
        agent.clear();
        const summary = entries
          .filter((e) => e.role === "assistant")
          .slice(-3)
          .map((e) => e.text.slice(0, 200))
          .join("\n---\n");
        setEntries([
          { role: "system", text: "Conversation compacted. Recent context preserved." },
          ...(summary ? [{ role: "system" as const, text: `Summary of recent:\n${summary}` }] : []),
        ]);
        return;
      }

      // ── init ──
      if (line === "/init") {
        setEntries((c) => [...c, { role: "user", text: line }]);
        setIsBusy(true);
        setThinkMsg("scanning project...");
        try {
          const parts: string[] = ["# Project Context\n"];
          // Package info
          try {
            const pkg = await fsPromises.readFile(path.join(options.cwd, "package.json"), "utf8");
            const parsed = JSON.parse(pkg);
            parts.push(`## ${parsed.name ?? "Project"}\n${parsed.description ?? ""}\n`);
            if (parsed.scripts) parts.push(`### Scripts\n${Object.entries(parsed.scripts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`);
            if (parsed.dependencies) parts.push(`### Dependencies\n${Object.keys(parsed.dependencies).join(", ")}\n`);
          } catch {}
          // Git info
          try {
            const { stdout: branch } = await execAsync("git branch --show-current", { cwd: options.cwd });
            const { stdout: remote } = await execAsync("git remote get-url origin 2>/dev/null || echo 'none'", { cwd: options.cwd });
            parts.push(`## Git\n- Branch: ${branch.trim()}\n- Remote: ${remote.trim()}\n`);
          } catch {}
          // File tree (top level)
          try {
            const { stdout: tree } = await execAsync("find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -50", { cwd: options.cwd });
            parts.push(`## Structure\n\`\`\`\n${tree.trim()}\n\`\`\`\n`);
          } catch {}
          const content = parts.join("\n");
          await fsPromises.writeFile(path.join(options.cwd, "CONTEXT.md"), content, "utf8");
          setEntries((c) => [...c, { role: "system", text: "Generated CONTEXT.md with project overview." }]);
        } catch (err) {
          setEntries((c) => [...c, { role: "system", text: `Init failed: ${err instanceof Error ? err.message : String(err)}` }]);
        } finally {
          setIsBusy(false);
        }
        return;
      }

      // ── doctor ──
      if (line === "/doctor") {
        const checks: string[] = [];
        // Node version
        checks.push(`Node: ${process.version}`);
        checks.push(`Platform: ${process.platform} ${process.arch}`);
        checks.push(`CWD: ${options.cwd}`);
        checks.push(`Provider: ${PROVIDER_LABELS[options.provider] ?? options.provider}`);
        checks.push(`Model: ${options.model}`);
        // Git
        try {
          const { stdout } = await execAsync("git --version", { cwd: options.cwd });
          checks.push(`Git: ${stdout.trim()}`);
        } catch { checks.push("Git: not found"); }
        // ripgrep
        try {
          const { stdout } = await execAsync("rg --version | head -1", { cwd: options.cwd });
          checks.push(`Ripgrep: ${stdout.trim()}`);
        } catch { checks.push("Ripgrep: not found (using grep fallback)"); }
        // MCP
        const mcpStatus = agent.getMcpStatus();
        checks.push(`MCP servers: ${mcpStatus.length} connected`);
        // Token usage
        const usage = agent.getUsage();
        checks.push(`Tokens used: ${usage.inputTokens + usage.outputTokens}`);

        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: `Diagnostics:\n${checks.map(c => "  " + c).join("\n")}` },
        ]);
        return;
      }

      // ── version ──
      if (line === "/version") {
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: "Cat's Claw v1.0.0" },
        ]);
        return;
      }

      // ── unknown command ──
      if (line.startsWith("/")) {
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: `Unknown command: ${line}\nType /help for available commands.` },
        ]);
        return;
      }

      // ── normal message ──
      setEntries((c) => [...c, { role: "user", text: line }]);
      setIsBusy(true);
      setThinkMsg(randomCatMood());

      try {
        const result = await agent.runTurn(line);
        setTurnCount((c) => c + 1);
        setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty response)" }]);
      } catch (error) {
        setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
      } finally {
        setIsBusy(false);
      }
    },
    [agent, exit, isBusy, entries, turnCount, options],
  );

  const providerLabel = PROVIDER_LABELS[options.provider] ?? options.provider;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginTop={1} borderStyle="round" borderColor="#d97757" flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          <Text color="#ff9c73" bold>{"  /\\_/\\   Cat's Claw v1.0"}</Text>
          <Text color="#ff9c73">{" ( o.o )  Scratch your code into shape~"}</Text>
          <Text color="#ff9c73">{"  > ^ <   "}<Text color="gray" italic>meow~</Text></Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="#553322" paddingX={1}>
          <Box width="50%" flexDirection="column">
            <Text color="#ffb088">Provider: <Text bold color="white">{providerLabel}</Text></Text>
            <Text color="#ffb088">Model:    <Text bold color="white">{options.model}</Text></Text>
            <Text color="#ffb088">CWD:      <Text color="gray">{options.cwd}</Text></Text>
          </Box>
          <Box width="50%" flexDirection="column" borderLeft paddingLeft={2}>
            {sidebarLines.map((line, i) => (
              <Text key={i} color="#cc8866">{line}</Text>
            ))}
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {entries.slice(-12).map((entry, index) => (
          <Box key={`${entry.role}-${index}`} marginBottom={1} flexDirection="row">
            {entry.role === "user" ? (
              <Box>
                <Text color="#ffb088" bold>{"you "}</Text>
                <Text color="white">{entry.text}</Text>
              </Box>
            ) : entry.role === "assistant" ? (
              <Box flexDirection="column">
                <Text color="#ff9c73" bold>{"=^.^= "}<Text color="gray" italic>says:</Text></Text>
                <Box marginLeft={2}>
                  <Text color="#ffe0cc">{entry.text}</Text>
                </Box>
              </Box>
            ) : (
              <Box>
                <Text color="#997755">{"~ "}</Text>
                <Text color="#cc9966" italic>{entry.text}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {isBusy ? (
        <Box>
          <Text color="#ff9c73" bold>{"=^.^= "}</Text>
          <Text color="gray" italic>{thinkMsg}</Text>
          <Newline />
        </Box>
      ) : null}

      {mcpMode !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>MCP Server Manager</Text>

          {mcpMode === "list" ? (
            <Box flexDirection="column" marginTop={1}>
              {mcpServers.length === 0 ? (
                <Text color="gray" italic>No MCP servers configured.</Text>
              ) : (
                mcpServers.map((s, i) => (
                  <Box key={s.name}>
                    <Text color={s.connected ? "green" : "red"}>{s.connected ? " + " : " x "}</Text>
                    <Text color="#ffb088" bold>{s.name}</Text>
                    <Text color="gray"> — {s.command ?? "?"} — {s.toolCount} tool(s)</Text>
                  </Box>
                ))
              )}
              <Box marginTop={1} flexDirection="column">
                <Text color="#cc8866">[a] Add server  [r] Remove server  [b] Back</Text>
              </Box>
            </Box>
          ) : null}

          {mcpMode === "remove" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select server to remove (Enter to confirm, Esc to cancel):</Text>
              {mcpServers.map((s, i) => (
                <Box key={s.name}>
                  <Text color={i === mcpCursor ? "#ff9c73" : "gray"} bold={i === mcpCursor}>
                    {i === mcpCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === mcpCursor ? "#ff9c73" : "gray"}>{s.name}</Text>
                </Box>
              ))}
            </Box>
          ) : null}

          {mcpMode === "add-name" ? (
            <Box marginTop={1}><Text color="#cc8866">Server name (Enter to confirm, empty to cancel):</Text></Box>
          ) : null}
          {mcpMode === "add-cmd" ? (
            <Box marginTop={1} flexDirection="column">
              <Text color="gray">Adding: <Text bold color="#ffb088">{mcpAddName}</Text></Text>
              <Text color="#cc8866">Command (e.g. npx):</Text>
            </Box>
          ) : null}
          {mcpMode === "add-args" ? (
            <Box marginTop={1} flexDirection="column">
              <Text color="gray">Adding: <Text bold color="#ffb088">{mcpAddName}</Text> ({mcpAddCmd})</Text>
              <Text color="#cc8866">Args (space-separated, e.g. -y @modelcontextprotocol/server-github):</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {suggestions.length > 0 && mcpMode === "off" ? (
        <Box flexDirection="column" paddingX={2} marginBottom={0}>
          {suggestions.map((cmd, i) => (
            <Box key={cmd.name}>
              <Text color={i === selectedIdx ? "#ff9c73" : "gray"} bold={i === selectedIdx}>
                {i === selectedIdx ? " > " : "   "}
              </Text>
              <Text color={i === selectedIdx ? "#ff9c73" : "gray"} bold={i === selectedIdx}>
                {cmd.name}
              </Text>
              <Text color="gray"> — {cmd.desc}</Text>
            </Box>
          ))}
          <Text color="gray" italic>  Tab to complete | arrows to navigate</Text>
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor="#d97757" paddingX={1}>
        <Text color="#ff9c73" bold>{" > "}</Text>
        <TextInput value={input} onChange={(v) => { setInput(v); setSelectedIdx(0); }} onSubmit={submit} />
      </Box>
      <Text color="gray" italic> Esc to quit | /help for commands</Text>
      <Box marginTop={0} paddingX={1} justifyContent="space-between">
        <Text color="gray">{providerLabel}/{options.model}</Text>
        <Text color="gray">turns: {turnCount}</Text>
        <Text color={agent.getMcpStatus().length > 0 ? "green" : "gray"}>
          mcp: {agent.getMcpStatus().length > 0 ? `${agent.getMcpStatus().length} server(s)` : "off"}
        </Text>
        <Text color="gray">
          {options.provider !== "ollama" ? `tokens: ${formatTokens(agent.getUsage().inputTokens + agent.getUsage().outputTokens)}` : "local"}
        </Text>
      </Box>
    </Box>
  );
}

function openTtyStdin(): tty.ReadStream | undefined {
  try {
    const fd = fs.openSync("/dev/tty", "r");
    const stream = new tty.ReadStream(fd);
    return stream;
  } catch {
    return undefined;
  }
}

export async function startRepl(agent: CodingAgent, options: StartReplOptions): Promise<void> {
  const ttyStdin = openTtyStdin();
  const instance = render(<App agent={agent} options={options} />, {
    ...(ttyStdin ? { stdin: ttyStdin } : {}),
  });
  await instance.waitUntilExit();
  ttyStdin?.destroy();
}
