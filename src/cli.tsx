import { exec } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import tty from "node:tty";
import { promisify } from "node:util";
import React, { useCallback, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";

import type { CodingAgent } from "./agent.js";
import { appendToSession, saveSession, listSessions, watchSession, type SessionData, type SessionEntry } from "./session.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName } from "./types.js";
import { formatModelList, getAllFilteredModels, resolveModelByIndex, detectPlan } from "./model-catalog.js";

const execAsync = promisify(exec);

type StartReplOptions = {
  provider: ProviderName;
  model: string;
  cwd: string;
  sessionId: string;
  existingSession?: SessionData | null;
};

type ChatEntry = {
  role: "system" | "user" | "assistant";
  text: string;
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  codex: "Codex",
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

const ALL_PROVIDERS: { name: ProviderName; label: string; hasLogin: boolean }[] = [
  { name: "codex", label: "Codex (CLI)", hasLogin: false },
  { name: "ollama", label: "Ollama (local)", hasLogin: false },
];

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/help", desc: "show all commands" },
  { name: "/status", desc: "providers, usage, cost overview" },
  { name: "/settings", desc: "manage provider API keys" },
  { name: "/model", desc: "list/switch models & providers" },
  { name: "/team", desc: "team dashboard & collaboration" },
  { name: "/ask", desc: "query another provider" },
  { name: "/tools", desc: "available tools" },
  { name: "/mcp", desc: "MCP server manager" },
  { name: "/git", desc: "git status, diff, log" },
  { name: "/history", desc: "export conversation" },
  { name: "/compact", desc: "compress conversation" },
  { name: "/init", desc: "generate project context" },
  { name: "/doctor", desc: "diagnostics" },
  { name: "/sessions", desc: "list past sessions" },
  { name: "/session", desc: "current session ID" },
  { name: "/skills", desc: "list available skills" },
  { name: "/hooks", desc: "list configured hooks" },
  { name: "/clear", desc: "reset chat" },
  { name: "/exit", desc: "quit" },
];

function App({ agent, options }: { agent: CodingAgent; options: StartReplOptions }) {
  const { exit } = useApp();
  const [sessionId] = useState(options.sessionId);
  const [entries, setEntries] = useState<ChatEntry[]>(() => {
    if (options.existingSession?.entries.length) {
      return options.existingSession.entries.map((e) => ({ role: e.role, text: e.text }));
    }
    return [{ role: "system", text: "Meow~ Ready to code! Try /help, /tools, /clear, or /exit." }];
  });
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
  const [mode, setMode] = useState<"solo" | "team">("solo");
  const [teamPanel, setTeamPanel] = useState<"off" | "list" | "pick-role" | "pick-provider" | "pick-model" | "pick-effort">("off");
  const [teamEditRole, setTeamEditRole] = useState<string>("");
  const [teamEditProvider, setTeamEditProvider] = useState<string>("");
  const [teamModels, setTeamModels] = useState<{ id: string; name: string }[]>([]);
  const [settingsPanel, setSettingsPanel] = useState<"off" | "list" | "auth-method" | "add-key">("off");
  const [settingsProvider, setSettingsProvider] = useState<string>("");
  const [settingsCursor, setSettingsCursor] = useState(0);
  const [modelPanel, setModelPanel] = useState<"off" | "providers" | "models" | "effort">("off");
  const [modelPanelProvider, setModelPanelProvider] = useState<string>("");
  const [modelPanelModels, setModelPanelModels] = useState<{ id: string; name: string }[]>([]);
  const [modelCursor, setModelCursor] = useState(0);
  const [providerVersion, setProviderVersion] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  const [activityView, setActivityView] = useState<string | null>(null); // viewing activity ID
  const [activityCursor, setActivityCursor] = useState(0);
  const [activityScroll, setActivityScroll] = useState(0);

  // All input handled in useInput below (no separate useStdin)

  // Watch session file for changes from other terminals
  React.useEffect(() => {
    const unwatch = watchSession(sessionId, (data) => {
      setEntries(data.entries.map((e) => ({ role: e.role, text: e.text })));
    });
    return unwatch;
  }, [sessionId]);

  // Listen for activity log changes
  React.useEffect(() => {
    agent.activityLog.setOnChange(() => setActivityVersion((v) => v + 1));
  }, [agent]);

  // Save session on every entries change
  React.useEffect(() => {
    if (entries.length <= 1) return;
    const data: SessionData = {
      id: sessionId,
      provider: agent.getActiveProvider(),
      model: agent.getActiveModel(),
      mode,
      cwd: options.cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entries: entries.map((e) => ({ role: e.role, text: e.text, timestamp: new Date().toISOString() })),
    };
    saveSession(data).catch(() => {});
  }, [entries, sessionId]);

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ") || isBusy) return [];
    const q = input.toLowerCase();
    return COMMANDS.filter((c) => c.name.startsWith(q));
  }, [input, isBusy]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") exit();

    // ↓ = enter activity selector (below input, when no other panel active)
    if (key.downArrow && suggestions.length === 0 && !isBusy && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off" && !activityView) {
      const acts = agent.activityLog.getRecent(5);
      if (acts.length > 0) { setActivityCursor(0); setActivityView("__select__"); return; }
    }

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

    // Activity viewer
    if (activityView) {
      const act = agent.activityLog.getById(activityView);
      if (key.escape) { setActivityView(null); setActivityScroll(0); return; }
      if (act) {
        const maxScroll = Math.max(0, act.logs.length - 5);
        if (key.downArrow) { setActivityScroll((s) => Math.min(s + 1, maxScroll)); return; }
        if (key.upArrow) { setActivityScroll((s) => Math.max(s - 1, 0)); return; }
      }
      return;
    }


    // Activity selector mode
    if (activityView === "__select__") {
      const acts = agent.activityLog.getRecent(5);
      if (key.escape) { setActivityView(null); return; }
      if (key.downArrow) { setActivityCursor((i) => Math.min(i + 1, acts.length - 1)); return; }
      if (key.upArrow) { setActivityCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const selected = acts[activityCursor];
        if (selected) { setActivityView(selected.id); setActivityScroll(0); }
        return;
      }
      return;
    }

    // Model panel
    if (modelPanel === "providers") {
      if (key.escape) { setModelPanel("off"); return; }
      const registered = agent.getMulti().getRegistered();
      if (key.downArrow) { setModelCursor((i) => Math.min(i + 1, registered.length - 1)); return; }
      if (key.upArrow) { setModelCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const selected = registered[modelCursor];
        if (selected) {
          setModelPanelProvider(selected.name);
          // Load filtered models async via promise
          getAllFilteredModels(agent.getProviderKeys()).then((all) => {
            const provModels = all.find((g) => g.provider === selected.name);
            setModelPanelModels(provModels?.models.map((m) => ({ id: m.id, name: m.name })) ?? []);
            setModelPanel("models");
            setModelCursor(0);
          });
        }
        return;
      }
      return;
    }
    if (modelPanel === "models") {
      if (key.escape) { setModelPanel("providers"); setModelCursor(0); return; }
      if (key.downArrow) { setModelCursor((i) => Math.min(i + 1, modelPanelModels.length - 1)); return; }
      if (key.upArrow) { setModelCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const selected = modelPanelModels[modelCursor];
        if (selected) {
          const result = agent.switchProvider(modelPanelProvider as any, selected.id);
          if (result.ok) {
            setProviderVersion((v) => v + 1);
            if (modelPanelProvider === "codex") {
              // Show effort picker for CLI-based providers
              setModelPanel("effort");
              setModelCursor(1); // default = medium (index 1)
              return;
            }
            setEntries((c) => [...c, { role: "system", text: `Switched to ${modelPanelProvider}/${selected.id}` }]);
          } else {
            setEntries((c) => [...c, { role: "system", text: result.error ?? "Failed to switch." }]);
          }
        }
        setModelPanel("off");
        return;
      }
      return;
    }
    if (modelPanel === "effort") {
      const efforts = ["low", "medium", "high", "extra_high"] as const;
      if (key.escape) { setModelPanel("models"); setModelCursor(0); return; }
      if (key.downArrow) { setModelCursor((i) => Math.min(i + 1, efforts.length - 1)); return; }
      if (key.upArrow) { setModelCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const selected = efforts[modelCursor]!;
        agent.setEffort(selected);
        setEntries((c) => [...c, { role: "system", text: `${agent.getActiveProvider()}/${agent.getActiveModel()} (effort: ${selected})` }]);
        setModelPanel("off");
        return;
      }
      return;
    }

    // Settings panel
    if (settingsPanel !== "off" && settingsPanel !== "add-key") {
      if (key.escape) {
        if (settingsPanel === "list") { setSettingsPanel("off"); }
        else { setSettingsPanel("list"); setSettingsCursor(0); }
        return;
      }
      if (settingsPanel === "list") {
        if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, ALL_PROVIDERS.length - 1)); return; }
        if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = ALL_PROVIDERS[settingsCursor]!;
          setSettingsProvider(selected.name);
          if (selected.hasLogin) { setSettingsPanel("auth-method"); setSettingsCursor(0); }
          else if (selected.name === "ollama") { setSettingsPanel("off"); }
          else { setSettingsPanel("add-key"); setInput(""); }
          return;
        }
      }
      if (settingsPanel === "auth-method") {
        if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, 1)); return; }
        if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          if (settingsCursor === 1) { setSettingsPanel("add-key"); setInput(""); }
          else {
            // Login (cursor === 0)
            setSettingsPanel("off");
            setSettingsProvider("");
          }
          return;
        }
      }
      return;
    }
    if (settingsPanel === "add-key") {
      if (key.escape) { setSettingsPanel("list"); setInput(""); setSettingsCursor(0); return; }
      return;
    }

    // Team panel
    if (teamPanel === "list") {
      if (key.escape) { setTeamPanel("off"); return; }
      const teamMenuItems = 2;
      if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, teamMenuItems - 1)); return; }
      if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        if (settingsCursor === 0) { setTeamPanel("pick-role"); setSettingsCursor(0); }
        else { setMode((m) => m === "solo" ? "team" : "solo"); setTeamPanel("off"); }
        return;
      }
      return;
    }
    if (teamPanel === "pick-role") {
      if (key.escape) { setTeamPanel("list"); setSettingsCursor(0); return; }
      const roles = agent.getTeam().getRoles();
      if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, roles.length - 1)); return; }
      if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const role = roles[settingsCursor];
        if (role) { setTeamEditRole(role.role); setTeamPanel("pick-provider"); setSettingsCursor(0); }
        return;
      }
      return;
    }
    if (teamPanel === "pick-provider") {
      if (key.escape) { setTeamPanel("pick-role"); setSettingsCursor(0); return; }
      const providers = agent.getMulti().getRegistered();
      if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, providers.length - 1)); return; }
      if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const prov = providers[settingsCursor];
        if (prov) {
          setTeamEditProvider(prov.name);
          // Load models for this provider
          getAllFilteredModels(agent.getProviderKeys()).then((all) => {
            const provModels = all.find((g) => g.provider === prov.name);
            setTeamModels(provModels?.models.map((m) => ({ id: m.id, name: m.name })) ?? []);
            setTeamPanel("pick-model");
            setSettingsCursor(0);
          });
        }
        return;
      }
      return;
    }
    if (teamPanel === "pick-model") {
      if (key.escape) { setTeamPanel("pick-provider"); setSettingsCursor(0); return; }
      if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, teamModels.length - 1)); return; }
      if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const model = teamModels[settingsCursor];
        if (model) {
          const cfg = agent.getMulti().getProviderConfig(teamEditProvider as any);
          if (cfg) {
            agent.getTeam().assignRole(teamEditRole as any, { provider: teamEditProvider as any, model: model.id, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
            if (teamEditProvider === "codex") {
              setTeamPanel("pick-effort");
              setSettingsCursor(1); // default medium
              return;
            }
            setEntries((c) => [...c, { role: "system", text: `${teamEditRole} → ${teamEditProvider}/${model.id}` }]);
          }
        }
        setTeamPanel("pick-role"); // Go back to role selection
        setSettingsCursor(0);
        return;
      }
      return;
    }
    if (teamPanel === "pick-effort") {
      const efforts = ["low", "medium", "high", "extra_high"] as const;
      if (key.escape) { setTeamPanel("pick-model"); setSettingsCursor(0); return; }
      if (key.downArrow) { setSettingsCursor((i) => Math.min(i + 1, efforts.length - 1)); return; }
      if (key.upArrow) { setSettingsCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.return) {
        const effort = efforts[settingsCursor]!;
        setEntries((c) => [...c, { role: "system", text: `${teamEditRole} → ${teamEditProvider} (effort: ${effort})` }]);
        setTeamPanel("pick-role"); // Go back to role selection for more changes
        setSettingsCursor(0);
        return;
      }
      return;
    }

    // MCP modes — Escape goes back
    if (mcpMode !== "off") {
      if (key.escape) {
        if (mcpMode === "list") { setMcpMode("off"); }
        else if (mcpMode === "remove") { setMcpMode("list"); }
        else { setMcpMode("list"); setInput(""); }
        return;
      }
      if (mcpMode === "list") {
        if (key.downArrow) { setMcpCursor((i) => Math.min(i + 1, 2)); return; }
        if (key.upArrow) { setMcpCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          if (mcpCursor === 0) { setMcpMode("add-name"); setInput(""); }
          else if (mcpCursor === 1 && mcpServers.length > 0) { setMcpMode("remove"); setMcpCursor(0); }
          else { setMcpMode("off"); }
          return;
        }
        return;
      }
      if (mcpMode === "remove") {
        if (key.downArrow) { setMcpCursor((i) => Math.min(i + 1, mcpServers.length - 1)); return; }
        if (key.upArrow) { setMcpCursor((i) => Math.max(i - 1, 0)); return; }
      }
      return;
    }

    if (key.escape && !isBusy) exit();

    if (suggestions.length > 0 && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off") {
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
      if (key.return) {
        const selected = suggestions[selectedIdx];
        if (selected) {
          setInput("");
          setSelectedIdx(0);
          // Directly trigger submit with the selected command
          submit(selected.name);
        }
        return;
      }
    }

    // Enter to submit (no autocomplete active)
    if (key.return && !isBusy && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off") {
      const value = input;
      setInput("");
      submit(value);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setInput((prev) => {
        const chars = [...prev];
        chars.pop();
        return chars.join("");
      });
      return;
    }

    // Regular character input (including Korean/CJK)
    if (ch && ch.length > 0 && !key.ctrl && !key.meta && !key.escape && ch.charCodeAt(0) >= 32) {
      setInput((prev) => {
        const next = prev + ch;
        if (next.startsWith("/")) setSelectedIdx(0);
        return next;
      });
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
      setInput("");

      // ── MCP mode submit flow (before busy/empty check) ──
      if (mcpMode === "remove") {
        const srv = mcpServers[mcpCursor];
        if (srv) {
          await agent.removeMcpServer(srv.name);
          const list = await agent.getMcpFullStatus();
          setMcpServers(list.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount, command: s.config.command })));
          setMcpCursor(0);
        }
        setMcpMode("list");
        return;
      }
      if (mcpMode === "add-name") {
        if (!line) { setMcpMode("list"); return; }
        setMcpAddName(line);
        setMcpMode("add-cmd");
        return;
      }
      if (mcpMode === "add-cmd") {
        if (!line) { setMcpMode("list"); return; }
        setMcpAddCmd(line);
        setMcpMode("add-args");
        return;
      }
      if (mcpMode === "add-args") {
        const args = line ? line.split(/\s+/) : [];
        const result = await agent.addMcpServer(mcpAddName, { command: mcpAddCmd, args });
        if (!result.ok) {
          setEntries((c) => [...c, {
            role: "system",
            text: `Failed to connect "${mcpAddName}": ${result.error ?? "unknown error"}\nServer was not saved. Check the command and args, then try again.`,
          }]);
          setMcpMode("off");
          return;
        }
        const list = await agent.getMcpFullStatus();
        setMcpServers(list.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount, command: s.config.command })));
        setMcpMode("list");
        return;
      }

      // ── Settings panel submit ──
      if (settingsPanel === "add-key") {
        if (line.trim()) {
          const { promises: fsp } = await import("node:fs");
          const p = await import("node:path");
          const o = await import("node:os");
          const credPath = p.join(o.homedir(), ".cats-claw", "credentials.json");
          let creds: Record<string, any> = {};
          try { creds = JSON.parse(await fsp.readFile(credPath, "utf8")); } catch {}
          creds[settingsProvider] = { apiKey: line.trim() };
          await fsp.mkdir(p.dirname(credPath), { recursive: true });
          await fsp.writeFile(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
          const defaults: Record<string, string> = { anthropic: "claude-sonnet-4-20250514", codex: "gpt-5.4", gemini: "gemini-2.5-flash", groq: "openai/gpt-oss-20b", openrouter: "anthropic/claude-sonnet-4" };
          agent.getMulti().register(settingsProvider as any, line.trim(), defaults[settingsProvider] ?? "default");
          setEntries((c) => [...c, { role: "system", text: `${settingsProvider} configured and saved.` }]);
        }
        setSettingsPanel("off");
        setSettingsProvider("");
        setInput("");
        return;
      }

      // ── Normal mode: skip empty/busy ──
      if (!line || isBusy) return;

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
            "  /status    - providers, usage & cost overview",
            "  /model     - list/switch models (number or id)",
            "  /team      - team dashboard & mode toggle",
            "  /ask <p> q - query specific provider",
            "  /tools     - built-in + MCP tools",
            "  /mcp       - MCP server manager",
            "  /git       - git status + diff + recent log",
            "  /history   - export chat to markdown",
            "  /compact   - compress conversation",
            "  /init      - generate CONTEXT.md",
            "  /doctor    - diagnostics",
            "  /skills   - list available skills",
            "  /hooks    - list configured hooks",
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
      if (line === "/model" || line === "/models") {
        setModelPanel("providers");
        setModelCursor(0);
        return;
      }
      if (line.startsWith("/model ")) {
        // Direct command: /model <provider> [model]
        const parts = line.split(/\s+/).slice(1);
        const validRoles = new Set(["planner", "coder", "reviewer", "tester", "optimizer"]);
        if (mode === "team" && validRoles.has(parts[0]!)) {
          const role = parts[0] as "planner" | "coder" | "reviewer" | "tester" | "optimizer";
          const prov = parts[1] as any;
          if (!prov || !agent.getMulti().isRegistered(prov)) {
            setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Usage: /model ${role} <provider>` }]);
          } else {
            const cfg = agent.getMulti().getProviderConfig(prov);
            if (cfg) {
              agent.getTeam().assignRole(role, { provider: prov, model: parts[2] ?? cfg.model, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
              setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `${role} → ${prov}/${parts[2] ?? cfg.model}` }]);
            }
          }
        } else {
          const provPlan = await detectPlan(parts[0] as any);
          const modelArg = parts[1];
          const resolvedModel = modelArg && /^\d+$/.test(modelArg)
            ? resolveModelByIndex(parts[0] as any, parseInt(modelArg, 10), provPlan) ?? modelArg
            : modelArg;
          const result = agent.switchProvider(parts[0] as any, resolvedModel);
          if (result.ok) {
            setProviderVersion((v) => v + 1);
            setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Switched to ${agent.getActiveProvider()}/${agent.getActiveModel()}` }]);
          } else {
            setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: result.error ?? "Failed." }]);
          }
        }
        return;
      }

      // ── git ──
      if (line === "/git" || line === "/diff" || line === "/log") {
        const parts: string[] = [];
        try {
          const { stdout: status } = await execAsync("git status --short", { cwd: options.cwd });
          parts.push(`Status:\n${status.trim() || "  (clean)"}`);
        } catch { parts.push("Not a git repository."); }
        try {
          const { stdout: diff } = await execAsync("git diff --stat", { cwd: options.cwd });
          if (diff.trim()) parts.push(`\nDiff:\n${diff.trim()}`);
        } catch {}
        try {
          const { stdout: log } = await execAsync("git log --oneline -5", { cwd: options.cwd });
          if (log.trim()) parts.push(`\nRecent commits:\n${log.trim()}`);
        } catch {}
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: parts.join("\n") }]);
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

      // ── ask ──
      if (line.startsWith("/ask ")) {
        const parts = line.slice(5).trim().split(/\s+/);
        const targetProvider = parts[0];
        const askPrompt = parts.slice(1).join(" ");
        if (!targetProvider || !askPrompt) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Usage: /ask <provider> <prompt>\nExample: /ask gemini explain this code" }]);
          return;
        }
        if (!agent.getMulti().isRegistered(targetProvider as any)) {
          const available = agent.getMulti().getRegistered().map((p) => p.name).join(", ");
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Provider "${targetProvider}" not available.\nAvailable: ${available}` }]);
          return;
        }
        setEntries((c) => [...c, { role: "user", text: line }]);
        setIsBusy(true);
        setThinkMsg(`asking ${targetProvider}...`);
        try {
          const result = await agent.getMulti().ask(targetProvider as any, askPrompt);
          setEntries((c) => [...c, { role: "assistant", text: `[${targetProvider}] ${result.text}` }]);
        } catch (err) {
          setEntries((c) => [...c, { role: "system", text: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
        } finally {
          setIsBusy(false);
        }
        return;
      }

      // ── team ──
      if (line === "/team") {
        setTeamPanel("list");
        return;
      }
      if (line.startsWith("/team ")) {
        const teamPrompt = line.slice(6).trim();
        if (!teamPrompt) {
          setTeamPanel("list");
          return;
        }
        if (!agent.getTeam().isReady()) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "No providers configured for team mode.\nSet API keys in .env or use Ollama." }]);
          return;
        }
        setEntries((c) => [...c, { role: "user", text: line }]);
        setIsBusy(true);
        try {
          const result = await agent.getTeam().run(teamPrompt, (phase, provider, model) => {
            setThinkMsg(`${phase} (${provider}/${model})...`);
          });
          const output = result.phases.map((p) =>
            `--- ${p.role.toUpperCase()} (${p.provider}/${p.model}, ${p.ms}ms) ---\n${p.text}`
          ).join("\n\n") + `\n\nTotal: ${result.totalMs}ms`;
          setEntries((c) => [...c, { role: "assistant", text: output }]);
        } catch (err) {
          setEntries((c) => [...c, { role: "system", text: `Team error: ${err instanceof Error ? err.message : String(err)}` }]);
        } finally {
          setIsBusy(false);
        }
        return;
      }

      // ── mode (redirect) ──
      if (line.startsWith("/mode")) {
        const target = line.split(/\s+/)[1]?.toLowerCase();
        if (target === "solo") { setMode("solo"); setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Switched to solo mode." }]); return; }
        if (target === "team") { setMode("team"); setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Switched to team mode." }]); return; }
        // No arg = show status
      }

      // ── settings panel ──
      if (line === "/settings") {
        setSettingsPanel("list");
        return;
      }

      // ── sessions ──
      if (line === "/sessions") {
        const sessions = await listSessions(10);
        if (sessions.length === 0) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "No saved sessions." }]);
        } else {
          const list = sessions.map((s) => `  ${s.id === sessionId ? "* " : "  "}${s.id}  ${s.provider}/${s.model}  ${s.turns} turns  ${s.preview}`).join("\n");
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Sessions:\n${list}\n\nResume: paw --session <id>` }]);
        }
        return;
      }

      if (line === "/session") {
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Current session: ${sessionId}` }]);
        return;
      }

      // ── status ──
      if (line === "/status" || line === "/providers" || line === "/cost" || line === "/version") {
        const registered = agent.getMulti().getRegistered();
        const teamRoles = agent.getTeam().getRoles();
        const usageReport = agent.tracker.formatReport();
        let text = `Cat's Claw v1.0.0 | Mode: ${mode.toUpperCase()}\n`;
        text += `Active: ${PROVIDER_LABELS[agent.getActiveProvider()] ?? agent.getActiveProvider()} / ${agent.getActiveModel()}\n`;
        text += `\nProviders (${registered.length}):\n`;
        text += registered.map((p) => `  ${p.name === agent.getActiveProvider() ? "* " : "  "}${p.name} — ${p.model}`).join("\n");
        if (mode === "team") {
          text += `\n\nTeam:\n`;
          text += teamRoles.map((r) => `  ${r.role.padEnd(10)} ${r.provider}/${r.model}`).join("\n");
        }
        text += `\n\nUsage:\n${usageReport}`;
        text += `\n\nSwitch: /model <provider> [model] | /team (dashboard)`;
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text }]);
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
        checks.push(`Provider: ${PROVIDER_LABELS[agent.getActiveProvider()] ?? agent.getActiveProvider()}`);
        checks.push(`Model: ${agent.getActiveModel()}`);
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

      // ── skills ──
      if (line === "/skills" || line === "/skill") {
        const { loadSkills, formatSkillList } = await import("./skills.js");
        const skills = await loadSkills(options.cwd);
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Skills:\n${formatSkillList(skills)}\n\nUsage: /<skill-name> [context]` }]);
        return;
      }

      // ── hooks ──
      if (line === "/hooks") {
        const hooks = agent.getHooks().listHooks();
        if (hooks.length === 0) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "No hooks configured.\n\nAdd hooks to .cats-claw/hooks.json:\n{\n  \"hooks\": [\n    { \"event\": \"pre-turn\", \"command\": \"echo preprocessing...\", \"name\": \"my-hook\" }\n  ]\n}" }]);
        } else {
          const list = hooks.map((h) => `  ${h.event}: ${h.name ?? h.command}`).join("\n");
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Hooks (${hooks.length}):\n${list}` }]);
        }
        return;
      }


      // ── unknown command / skill ──
      if (line.startsWith("/")) {
        const skillName = line.slice(1).split(/\s+/)[0]!;
        const skillContext = line.slice(1 + skillName.length).trim();
        const { loadSkills } = await import("./skills.js");
        const skills = await loadSkills(options.cwd);
        const skill = skills.find((s) => s.name === skillName);
        if (skill) {
          const fullPrompt = skillContext ? `${skill.prompt}\n\nContext:\n${skillContext}` : skill.prompt;
          setEntries((c) => [...c, { role: "user", text: line }]);
          setIsBusy(true);
          setThinkMsg(`running /${skillName}...`);
          try {
            const result = await agent.runTurn(fullPrompt);
            setTurnCount((c) => c + 1);
            setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty response)" }]);
          } catch (error) {
            setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
          } finally {
            setIsBusy(false);
          }
          return;
        }
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Unknown command: ${line}\nType /help for commands or /skills for skills.` }]);
        return;
      }

      // ── normal message ──
      setEntries((c) => [...c, { role: "user", text: line }]);
      setIsBusy(true);

      try {
        if (mode === "team" && agent.getTeam().isReady()) {
          let currentPhaseId: string | null = null;
          const result = await agent.getTeam().run(line, (phase, provider, model) => {
            if (currentPhaseId) agent.activityLog.finish(currentPhaseId);
            currentPhaseId = agent.activityLog.start("agent", `${phase}`, `${provider}/${model}`);
            setThinkMsg(`${phase} (${provider}/${model})...`);
          });
          if (currentPhaseId) agent.activityLog.finish(currentPhaseId);
          const output = result.phases.map((p) =>
            `--- ${p.role.toUpperCase()} (${p.provider}/${p.model}, ${p.ms}ms) ---\n${p.text}`
          ).join("\n\n") + `\n\nTotal: ${result.totalMs}ms`;
          setTurnCount((c) => c + 1);
          setEntries((c) => [...c, { role: "assistant", text: output }]);
        } else {
          setThinkMsg(randomCatMood());
          const result = await agent.runTurn(line);
          setTurnCount((c) => c + 1);
          setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty response)" }]);
        }
      } catch (error) {
        setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
      } finally {
        setIsBusy(false);
      }
    },
    [agent, exit, isBusy, entries, turnCount, options, mcpMode, mcpServers, mcpCursor, mcpAddName, mcpAddCmd, mode, teamPanel, teamEditRole, settingsPanel, settingsProvider, settingsCursor, modelPanel, modelPanelProvider, modelPanelModels, modelCursor, providerVersion],
  );

  const providerLabel = PROVIDER_LABELS[agent.getActiveProvider()] ?? agent.getActiveProvider();

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
            <Text color="#ffb088">Model:    <Text bold color="white">{agent.getActiveModel()}</Text></Text>
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

      {modelPanel !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Model Selection</Text>
          <Text color="gray">Active: <Text bold color="white">{agent.getActiveProvider()}/{agent.getActiveModel()}</Text></Text>

          {modelPanel === "providers" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select provider:</Text>
              {agent.getMulti().getRegistered().map((p, i) => (
                <Box key={p.name}>
                  <Text color={i === modelCursor ? "#ff9c73" : "gray"} bold={i === modelCursor}>
                    {i === modelCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === modelCursor ? "#ff9c73" : "#ffb088"}>{p.name}</Text>
                  <Text color="gray"> — {p.model}</Text>
                  {p.name === agent.getActiveProvider() ? <Text color="green"> (active)</Text> : null}
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {modelPanel === "models" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select model for <Text bold color="#ffb088">{modelPanelProvider}</Text>:</Text>
              {modelPanelModels.map((m, i) => (
                <Box key={m.id}>
                  <Text color={i === modelCursor ? "#ff9c73" : "gray"} bold={i === modelCursor}>
                    {i === modelCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === modelCursor ? "#ff9c73" : "gray"}>
                    {m.id}
                  </Text>
                  <Text color="gray"> — {m.name}</Text>
                  {m.id === agent.getActiveModel() ? <Text color="green"> *</Text> : null}
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {modelPanel === "effort" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select effort level for <Text bold color="#ffb088">{agent.getActiveProvider()}/{agent.getActiveModel()}</Text>:</Text>
              {(["Low — Fast responses, lighter reasoning", "Medium — Balanced speed and depth (default)", "High — Greater reasoning for complex problems", "Extra High — Maximum reasoning depth"] as const).map((label, i) => (
                <Box key={label}>
                  <Text color={i === modelCursor ? "#ff9c73" : "gray"} bold={i === modelCursor}>
                    {i === modelCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === modelCursor ? "#ff9c73" : "gray"}>{label}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {settingsPanel !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Provider Settings</Text>

          {settingsPanel === "list" ? (
            <Box flexDirection="column" marginTop={1}>
              {ALL_PROVIDERS.map((p, i) => {
                const isRegistered = agent.getMulti().isRegistered(p.name);
                return (
                  <Box key={p.name}>
                    <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                      {i === settingsCursor ? " > " : "   "}
                    </Text>
                    <Text color={isRegistered ? "green" : "gray"}>{isRegistered ? "● " : "○ "}</Text>
                    <Text color={i === settingsCursor ? "#ff9c73" : (isRegistered ? "#ffb088" : "gray")}>
                      {p.label}
                    </Text>
                    {p.name === agent.getActiveProvider() ? <Text color="green"> (active)</Text> : null}
                  </Box>
                );
              })}
              <Box marginTop={1}><Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text></Box>
            </Box>
          ) : null}

          {settingsPanel === "auth-method" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Configure: <Text bold color="#ffb088">{settingsProvider}</Text></Text>
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text color={settingsCursor === 0 ? "#ff9c73" : "gray"} bold={settingsCursor === 0}>
                    {settingsCursor === 0 ? " > " : "   "}
                  </Text>
                  <Text color={settingsCursor === 0 ? "#ff9c73" : "gray"}>
                    Use Codex login
                  </Text>
                </Box>
                <Box>
                  <Text color={settingsCursor === 1 ? "#ff9c73" : "gray"} bold={settingsCursor === 1}>
                    {settingsCursor === 1 ? " > " : "   "}
                  </Text>
                  <Text color={settingsCursor === 1 ? "#ff9c73" : "gray"}>Enter API key manually</Text>
                </Box>
              </Box>
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {settingsPanel === "add-key" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Provider: <Text bold color="#ffb088">{settingsProvider}</Text></Text>
              <Text color="#cc8866">Paste API key + Enter (Esc to cancel):</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {teamPanel !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Team Dashboard</Text>
          <Text color="gray">Mode: <Text bold color={mode === "team" ? "green" : "yellow"}>{mode.toUpperCase()}</Text></Text>

          {teamPanel === "list" ? (
            <Box flexDirection="column" marginTop={1}>
              {agent.getTeam().getRoles().map((r) => (
                <Box key={r.role}>
                  <Text color="#ffb088" bold>{`  ${r.role.padEnd(10)}`}</Text>
                  <Text color="gray">{` ${r.provider}/${r.model}`}</Text>
                </Box>
              ))}
              <Box marginTop={1} flexDirection="column">
                {["Edit role assignment", `Toggle mode (${mode === "solo" ? "→ team" : "→ solo"})`].map((label, i) => (
                  <Box key={label}>
                    <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                      {i === settingsCursor ? " > " : "   "}
                    </Text>
                    <Text color={i === settingsCursor ? "#ff9c73" : "gray"}>{label}</Text>
                  </Box>
                ))}
              </Box>
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {teamPanel === "pick-role" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select role to reassign:</Text>
              {agent.getTeam().getRoles().map((r, i) => (
                <Box key={r.role}>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                    {i === settingsCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"}>
                    {`${r.role} (${r.provider}/${r.model})`}
                  </Text>
                </Box>
              ))}
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {teamPanel === "pick-provider" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Assign <Text bold color="#ffb088">{teamEditRole}</Text> to:</Text>
              {agent.getMulti().getRegistered().map((p, i) => (
                <Box key={p.name}>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                    {i === settingsCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"}>{`${p.name} / ${p.model}`}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {teamPanel === "pick-model" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Model for <Text bold color="#ffb088">{teamEditRole}</Text> ({teamEditProvider}):</Text>
              {teamModels.map((m, i) => (
                <Box key={m.id}>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                    {i === settingsCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"}>{m.id} — {m.name}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {teamPanel === "pick-effort" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray">Effort for <Text bold color="#ffb088">{teamEditRole}</Text> ({teamEditProvider}):</Text>
              {["Low — Fast, lighter reasoning", "Medium — Balanced (default)", "High — Complex problems", "Extra High — Maximum depth"].map((label, i) => (
                <Box key={label}>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"} bold={i === settingsCursor}>
                    {i === settingsCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === settingsCursor ? "#ff9c73" : "gray"}>{label}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}
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
                mcpServers.map((s) => (
                  <Box key={s.name}>
                    <Text color={s.connected ? "green" : "red"}>{s.connected ? " ● " : " ○ "}</Text>
                    <Text color="#ffb088" bold>{s.name}</Text>
                    <Text color="gray"> — {s.command ?? "?"} — {s.toolCount} tool(s)</Text>
                  </Box>
                ))
              )}
              <Box marginTop={1} flexDirection="column">
                {["Add server", "Remove server", "Back"].map((label, i) => (
                  <Box key={label}>
                    <Text color={i === mcpCursor ? "#ff9c73" : "gray"} bold={i === mcpCursor}>
                      {i === mcpCursor ? " > " : "   "}
                    </Text>
                    <Text color={i === mcpCursor ? "#ff9c73" : "gray"}>{label}</Text>
                  </Box>
                ))}
              </Box>
              <Text color="gray" italic>{"  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {mcpMode === "remove" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select server to remove (arrows to move, Enter to confirm, Esc to cancel):</Text>
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
        <Text>{input}</Text><Text color="#ff9c73">█</Text>
      </Box>
      <Text color="gray" italic> Esc to quit | /help for commands</Text>
      <Box marginTop={0} paddingX={1} justifyContent="space-between">
        <Text color={mode === "team" ? "#ff9c73" : "gray"}>{mode === "team" ? "TEAM" : providerLabel}/{agent.getActiveModel()}</Text>
        <Text color="gray">turns: {turnCount}</Text>
        <Text color={agent.getMcpStatus().length > 0 ? "green" : "gray"}>
          mcp: {agent.getMcpStatus().length > 0 ? `${agent.getMcpStatus().length} server(s)` : "off"}
        </Text>
        <Text color="gray">
          {agent.getActiveProvider() !== "ollama" ? `tokens: ${formatTokens(agent.getUsage().inputTokens + agent.getUsage().outputTokens)}` : "local"}
        </Text>
      </Box>

      {/* Activity Log — below input */}
      {activityView && activityView !== "__select__" ? (() => {
        const act = agent.activityLog.getById(activityView);
        if (!act) return null;
        const visibleLogs = act.logs.slice(activityScroll, activityScroll + 5);
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="#553322" paddingX={2} paddingY={1}>
            <Text color="#ff9c73" bold>
              {act.status === "running" ? "◉" : act.status === "done" ? "✓" : "✗"} {act.name}
              {act.finishedAt ? ` (${((act.finishedAt - act.startedAt) / 1000).toFixed(1)}s)` : " ..."}
            </Text>
            {visibleLogs.map((log, i) => (
              <Box key={i} flexDirection="column">
                <Text color={log.type === "prompt" ? "cyan" : log.type === "response" ? "green" : log.type === "error" ? "red" : "gray"}>
                  {log.type === "prompt" ? "  → " : log.type === "response" ? "  ← " : log.type === "error" ? "  ✗ " : "  · "}
                  <Text color="gray" dimColor>[{log.type}]</Text>
                </Text>
                <Text color="gray" wrap="truncate-end">{"    " + log.content.slice(0, 150)}</Text>
              </Box>
            ))}
            {act.logs.length > 5 ? <Text color="gray" italic>  {activityScroll + 1}-{Math.min(activityScroll + 5, act.logs.length)} of {act.logs.length} | ↑↓ scroll</Text> : null}
            <Text color="gray" italic>  Esc to close</Text>
          </Box>
        );
      })() : null}

      {activityView === "__select__" ? (
        <Box flexDirection="column" paddingX={2}>
          {agent.activityLog.getRecent(5).map((act, i) => (
            <Box key={act.id} flexDirection="row">
              <Text color={i === activityCursor ? "#ff9c73" : (act.status === "running" ? "yellow" : act.status === "done" ? "green" : "red")} bold={i === activityCursor}>
                {i === activityCursor ? "> " : "  "}
                {act.status === "running" ? "◉ " : act.status === "done" ? "✓ " : "✗ "}
              </Text>
              <Text color={i === activityCursor ? "#ff9c73" : "gray"}>
                {act.name}{act.logs.length > 0 ? ` [${act.logs.length}]` : ""}
                {act.finishedAt ? ` (${((act.finishedAt - act.startedAt) / 1000).toFixed(1)}s)` : "..."}
              </Text>
            </Box>
          ))}
          <Text color="gray" italic>  ↑↓ select  Enter view  Esc back</Text>
        </Box>
      ) : null}

      {!activityView && agent.activityLog.getRunning().length > 0 ? (
        <Box flexDirection="column" paddingX={2}>
          {agent.activityLog.getRunning().map((act) => (
            <Box key={act.id} flexDirection="row">
              <Text color="yellow">{"  ◉ "}</Text>
              <Text color="gray">{act.name}...</Text>
            </Box>
          ))}
          <Text color="gray" italic>  ↓ to inspect</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function openTtyStdin(): tty.ReadStream | undefined {
  try {
    const fd = fs.openSync("/dev/tty", "r");
    const stream = new tty.ReadStream(fd);
    stream.setEncoding("utf8");
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
