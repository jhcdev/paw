import fs from "node:fs";
import tty from "node:tty";
import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

import type { CodingAgent } from "./agent.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./types.js";

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

function App({ agent, options }: { agent: CodingAgent; options: StartReplOptions }) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([
    { role: "system", text: "Meow~ Ready to code! Try /help, /tools, /clear, or /exit." },
  ]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [thinkMsg, setThinkMsg] = useState("purring softly...");

  useInput((ch, key) => {
    if (key.escape && !isBusy) exit();
    if (key.ctrl && ch === "c") exit();
  });

  const sidebarLines = useMemo(
    () => [
      "  ~( Tips )~",
      "",
      "  Type naturally to chat.",
      "  /tools  - see my claws",
      "  /clear  - fresh start",
      "  /exit   - bye bye~",
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

      if (line === "/exit") { exit(); return; }

      if (line === "/clear") {
        agent.clear();
        setEntries([{ role: "system", text: "Purrr~ Conversation cleared! Fresh start, nya~" }]);
        return;
      }

      if (line === "/help") {
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: "  /help   - this menu\n  /tools  - available claws\n  /clear  - reset chat\n  /exit   - goodbye~" },
        ]);
        return;
      }

      if (line === "/tools") {
        const toolList = toolDefinitions.map((t) => `  ${t.name} - ${t.description}`).join("\n");
        setEntries((c) => [...c,
          { role: "user", text: line },
          { role: "system", text: `My claws:\n${toolList}` },
        ]);
        return;
      }

      setEntries((c) => [...c, { role: "user", text: line }]);
      setIsBusy(true);
      setThinkMsg(randomCatMood());

      try {
        const result = await agent.runTurn(line);
        setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty response)" }]);
      } catch (error) {
        setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
      } finally {
        setIsBusy(false);
      }
    },
    [agent, exit, isBusy],
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

      <Box borderStyle="round" borderColor="#d97757" paddingX={1}>
        <Text color="#ff9c73" bold>{" > "}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
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
