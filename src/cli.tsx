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

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ") || isBusy) return [];
    const q = input.toLowerCase();
    return COMMANDS.filter((c) => c.name.startsWith(q));
  }, [input, isBusy]);

  useInput((ch, key) => {
    if (key.escape && !isBusy) exit();
    if (key.ctrl && ch === "c") exit();

    if (suggestions.length > 0) {
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
            "  /clear     - reset chat",
            "  /exit      - quit",
          ].join("\n") },
        ]);
        return;
      }

      // ── mcp ──
      if (line === "/mcp") {
        const servers = agent.getMcpStatus();
        if (servers.length === 0) {
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: "No MCP servers connected.\n\nCreate .mcp.json in the project root:\n\n  {\n    \"mcpServers\": {\n      \"name\": {\n        \"command\": \"npx\",\n        \"args\": [\"-y\", \"@modelcontextprotocol/server-xxx\"]\n      }\n    }\n  }\n\nThen restart." },
          ]);
        } else {
          const mcpTools = agent.getMcpTools();
          const serverList = servers.map((s) => `  ${s.name} — ${s.toolCount} tool(s)`).join("\n");
          const toolList = mcpTools.length > 0
            ? "\n\nMCP Tools:\n" + mcpTools.map((t) => `  ${t.name} - ${t.description}`).join("\n")
            : "";
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `MCP Servers (${servers.length}):\n${serverList}${toolList}` },
          ]);
        }
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

      {suggestions.length > 0 ? (
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
