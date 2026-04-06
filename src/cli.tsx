import { exec } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tty from "node:tty";
import { promisify } from "node:util";
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { Box, Newline, render, Text, useApp, useInput } from "ink";

import type { CodingAgent } from "./agent.js";
import { appendToSession, saveSession, listSessions, watchSession, type SessionData, type SessionEntry } from "./session.js";
import { formatActivityForHistory } from "./activity-log.js";
import { toolDefinitions } from "./tools.js";
import type { ProviderName, UserPrompt, UserPromptResult } from "./types.js";
import { formatModelList, getAllFilteredModels, resolveModelByIndex, detectPlan } from "./model-catalog.js";
import { routeMessage } from "./smart-router.js";
import { loadSkills, formatSkillList, renderSkill } from "./skills.js";
import { AutoAgent } from "./auto-agent.js";
import { PipeAgent } from "./pipe-agent.js";
import { SpawnManager } from "./spawn-agent.js";
import { loadMemory, appendMemory, formatMemoryInfo } from "./memory.js";
import { cursorManager } from "./cursor-manager.js";
import { Cursor, pushToKillRing, getLastKill, resetKillAccumulation } from "./cursor.js";
import { countLinesBelowInput, measureImeColumn } from "./ime-cursor.js";

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
  anthropic: "Anthropic",
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
  { name: "anthropic", label: "Anthropic", hasLogin: false },
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
  { name: "/export", desc: "export full context as markdown" },
  { name: "/compact", desc: "compress conversation" },
  { name: "/init", desc: "generate project context" },
  { name: "/doctor", desc: "diagnostics" },
  { name: "/sessions", desc: "list past sessions" },
  { name: "/session", desc: "current session ID" },
  { name: "/skills", desc: "list available skills" },
  { name: "/hooks", desc: "list configured hooks" },
  { name: "/memory", desc: "show loaded memory & instructions" },
  { name: "/clear", desc: "reset chat" },
  { name: "/exit", desc: "quit" },
  { name: "/auto", desc: "autonomous agent mode" },
  { name: "/pipe", desc: "feed shell output to AI" },
  { name: "/spawn", desc: "spawn a parallel sub-agent (↑↓ or /spawn <task>)" },
  { name: "/tasks", desc: "list spawned agent tasks" },
  { name: "/verify", desc: "toggle auto-verify or set provider (/verify ollama)" },
  { name: "/safety", desc: "configure safety guards" },
];

const PROVIDER_NAMES = new Set(["anthropic", "codex", "ollama"]);

/** Parse "/spawn [provider[/model]] <goal>" into components */
function parseSpawnArgs(raw: string): { provider?: ProviderName; model?: string; goal: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return { goal: "" };

  const first = parts[0]!;
  // Check if first token is "provider" or "provider/model"
  if (first.includes("/")) {
    const [prov, ...modelParts] = first.split("/");
    if (prov && PROVIDER_NAMES.has(prov)) {
      return { provider: prov as ProviderName, model: modelParts.join("/") || undefined, goal: parts.slice(1).join(" ") };
    }
  } else if (PROVIDER_NAMES.has(first)) {
    return { provider: first as ProviderName, goal: parts.slice(1).join(" ") };
  }

  return { goal: raw.trim() };
}

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
  const [cursorPos, setCursorPos] = useState(0);
  const cursorRef = React.useRef(0);
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = React.useRef(false);
  const pendingRef = React.useRef<string[]>([]);
  const lastEnterRef = React.useRef(0);
  const inputRef = React.useRef("");
  const [cancelRef] = useState({ current: false });
  const inputHistoryRef = React.useRef<string[]>(options.existingSession?.inputHistory ?? []);
  const historyIdxRef = React.useRef(-1);
  const historySavedRef = React.useRef("");
  const [thinkMsg, setThinkMsg] = useState("purring softly...");
  const [streamingText, setStreamingText] = useState("");
  const [pendingDisplay, setPendingDisplay] = useState<string[]>([]);
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
  const [statusPanel, setStatusPanel] = useState(false);
  const [verifyPanel, setVerifyPanel] = useState<"off" | "menu" | "providers" | "models" | "effort">("off");
  const [spawnPanel, setSpawnPanel] = useState<"off" | "providers" | "models" | "task">("off");
  const [spawnPanelProvider, setSpawnPanelProvider] = useState<string>("");
  const [spawnPanelModel, setSpawnPanelModel] = useState<string>("");
  const [spawnPanelModels, setSpawnPanelModels] = useState<{ id: string; name: string }[]>([]);
  const [spawnCursor, setSpawnCursor] = useState(0);
  const [spawnTaskInput, setSpawnTaskInput] = useState("");
  const [verifyPanelProvider, setVerifyPanelProvider] = useState<string>("");
  const [verifyPanelModels, setVerifyPanelModels] = useState<{ id: string; name: string }[]>([]);
  const [verifyCursor, setVerifyCursor] = useState(0);
  const [skillsCache, setSkillsCache] = useState<import("./skills.js").Skill[]>([]);
  const spawnResultsRef = React.useRef<string[]>([]);
  const persistedActivityIdsRef = React.useRef(new Set<string>());

  // Interactive prompt state (safety, hooks, agent questions)
  const [activePrompt, setActivePrompt] = useState<UserPrompt | null>(null);
  const [promptCursor, setPromptCursor] = useState(0);
  const [promptCustomInput, setPromptCustomInput] = useState("");
  const [promptCustomMode, setPromptCustomMode] = useState(false);
  const promptResolveRef = React.useRef<((result: UserPromptResult) => void) | null>(null);
  const [spawnManager] = useState(() => {
    const mgr = new SpawnManager(options.cwd, (task) => {
      if (task.status === "done" || task.status === "failed") {
        const icon = task.status === "done" ? "✓" : "✗";
        setEntries((c) => [
          ...c,
          {
            role: "system",
            text: `${icon} Agent #${task.id} ${task.status}: ${task.goal.slice(0, 60)}${task.result ? "\n" + task.result.split("\n").slice(0, 3).join("\n") : ""}${task.error ? "\nError: " + task.error : ""}`,
          },
        ]);
        // Queue result for auto-injection into next turn
        if (task.status === "done" && task.result) {
          spawnResultsRef.current.push(`[Agent #${task.id} completed: ${task.goal}]\n${task.result.slice(0, 500)}`);
        }
      }
    }, () => {
      // Always returns the current active provider/model at spawn time
      const config = agent.getMulti().getProviderConfig(agent.getActiveProvider());
      if (!config) return null;
      return { provider: agent.getActiveProvider(), apiKey: config.apiKey, model: agent.getActiveModel(), cwd: options.cwd, baseUrl: config.baseUrl };
    });
    return mgr;
  });
  const [spawnConfigured, setSpawnConfigured] = useState(false);

  // Pre-load skills for autocomplete
  React.useEffect(() => {
    loadSkills(options.cwd).then(setSkillsCache).catch(() => {});
  }, [options.cwd]);

  // All input handled in useInput below (no separate useStdin)

  // Unique ID for this terminal instance — used to ignore our own session writes
  const [writerId] = useState(() => Math.random().toString(36).slice(2, 10));

  // Watch session file for changes from other terminals
  React.useEffect(() => {
    const unwatch = watchSession(sessionId, (data) => {
      if (data.writerId === writerId) return; // ignore our own writes
      setEntries(data.entries.map((e) => ({ role: e.role, text: e.text })));
    });
    return unwatch;
  }, [sessionId, writerId]);

  // Listen for activity log changes
  React.useEffect(() => {
    agent.activityLog.setOnChange(() => setActivityVersion((v) => v + 1));
  }, [agent]);

  // Wire up interactive prompt callback (safety, hooks, etc.)
  const showPrompt = React.useCallback((prompt: UserPrompt): Promise<UserPromptResult> => {
    return new Promise<UserPromptResult>((resolve) => {
      promptResolveRef.current = resolve;
      setActivePrompt(prompt);
      setPromptCursor(0);
      setPromptCustomMode(false);
      setPromptCustomInput("");
    });
  }, []);

  React.useEffect(() => {
    agent.setSafetyConfig({ onPrompt: showPrompt });
    agent.setUserPrompt(showPrompt);
  }, [agent, showPrompt]);

  React.useEffect(() => {
    const freshEntries = agent.activityLog
      .getAll()
      .filter((act) => (act.status === "done" || act.status === "error") && act.type !== "agent" && !persistedActivityIdsRef.current.has(act.id))
      .map((act) => ({ id: act.id, text: formatActivityForHistory(act) }))
      .filter((item): item is { id: string; text: string } => Boolean(item.text));

    if (freshEntries.length === 0) return;

    for (const item of freshEntries) {
      persistedActivityIdsRef.current.add(item.id);
    }

    setEntries((current) => [
      ...current,
      ...freshEntries.map((item) => ({ role: "system" as const, text: item.text })),
    ]);
  }, [agent, activityVersion]);

  // Save session after 1s of no changes (debounced to avoid I/O on every keystroke)
  React.useEffect(() => {
    if (entries.length <= 1) return;
    const timeout = setTimeout(() => {
      const data: SessionData = {
        id: sessionId,
        provider: agent.getActiveProvider(),
        model: agent.getActiveModel(),
        mode,
        cwd: options.cwd,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entries: entries.map((e) => ({ role: e.role, text: e.text, timestamp: new Date().toISOString() })),
        inputHistory: inputHistoryRef.current,
        writerId,
      };
      saveSession(data).catch(() => {});
    }, 1000);
    return () => clearTimeout(timeout);
  }, [entries, sessionId]);

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const q = input.toLowerCase();
    const cmdMatches = COMMANDS.filter((c) => c.name.startsWith(q));
    const skillMatches = skillsCache
      .filter((s) => s.userInvocable !== false)
      .filter((s) => `/${s.name}`.startsWith(q))
      .filter((s) => !COMMANDS.some((c) => c.name === `/${s.name}`))
      .map((s) => ({
        name: `/${s.name}`,
        desc: s.argumentHint ? `${s.description} [${s.argumentHint}]` : s.description,
      }));
    return [...cmdMatches, ...skillMatches];
  }, [input, skillsCache]);

  useInput((ch, key) => {
    // ── Interactive prompt panel ──
    if (activePrompt) {
      const choices = activePrompt.choices;
      if (promptCustomMode) {
        if (key.escape) { setPromptCustomMode(false); return; }
        if (key.return) {
          promptResolveRef.current?.({ value: "__custom__", customText: promptCustomInput });
          promptResolveRef.current = null;
          setEntries((c) => [...c, { role: "system", text: `→ "${promptCustomInput}"` }]);
          setActivePrompt(null);
          setPromptCustomInput("");
          setPromptCustomMode(false);
          return;
        }
        if (key.backspace || key.delete) { setPromptCustomInput((s) => s.slice(0, -1)); return; }
        if (ch && !key.ctrl && !key.meta) { setPromptCustomInput((s) => s + ch); return; }
        return;
      }
      if (key.escape) {
        // Escape = pick the second choice (deny) or first if only one
        const denyIdx = choices.length > 1 ? 1 : 0;
        promptResolveRef.current?.({ value: choices[denyIdx].value });
        promptResolveRef.current = null;
        setEntries((c) => [...c, { role: "system", text: `→ ${choices[denyIdx].label}` }]);
        setActivePrompt(null);
        return;
      }
      if (key.upArrow) { setPromptCursor((i) => Math.max(i - 1, 0)); return; }
      if (key.downArrow) { setPromptCursor((i) => Math.min(i + 1, choices.length - 1)); return; }
      // Number key shortcuts (1-9)
      if (ch >= "1" && ch <= "9") {
        const idx = Number(ch) - 1;
        if (idx < choices.length) {
          if (activePrompt.allowCustom && idx === choices.length - 1) {
            setPromptCustomMode(true);
            return;
          }
          promptResolveRef.current?.({ value: choices[idx].value });
          promptResolveRef.current = null;
          setEntries((c) => [...c, { role: "system", text: `→ ${choices[idx].label}` }]);
          setActivePrompt(null);
          return;
        }
      }
      if (key.return) {
        const selected = choices[promptCursor];
        if (activePrompt.allowCustom && promptCursor === choices.length - 1) {
          setPromptCustomMode(true);
          return;
        }
        promptResolveRef.current?.({ value: selected.value });
        promptResolveRef.current = null;
        setEntries((c) => [...c, { role: "system", text: `→ ${selected.label}` }]);
        setActivePrompt(null);
        return;
      }
      return;
    }

    if (key.ctrl && ch === "c") {
      if (isBusy) {
        cancelRef.current = true;
        setEntries((c) => [...c, { role: "system", text: "Interrupted." }]);
        setIsBusy(false);
        return;
      }
      exit();
    }

    // Status panel
    if (statusPanel) {
      if (key.escape) { setStatusPanel(false); return; }
      return;
    }

    // ↑↓ = input history navigation (when no panels/suggestions active)
    const noPanel = suggestions.length === 0 && !statusPanel && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off" && verifyPanel === "off" && spawnPanel === "off" && !activityView;
    if ((key.upArrow || key.downArrow) && noPanel) {
      const hist = inputHistoryRef.current;
      if (hist.length === 0) return;
      // Save current input when first entering history
      if (historyIdxRef.current === -1) {
        historySavedRef.current = inputRef.current;
      }
      // Total slots = history entries + saved draft (at the end)
      const total = hist.length + 1;
      const curSlot = historyIdxRef.current === -1 ? hist.length : historyIdxRef.current;
      const nextSlot = key.upArrow
        ? (curSlot - 1 + total) % total
        : (curSlot + 1) % total;
      if (nextSlot === hist.length) {
        // Back to saved draft
        historyIdxRef.current = -1;
        const val = historySavedRef.current;
        inputRef.current = val;
        cursorRef.current = [...val].length;
        setInput(val);
        setCursorPos([...val].length);
      } else {
        historyIdxRef.current = nextSlot;
        const val = hist[nextSlot];
        inputRef.current = val;
        cursorRef.current = [...val].length;
        setInput(val);
        setCursorPos([...val].length);
      }
      return;
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

    // Activity selector mode (must check BEFORE detail viewer)
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

    // Activity detail viewer
    if (activityView && activityView !== "__select__") {
      if (key.escape) { setActivityView(null); setActivityScroll(0); return; }
      const act = agent.activityLog.getById(activityView);
      if (act) {
        const maxScroll = Math.max(0, act.logs.length - 5);
        if (key.downArrow) { setActivityScroll((s) => Math.min(s + 1, maxScroll)); return; }
        if (key.upArrow) { setActivityScroll((s) => Math.max(s - 1, 0)); return; }
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

    // Spawn panel
    if (spawnPanel !== "off") {
      if (spawnPanel === "providers") {
        const registered = agent.getMulti().getRegistered();
        if (key.escape) { setSpawnPanel("off"); return; }
        if (key.downArrow) { setSpawnCursor((i) => Math.min(i + 1, registered.length - 1)); return; }
        if (key.upArrow) { setSpawnCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = registered[spawnCursor];
          if (selected) {
            setSpawnPanelProvider(selected.name);
            getAllFilteredModels(agent.getProviderKeys()).then((all) => {
              const provModels = all.find((g) => g.provider === selected.name);
              setSpawnPanelModels(provModels?.models.map((m) => ({ id: m.id, name: m.name })) ?? []);
              setSpawnPanel("models");
              setSpawnCursor(0);
            });
          }
          return;
        }
        return;
      }
      if (spawnPanel === "models") {
        if (key.escape) { setSpawnPanel("providers"); setSpawnCursor(0); return; }
        if (key.downArrow) { setSpawnCursor((i) => Math.min(i + 1, spawnPanelModels.length - 1)); return; }
        if (key.upArrow) { setSpawnCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = spawnPanelModels[spawnCursor];
          if (selected) {
            setSpawnPanelModel(selected.id);
            setSpawnTaskInput("");
            setSpawnPanel("task");
          }
          return;
        }
        return;
      }
      if (spawnPanel === "task") {
        if (key.escape) { setSpawnPanel("models"); setSpawnCursor(0); return; }
        if (key.return && spawnTaskInput.trim()) {
          // Execute the spawn
          if (!spawnConfigured) {
            const registered = agent.getMulti().getRegistered();
            for (const reg of registered) {
              const config = agent.getMulti().getProviderConfig(reg.name);
              if (config) {
                spawnManager.addConfig({ provider: reg.name, apiKey: config.apiKey, model: config.model ?? reg.model, cwd: options.cwd, baseUrl: config.baseUrl });
              }
            }
            setSpawnConfigured(true);
          }
          const id = spawnManager.spawn(spawnTaskInput.trim(), spawnPanelProvider as ProviderName, spawnPanelModel, getSessionContext());
          const task = spawnManager.getTask(id);
          setEntries((c) => [...c, { role: "system", text: `Spawned agent #${id} (${task?.provider}/${task?.model}): ${spawnTaskInput.trim()}` }]);
          setSpawnPanel("off");
          setSpawnTaskInput("");
          return;
        }
        if (key.backspace || key.delete) {
          setSpawnTaskInput((s) => s.slice(0, -1));
          return;
        }
        if (ch && !key.ctrl && !key.meta) {
          setSpawnTaskInput((s) => s + ch);
          return;
        }
        return;
      }
    }

    // Verify panel
    if (verifyPanel !== "off") {
      if (verifyPanel === "menu") {
        const menuItems = ["Toggle ON/OFF", "Select reviewer provider", "Auto (use different provider)"];
        if (key.escape) { setVerifyPanel("off"); return; }
        if (key.downArrow) { setVerifyCursor((i) => Math.min(i + 1, menuItems.length - 1)); return; }
        if (key.upArrow) { setVerifyCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          if (verifyCursor === 0) {
            const next = !agent.isVerifyEnabled();
            agent.enableVerify(next);
            const prov = agent.getVerifyProvider();
            const model = agent.verifier.getModel();
            const label = prov ? `${prov}${model ? `/${model}` : ""}` : "auto";
            setEntries((c) => [...c, { role: "system", text: next ? `Auto-verify: ON (reviewer: ${label})` : "Auto-verify: OFF" }]);
            setVerifyPanel("off");
          } else if (verifyCursor === 1) {
            setVerifyPanel("providers");
            setVerifyCursor(0);
          } else {
            agent.setVerifyProvider(null);
            agent.enableVerify(true);
            setEntries((c) => [...c, { role: "system", text: "Auto-verify: ON (reviewer: auto)" }]);
            setVerifyPanel("off");
          }
          return;
        }
        return;
      }
      if (verifyPanel === "providers") {
        const registered = agent.getMulti().getRegistered();
        if (key.escape) { setVerifyPanel("menu"); setVerifyCursor(0); return; }
        if (key.downArrow) { setVerifyCursor((i) => Math.min(i + 1, registered.length - 1)); return; }
        if (key.upArrow) { setVerifyCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = registered[verifyCursor];
          if (selected) {
            setVerifyPanelProvider(selected.name);
            getAllFilteredModels(agent.getProviderKeys()).then((all) => {
              const provModels = all.find((g) => g.provider === selected.name);
              setVerifyPanelModels(provModels?.models.map((m) => ({ id: m.id, name: m.name })) ?? []);
              setVerifyPanel("models");
              setVerifyCursor(0);
            });
          }
          return;
        }
        return;
      }
      if (verifyPanel === "models") {
        if (key.escape) { setVerifyPanel("providers"); setVerifyCursor(0); return; }
        if (key.downArrow) { setVerifyCursor((i) => Math.min(i + 1, verifyPanelModels.length - 1)); return; }
        if (key.upArrow) { setVerifyCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = verifyPanelModels[verifyCursor];
          if (selected) {
            if (verifyPanelProvider === "codex") {
              agent.setVerifyProvider(verifyPanelProvider as ProviderName, selected.id);
              setVerifyPanel("effort");
              setVerifyCursor(1); // default = medium
              return;
            }
            agent.setVerifyProvider(verifyPanelProvider as ProviderName, selected.id);
            agent.enableVerify(true);
            setEntries((c) => [...c, { role: "system", text: `Auto-verify: ON (reviewer: ${verifyPanelProvider}/${selected.id})` }]);
          }
          setVerifyPanel("off");
          return;
        }
        return;
      }
      if (verifyPanel === "effort") {
        const efforts = ["low", "medium", "high", "extra_high"] as const;
        if (key.escape) { setVerifyPanel("models"); setVerifyCursor(0); return; }
        if (key.downArrow) { setVerifyCursor((i) => Math.min(i + 1, efforts.length - 1)); return; }
        if (key.upArrow) { setVerifyCursor((i) => Math.max(i - 1, 0)); return; }
        if (key.return) {
          const selected = efforts[verifyCursor]!;
          agent.verifier.setEffort(selected);
          agent.enableVerify(true);
          const model = agent.verifier.getModel();
          setEntries((c) => [...c, { role: "system", text: `Auto-verify: ON (reviewer: ${verifyPanelProvider}/${model}, effort: ${selected})` }]);
          setVerifyPanel("off");
          return;
        }
        return;
      }
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

    if (key.escape) {
      if (isBusy) {
        cancelRef.current = true;
        setEntries((c) => [...c, { role: "system", text: "Cancelling..." }]);
        setIsBusy(false);
        return;
      }
      exit();
    }

    if (suggestions.length > 0 && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off" && verifyPanel === "off" && spawnPanel === "off") {
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

    // Enter to submit (inputRef synced synchronously — IME double-fire sees empty ref and exits)
    if (key.return && mcpMode === "off" && modelPanel === "off" && settingsPanel === "off" && teamPanel === "off" && verifyPanel === "off" && spawnPanel === "off") {
      const value = inputRef.current;
      if (!value.trim()) return;
      inputHistoryRef.current.push(value);
      if (inputHistoryRef.current.length > 100) inputHistoryRef.current.shift();
      historyIdxRef.current = -1;
      historySavedRef.current = "";
      inputRef.current = "";
      cursorRef.current = 0;
      setInput("");
      setCursorPos(0);
      submit(value);
      return;
    }

    // Build cursor for all input operations
    const cursor = Cursor.fromText(inputRef.current, process.stdout.columns ?? 80, cursorRef.current);

    // Ctrl+A = start of line
    if (key.ctrl && ch === "a") {
      const c = cursor.startOfLine();
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    // Ctrl+E = end of line
    if (key.ctrl && ch === "e") {
      const c = cursor.endOfLine();
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    // Ctrl+D = delete forward
    if (key.ctrl && ch === "d") {
      const c = cursor.del();
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      resetKillAccumulation();
      return;
    }
    // Ctrl+K = kill to end of line
    if (key.ctrl && ch === "k") {
      const { cursor: c, killed } = cursor.deleteToLineEnd();
      if (killed) pushToKillRing(killed, "append");
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    // Ctrl+U = kill to start of line
    if (key.ctrl && ch === "u") {
      const { cursor: c, killed } = cursor.deleteToLineStart();
      if (killed) pushToKillRing(killed, "prepend");
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    // Ctrl+W = kill word before cursor
    if (key.ctrl && ch === "w") {
      const { cursor: c, killed } = cursor.deleteWordBefore();
      if (killed) pushToKillRing(killed, "prepend");
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    // Ctrl+Y = yank (paste from kill ring)
    if (key.ctrl && ch === "y") {
      const text = getLastKill();
      if (text) {
        const c = cursor.insert(text);
        inputRef.current = c.text;
        setInput(c.text);
        cursorRef.current = c.offset;
        setCursorPos(c.offset);
      }
      resetKillAccumulation();
      return;
    }

    // Left/Right arrow — move cursor within input (grapheme-aware)
    if (key.leftArrow && !key.ctrl && !key.meta) {
      const c = cursor.left();
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }
    if (key.rightArrow && !key.ctrl && !key.meta) {
      const c = cursor.right();
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      return;
    }

    // Backspace — delete character before cursor (grapheme-aware)
    if (key.backspace || key.delete) {
      const c = cursor.backspace();
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      resetKillAccumulation();
      return;
    }

    // Regular character input (including Korean/CJK) — insert at cursor
    if (ch && ch.length > 0 && !key.ctrl && !key.meta && !key.escape && ch.charCodeAt(0) >= 32) {
      const c = cursor.insert(ch);
      inputRef.current = c.text;
      setInput(c.text);
      cursorRef.current = c.offset;
      setCursorPos(c.offset);
      resetKillAccumulation();
      if (c.text.startsWith("/")) setSelectedIdx(0);
    }
  });

  // Reposition terminal cursor at input field for Korean/CJK IME composition.
  // Calculate linesUp dynamically based on what renders below the input box.
  useLayoutEffect(() => {
    const chars = [...inputRef.current];
    const textBefore = chars.slice(0, cursorRef.current).join("");
    const col = measureImeColumn(textBefore);
    const runningActivityCount = turnCount > 0 ? agent.activityLog.getRunning().length : 0;
    const activityLogCount = activityView && activityView !== "__select__"
      ? Math.min(agent.activityLog.getById(activityView)?.logs.length ?? 0, 5)
      : 0;
    const linesBelow = countLinesBelowInput({
      activitySelectorCount: activityView === "__select__" ? agent.activityLog.getRecent(5).length : 0,
      activityLogCount,
      runningActivityCount,
      isViewingActivitySelector: activityView === "__select__",
      isViewingActivityDetail: Boolean(activityView && activityView !== "__select__"),
    });

    cursorManager.setCursorPosition(linesBelow, col);
  }, [agent, input, cursorPos, activityView, turnCount, activityVersion]);

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

  // Build recent conversation context for spawn agents
  const getSessionContext = useCallback(() => {
    return entries.slice(-10).map((e) => {
      if (e.role === "user") return `> ${e.text}`;
      if (e.role === "assistant") return `AI: ${e.text.slice(0, 300)}`;
      return `[${e.text.slice(0, 100)}]`;
    }).join("\n");
  }, [entries]);

  const submit = useCallback(
    async (value: string, skipRender = false) => {
      const line = value.trim();
      setInput("");
      cursorRef.current = 0;
      setCursorPos(0);

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
          const credPath = path.join(os.homedir(), ".paw", "credentials.json");
          let creds: Record<string, any> = {};
          try { creds = JSON.parse(await fsPromises.readFile(credPath, "utf8")); } catch {}
          creds[settingsProvider] = { apiKey: line.trim() };
          await fsPromises.mkdir(path.dirname(credPath), { recursive: true });
          await fsPromises.writeFile(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
          const defaults: Record<string, string> = { anthropic: "claude-sonnet-4-20250514", codex: "gpt-5.4", gemini: "gemini-2.5-flash", groq: "openai/gpt-oss-20b", openrouter: "anthropic/claude-sonnet-4" };
          agent.getMulti().register(settingsProvider as any, line.trim(), defaults[settingsProvider] ?? "default");
          setEntries((c) => [...c, { role: "system", text: `${settingsProvider} configured and saved.` }]);
        }
        setSettingsPanel("off");
        setSettingsProvider("");
        setInput("");
        return;
      }

      // ── Normal mode: skip empty ──
      if (!line) return;

      // ── exit (always immediate) ──
      if (line === "/exit" || line === "/quit") { exit(); return; }

      // ── clear (always immediate, also cancels queue) ──
      if (line === "/clear") {
        agent.clear();
        setTurnCount(0);
        pendingRef.current = [];
        setEntries([{ role: "system", text: "Conversation cleared." }]);
        return;
      }

      // ── spawn runs immediately even while busy ──
      if (line.startsWith("/spawn ") && busyRef.current) {
        const parsed = parseSpawnArgs(line.slice(7));
        if (parsed.goal) {
          if (!spawnConfigured) {
            const registered = agent.getMulti().getRegistered();
            for (const reg of registered) {
              const config = agent.getMulti().getProviderConfig(reg.name);
              if (config) {
                spawnManager.addConfig({ provider: reg.name, apiKey: config.apiKey, model: config.model ?? reg.model, cwd: options.cwd, baseUrl: config.baseUrl });
              }
            }
            setSpawnConfigured(true);
          }
          const id = spawnManager.spawn(parsed.goal, parsed.provider, parsed.model, getSessionContext());
          const task = spawnManager.getTask(id);
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: `Spawned agent #${id} (${task?.provider}/${task?.model}): ${parsed.goal}` },
          ]);
        }
        return;
      }

      // ── /tasks runs immediately even while busy ──
      if ((line === "/tasks" || line.startsWith("/tasks ")) && busyRef.current) {
        const arg = line.slice(6).trim();
        if (arg === "results" || arg === "result") {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: spawnManager.formatResults() }]);
        } else if (arg === "clear") {
          const cleared = spawnManager.clearCompleted();
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Cleared ${cleared} completed task(s).` }]);
        } else {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: spawnManager.formatStatus() }]);
        }
        return;
      }

      // ── queue if busy (show in pending area, process merged after response) ──
      if (busyRef.current) {
        pendingRef.current.push(line);
        setPendingDisplay((c) => [...c, line]);
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
            "  /auto <task> - autonomous agent (plan→execute→verify→fix loop)",
            "  /pipe <cmd>  - run command, AI analyzes output",
            "  /pipe fix <cmd> - run, fix errors, repeat until pass",
            "  /spawn <task> - spawn parallel sub-agent",
            "  /tasks       - list spawned tasks (/tasks results, /tasks clear)",
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

      // ── export (structured context summary as markdown) ──
      if (line === "/export") {
        const exportPath = path.join(options.cwd, `paw-export-${Date.now()}.md`);
        const { sources } = await loadMemory(options.cwd);
        const sections: string[] = [
          `# Paw Session Export`,
          `> ${new Date().toISOString()} | ${agent.getActiveProvider()}/${agent.getActiveModel()} | ${entries.length} entries`,
          "",
        ];

        // Memory sources
        if (sources.length > 0) {
          sections.push("## Memory & Instructions\n");
          for (const s of sources) {
            sections.push(`### ${s.level} (${s.path})\n\n${s.content}\n`);
          }
        }

        // Conversation
        sections.push("## Conversation\n");
        for (const e of entries) {
          if (e.role === "user") sections.push(`### > ${e.text}\n`);
          else if (e.role === "assistant") sections.push(`${e.text}\n`);
          else sections.push(`*${e.text}*\n`);
        }

        // Spawn results
        const completed = spawnManager.getCompletedTasks();
        if (completed.length > 0) {
          sections.push("## Sub-Agent Results\n");
          for (const t of completed) {
            sections.push(`### Agent #${t.id}: ${t.goal}\n\n**Provider:** ${t.provider}/${t.model} | **Status:** ${t.status}\n\n${t.result ?? t.error ?? "(no output)"}\n`);
          }
        }

        // Usage
        sections.push(`## Usage\n\n${agent.tracker.formatReport()}\n`);

        try {
          await fsPromises.writeFile(exportPath, sections.join("\n"), "utf8");
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
      if (line === "/compact" || line.startsWith("/compact ")) {
        const focus = line.startsWith("/compact ") ? line.slice(9).trim() : undefined;
        setThinkMsg("Compacting conversation...");
        busyRef.current = true;
        setIsBusy(true);
        try {
          const result = await agent.compact(focus);
          if (result) {
            setEntries([
              { role: "system", text: `Conversation compacted. ${result.droppedCount} messages summarized, recent messages preserved.` },
              { role: "system", text: `Summary:\n${result.summary.slice(0, 500)}` },
            ]);
          } else {
            setEntries((c) => [...c, { role: "system", text: "Nothing to compact." }]);
          }
        } catch {
          setEntries((c) => [...c, { role: "system", text: "Compaction failed." }]);
        } finally {
          busyRef.current = false;
          setIsBusy(false);
        }
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
        setStatusPanel(true);
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
        const skills = await loadSkills(options.cwd);
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Skills:\n${formatSkillList(skills)}\n\nUsage: /<skill-name> [context]` }]);
        return;
      }

      // ── hooks ──
      if (line === "/hooks") {
        const hooks = agent.getHooks().listHooks();
        if (hooks.length === 0) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "No hooks configured.\n\nAdd hooks to .paw/hooks/*.md or .paw/settings.json" }]);
        } else {
          const list = hooks.map((h) => {
            const parts = [`  ${h.event}`];
            if (h.matcher) parts.push(`[matcher: ${h.matcher}]`);
            parts.push(`→ ${h.name ?? h.command}`);
            if (h.source) parts.push(`(${h.source})`);
            return parts.join(" ");
          }).join("\n");
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Hooks (${hooks.length}):\n${list}` }]);
        }
        return;
      }


      // ── memory ──
      if (line === "/memory") {
        const { sources } = await loadMemory(options.cwd);
        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: formatMemoryInfo(sources) }]);
        return;
      }
      if (line.startsWith("/remember ")) {
        const note = line.slice(10).trim();
        if (note) {
          await appendMemory(note);
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Saved to memory: ${note}` }]);
        }
        return;
      }

      // ── pipe ──
      if (line.startsWith("/pipe ")) {
        const pipeArgs = line.slice(6).trim();
        if (!pipeArgs) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Usage:\n  /pipe <command> — run and analyze\n  /pipe fix <command> — run, fix errors, repeat\n  /pipe watch <command> — watch and analyze" }]);
          return;
        }
        setEntries((c) => [...c, { role: "user", text: line }]);
        setIsBusy(true);

        try {
          const pipe = new PipeAgent(
            options.cwd,
            (prompt) => agent.runTurn(prompt),
            (msg) => setThinkMsg(msg),
          );

          let result;
          if (pipeArgs.startsWith("fix ")) {
            result = await pipe.fix(pipeArgs.slice(4).trim());
          } else if (pipeArgs.startsWith("watch ")) {
            result = await pipe.watch(pipeArgs.slice(6).trim());
          } else {
            result = await pipe.analyze(pipeArgs);
          }

          const header = result.fixed
            ? `FIXED after ${result.iterations} iteration(s) (${(result.totalMs / 1000).toFixed(1)}s)`
            : result.mode === "analyze"
              ? `Analyzed (${(result.totalMs / 1000).toFixed(1)}s)`
              : `${result.iterations} iteration(s), not fully fixed (${(result.totalMs / 1000).toFixed(1)}s)`;

          setTurnCount((c) => c + 1);
          setEntries((c) => [...c, { role: "assistant", text: `[pipe: ${header}]\n${result.analysis}` }]);
        } catch (error) {
          setEntries((c) => [...c, { role: "system", text: `Pipe failed: ${error instanceof Error ? error.message : String(error)}` }]);
        } finally {
          setIsBusy(false);
        }
        return;
      }

      // ── auto ──
      if (line.startsWith("/auto ")) {
        const autoGoal = line.slice(6).trim();
        if (!autoGoal) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Usage: /auto <task>\nExample: /auto add input validation to the login form" }]);
          return;
        }
        setEntries((c) => [...c, { role: "user", text: line }]);
        setIsBusy(true);

        try {
          const auto = new AutoAgent(
            options.cwd,
            (prompt) => agent.runTurn(prompt),
            (step) => {
              const icon = step.status === "running" ? "◉" : step.status === "success" ? "✓" : "✗";
              setThinkMsg(`${icon} ${step.description}`);
            },
          );

          const result = await auto.run(autoGoal);

          // Build output
          const lines: string[] = [`Auto: ${result.success ? "COMPLETED" : "INCOMPLETE"} (${(result.totalMs / 1000).toFixed(1)}s)\n`];
          for (const step of result.steps) {
            const icon = step.status === "success" ? "✓" : step.status === "fail" ? "✗" : "◉";
            const dur = step.ms ? ` (${(step.ms / 1000).toFixed(1)}s)` : "";
            lines.push(`${icon} ${step.action}: ${step.description}${dur}`);
            if (step.result && step.action === "done") {
              lines.push(step.result);
            }
          }

          setTurnCount((c) => c + 1);
          setEntries((c) => [...c, { role: "assistant", text: lines.join("\n") }]);
        } catch (error) {
          setEntries((c) => [...c, { role: "system", text: `Auto failed: ${error instanceof Error ? error.message : String(error)}` }]);
        } finally {
          setIsBusy(false);
        }
        return;
      }

      // ── spawn ──
      if (line === "/spawn") {
        setSpawnPanel("providers");
        setSpawnCursor(0);
        return;
      }
      if (line.startsWith("/spawn ")) {
        const parsed = parseSpawnArgs(line.slice(7));
        if (!parsed.goal) {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Usage: /spawn [provider[/model]] <task>\nExamples:\n  /spawn add tests for auth\n  /spawn anthropic refactor the API\n  /spawn codex/gpt-5.4 update README\n  /spawn ollama/llama3 fix lint errors" }]);
          return;
        }

        // Register provider configs lazily on first spawn
        if (!spawnConfigured) {
          const registered = agent.getMulti().getRegistered();
          for (const reg of registered) {
            const config = agent.getMulti().getProviderConfig(reg.name);
            if (config) {
              spawnManager.addConfig({
                provider: reg.name,
                apiKey: config.apiKey,
                model: config.model ?? reg.model,
                cwd: options.cwd,
                baseUrl: config.baseUrl,
              });
            }
          }
          setSpawnConfigured(true);
        }

        const id = spawnManager.spawn(parsed.goal, parsed.provider, parsed.model, getSessionContext());
        const task = spawnManager.getTask(id);
        setEntries((c) => [
          ...c,
          { role: "user", text: line },
          { role: "system", text: `Spawned agent #${id} (${task?.provider}/${task?.model}): ${parsed.goal}` },
        ]);
        return;
      }

      // ── tasks ──
      if (line === "/tasks" || line.startsWith("/tasks ")) {
        const arg = line.slice(6).trim();

        if (arg === "results" || arg === "result") {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: spawnManager.formatResults() }]);
        } else if (arg === "clear") {
          const cleared = spawnManager.clearCompleted();
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Cleared ${cleared} completed task(s).` }]);
        } else {
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: spawnManager.formatStatus() }]);
        }
        return;
      }

      // ── unknown command / skill ──
      // Exclude file paths like /home/dev/... — commands are /word with no nested slashes
      if (line.startsWith("/") && !line.slice(1).split(/\s+/)[0]!.includes("/")) {
        const skillName = line.slice(1).split(/\s+/)[0]!;
        const skillArgs = line.slice(1 + skillName.length).trim();
        const skills = await loadSkills(options.cwd);
        const skill = skills.find((s) => s.name === skillName);
        if (skill) {
          const fullPrompt = await renderSkill(skill, skillArgs, options.cwd);
          setEntries((c) => [...c, { role: "user", text: line }]);
          setIsBusy(true);
          setThinkMsg(`running /${skillName}...`);
          try {
            if (!skill.disableModelInvocation) {
              const result = await agent.runTurn(fullPrompt);
              setTurnCount((c) => c + 1);
              setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty response)" }]);
            }
          } catch (error) {
            setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
          } finally {
            setIsBusy(false);
          }
          return;
        }
      // ── verify ──
      if (line === "/verify") {
        setVerifyPanel("menu");
        setVerifyCursor(0);
        return;
      }

      // ── safety ──
      if (line === "/safety" || line.startsWith("/safety ")) {
        const arg = line.slice("/safety".length).trim();
        if (arg === "off") {
          agent.setSafetyConfig({ enabled: false });
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Safety: OFF | All guards disabled." }]);
        } else if (arg === "on") {
          agent.setSafetyConfig({ enabled: true });
          setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: "Safety: ON | Auto-checkpoint: ON | Block critical: ON" }]);
        } else {
          const cfg = agent.getSafetyConfig();
          setEntries((c) => [...c,
            { role: "user", text: line },
            { role: "system", text: [
              `Safety: ${cfg.enabled ? "ON" : "OFF"} | Auto-checkpoint: ${cfg.autoCheckpoint ? "ON" : "OFF"} | Block critical: ${cfg.blockCritical ? "ON" : "OFF"}`,
              "",
              "Commands:",
              "  /safety on   - enable all safety guards",
              "  /safety off  - disable all safety guards",
              "",
              "High-risk shell commands (rm, git reset, docker rm, etc.) are blocked and require explicit confirmation.",
              "Critical commands (rm -rf /, mkfs, fork bombs, etc.) are always blocked when blockCritical is on.",
            ].join("\n") },
          ]);
        }
        return;
      }

        setEntries((c) => [...c, { role: "user", text: line }, { role: "system", text: `Unknown command: ${line}\nType /help for commands or /skills for skills.` }]);
        return;
      }

      // ── normal message (smart routing) ──
      if (!skipRender) setEntries((c) => [...c, { role: "user", text: line }]);
      busyRef.current = true;
      setIsBusy(true);

      try {
        // Inject completed spawn results into the prompt
        let enrichedLine = line;
        if (spawnResultsRef.current.length > 0) {
          const spawnContext = spawnResultsRef.current.join("\n\n");
          spawnResultsRef.current = [];
          enrichedLine = `${line}\n\n[Completed sub-agent work — incorporate if relevant]\n${spawnContext}`;
        }

        const hasMulti = agent.getMulti().getRegistered().length > 1;
        const route = routeMessage(line, mode === "team", hasMulti);

        if (route.mode === "auto") {
          setThinkMsg(`auto: ${route.reason}`);
          const auto = new AutoAgent(options.cwd, (p) => agent.runTurn(p), (step) => {
            const icon = step.status === "running" ? "◉" : step.status === "success" ? "✓" : "✗";
            setThinkMsg(`${icon} ${step.description}`);
          });
          const result = await auto.run(enrichedLine);
          setTurnCount((c) => c + 1);
          const output = result.steps
            .filter((s) => s.action === "done" && s.result)
            .map((s) => s.result).join("\n") || result.summary;
          setEntries((c) => [...c, { role: "assistant", text: `[auto: ${result.success ? "DONE" : "INCOMPLETE"} ${(result.totalMs / 1000).toFixed(1)}s]\n${output}` }]);
        } else if (route.mode === "pipe") {
          setThinkMsg(`pipe: ${route.command}`);
          const pipe = new PipeAgent(options.cwd, (p) => agent.runTurn(p), (msg) => setThinkMsg(msg));
          const result = route.subMode === "fix" ? await pipe.fix(route.command) : await pipe.analyze(route.command);
          setTurnCount((c) => c + 1);
          const header = result.fixed ? `FIXED (${result.iterations}x)` : result.mode === "analyze" ? "Analyzed" : `${result.iterations}x, not fixed`;
          setEntries((c) => [...c, { role: "assistant", text: `[pipe: ${header} ${(result.totalMs / 1000).toFixed(1)}s]\n${result.analysis}` }]);
        } else if (route.mode === "skill") {
          const skills = await loadSkills(options.cwd);
          const skill = skills.find((s) => s.name === route.skillName);
          if (skill && !skill.disableModelInvocation) {
            setThinkMsg(`skill: /${route.skillName}`);
            const fullPrompt = await renderSkill(skill, route.context, options.cwd);
            const result = await agent.runTurn(fullPrompt);
            setTurnCount((c) => c + 1);
            setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty)" }]);
          } else {
            // Skill not found, fall through to solo
            setThinkMsg(randomCatMood());
            const result = await agent.runTurn(enrichedLine);
            setTurnCount((c) => c + 1);
            setEntries((c) => [...c, { role: "assistant", text: result.text || "(empty)" }]);
          }
        } else if (route.mode === "team" && agent.getTeam().isReady()) {
          let currentPhaseId: string | null = null;
          const result = await agent.getTeam().run(enrichedLine, (phase, provider, mdl) => {
            if (currentPhaseId) agent.activityLog.finish(currentPhaseId);
            currentPhaseId = agent.activityLog.start("agent", `${phase}`, `${provider}/${mdl}`);
            setThinkMsg(`${phase} (${provider}/${mdl})...`);
          });
          if (currentPhaseId) agent.activityLog.finish(currentPhaseId);
          const output = result.phases.map((p) =>
            `--- ${p.role.toUpperCase()} (${p.provider}/${p.model}, ${p.ms}ms) ---\n${p.text}`
          ).join("\n\n") + `\n\nTotal: ${result.totalMs}ms`;
          setTurnCount((c) => c + 1);
          setEntries((c) => [...c, { role: "assistant", text: output }]);
        } else {
          // Solo mode — stream response in real-time
          setThinkMsg(randomCatMood());
          setStreamingText("");
          const toolLines: string[] = [];
          let lastToolKey = "";
          const turnStart = Date.now();
          const result = await agent.runTurn(
            enrichedLine,
            (chunk) => {
              const prefix = toolLines.length > 0 ? toolLines.map((t) => `● ${t.split("\n")[0]}${t.includes("\n") ? "\n" + t.split("\n").slice(1).join("\n") : ""}`).join("\n") + "\n\n" : "";
              setStreamingText((prev) => {
                // If prev only has tool lines, start fresh with prefix + chunk
                if (!prev.includes("\n\n")) return prefix + chunk;
                return prev + chunk;
              });
            },
            (status) => {
              const firstLine = status.split("\n")[0];
              setThinkMsg(firstLine);
              if (status.startsWith("tool: ")) {
                const full = status.slice(6);
                const label = firstLine.slice(6);
                // Status with timing = completed tool; update last entry with result info
                if (/\(\d+\.\d+s\)/.test(label)) {
                  const resultPart = full.includes("\n") ? "\n" + full.split("\n").slice(1).join("\n") : "";
                  if (toolLines.length > 0) toolLines[toolLines.length - 1] = label + resultPart;
                } else {
                  // New tool starting — deduplicate consecutive same tool
                  const key = label.replace(/\s+$/, "");
                  if (key === lastToolKey && toolLines.length > 0) {
                    const prev = toolLines[toolLines.length - 1];
                    const match = prev.match(/\s×(\d+)$/);
                    const count = match ? parseInt(match[1], 10) + 1 : 2;
                    toolLines[toolLines.length - 1] = `${key} ×${count}`;
                  } else {
                    // Include diff lines if present
                    const diffPart = full.includes("\n") ? "\n" + full.split("\n").slice(1).join("\n") : "";
                    toolLines.push(label + diffPart);
                  }
                  lastToolKey = key;
                }
                setStreamingText(toolLines.map((t) => `● ${t.split("\n")[0]}${t.includes("\n") ? "\n" + t.split("\n").slice(1).join("\n") : ""}`).join("\n") + "\n");
              }
            },
          );
          setStreamingText("");
          setTurnCount((c) => c + 1);
          const turnElapsed = ((Date.now() - turnStart) / 1000);
          const thinkLine = turnElapsed >= 1 ? `✻ Cogitated for ${turnElapsed >= 60 ? `${Math.floor(turnElapsed / 60)}m ${Math.round(turnElapsed % 60)}s` : `${turnElapsed.toFixed(1)}s`}\n\n` : "";
          const toolSummary = toolLines.length > 0
            ? toolLines.map((t) => `● ${t.split("\n")[0]}${t.includes("\n") ? "\n" + t.split("\n").slice(1).join("\n") : ""}`).join("\n") + "\n\n" + thinkLine
            : thinkLine;
          setEntries((c) => [...c, { role: "assistant", text: toolSummary + (result.text || "(empty response)") }]);
          const stopResult = await agent.runStopHook();
          if (stopResult.blocked && stopResult.reason) {
            setEntries(c => [...c, { role: "system", text: `Hook feedback: ${stopResult.reason}` }]);
          }
        }

        // Auto-compact when conversation gets long
        if (agent.shouldAutoCompact()) {
          setThinkMsg("Auto-compacting...");
          const compactResult = await agent.compact().catch(() => null);
          if (compactResult) {
            setEntries((c) => [...c, { role: "system", text: `Auto-compacted: ${compactResult.droppedCount} messages summarized.` }]);
          }
        }
      } catch (error) {
        setEntries((c) => [...c, { role: "system", text: error instanceof Error ? error.message : String(error) }]);
      } finally {
        busyRef.current = false;
        setIsBusy(false);
        // Move pending messages to entries, then process as one merged turn
        if (pendingRef.current.length > 0) {
          const queued = pendingRef.current.slice();
          const merged = queued.join("\n").trim();
          pendingRef.current = [];
          setPendingDisplay([]);
          if (merged) {
            setEntries((c) => [...c, ...queued.map((q) => ({ role: "user" as const, text: q }))]);
            await submit(merged, true);
          }
        }
      }
    },
    [agent, exit, isBusy, entries, turnCount, options, mcpMode, mcpServers, mcpCursor, mcpAddName, mcpAddCmd, mode, teamPanel, teamEditRole, settingsPanel, settingsProvider, settingsCursor, modelPanel, modelPanelProvider, modelPanelModels, modelCursor, providerVersion, statusPanel],
  );

  const providerLabel = PROVIDER_LABELS[agent.getActiveProvider()] ?? agent.getActiveProvider();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginTop={1} borderStyle="round" borderColor="#d97757" flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          <Text color="#ff9c73" bold>{"  /\\_/\\   Paw v1.0"}</Text>
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
        <Box flexDirection="column">
          <Box>
            <Text color="#ff9c73" bold>{"=^.^= "}</Text>
            <Text color="gray" italic>{thinkMsg}</Text>
          </Box>
          {streamingText ? (
            <Box marginLeft={2} flexDirection="column">
              <Text color="#ffe0cc" wrap="wrap">{streamingText}</Text>
            </Box>
          ) : null}
          <Text color="gray" italic>  Ctrl+C or Esc to cancel</Text>
        </Box>
      ) : null}

      {pendingDisplay.length > 0 && (
        <Box flexDirection="column">
          {pendingDisplay.map((msg, i) => (
            <Box key={`pending-${i}`} marginBottom={1}>
              <Text color="#ffb088" bold>{"▸ "}</Text>
              <Text color="gray">{msg}</Text>
            </Box>
          ))}
        </Box>
      )}

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

      {spawnPanel !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Spawn Agent</Text>
          {spawnPanelProvider ? (
            <Text color="gray">Provider: <Text bold color="white">{spawnPanelProvider}</Text>
            {spawnPanelModel ? <Text> / <Text bold color="white">{spawnPanelModel}</Text></Text> : null}</Text>
          ) : null}

          {spawnPanel === "providers" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select provider:</Text>
              {agent.getMulti().getRegistered().map((p, i) => (
                <Box key={p.name}>
                  <Text color={i === spawnCursor ? "#ff9c73" : "gray"} bold={i === spawnCursor}>
                    {i === spawnCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === spawnCursor ? "#ff9c73" : "#ffb088"}>{p.name}</Text>
                  <Text color="gray"> — {p.model}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc cancel"}</Text>
            </Box>
          ) : null}

          {spawnPanel === "models" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select model for <Text bold color="#ffb088">{spawnPanelProvider}</Text>:</Text>
              {spawnPanelModels.map((m, i) => (
                <Box key={m.id}>
                  <Text color={i === spawnCursor ? "#ff9c73" : "gray"} bold={i === spawnCursor}>
                    {i === spawnCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === spawnCursor ? "#ff9c73" : "gray"}>{m.id}</Text>
                  <Text color="gray"> — {m.name}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {spawnPanel === "task" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Enter task for <Text bold color="#ffb088">{spawnPanelProvider}/{spawnPanelModel}</Text>:</Text>
              <Box marginTop={1}>
                <Text color="#ff9c73" bold>{"> "}</Text>
                <Text>{spawnTaskInput}<Text color="gray">_</Text></Text>
              </Box>
              <Text color="gray" italic>{"\n  Enter spawn  Esc back"}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {verifyPanel !== "off" ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Verify Settings</Text>
          <Text color="gray">Status: <Text bold color="white">{agent.isVerifyEnabled() ? "ON" : "OFF"}</Text>
          {" "}Reviewer: <Text bold color="white">{agent.getVerifyProvider() ? `${agent.getVerifyProvider()}${agent.verifier.getModel() ? `/${agent.verifier.getModel()}` : ""}` : "auto"}</Text></Text>

          {verifyPanel === "menu" ? (
            <Box flexDirection="column" marginTop={1}>
              {["Toggle ON/OFF", "Select reviewer provider", "Auto (use different provider)"].map((item, i) => (
                <Box key={item}>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"} bold={i === verifyCursor}>
                    {i === verifyCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === verifyCursor ? "#ff9c73" : "#ffb088"}>{item}</Text>
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {verifyPanel === "providers" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select reviewer provider:</Text>
              {agent.getMulti().getRegistered().map((p, i) => (
                <Box key={p.name}>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"} bold={i === verifyCursor}>
                    {i === verifyCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === verifyCursor ? "#ff9c73" : "#ffb088"}>{p.name}</Text>
                  <Text color="gray"> — {p.model}</Text>
                  {p.name === agent.getVerifyProvider() ? <Text color="green"> (reviewer)</Text> : null}
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {verifyPanel === "models" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select model for <Text bold color="#ffb088">{verifyPanelProvider}</Text>:</Text>
              {verifyPanelModels.map((m, i) => (
                <Box key={m.id}>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"} bold={i === verifyCursor}>
                    {i === verifyCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"}>{m.id}</Text>
                  <Text color="gray"> — {m.name}</Text>
                  {m.id === agent.verifier.getModel() ? <Text color="green"> *</Text> : null}
                </Box>
              ))}
              <Text color="gray" italic>{"\n  ↑↓ navigate  Enter select  Esc back"}</Text>
            </Box>
          ) : null}

          {verifyPanel === "effort" ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" italic>Select effort level for <Text bold color="#ffb088">{verifyPanelProvider}/{agent.verifier.getModel()}</Text>:</Text>
              {(["Low — Fast, lighter reasoning", "Medium — Balanced (default)", "High — Complex problems", "Extra High — Maximum depth"] as const).map((label, i) => (
                <Box key={label}>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"} bold={i === verifyCursor}>
                    {i === verifyCursor ? " > " : "   "}
                  </Text>
                  <Text color={i === verifyCursor ? "#ff9c73" : "gray"}>{label}</Text>
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
              <Text color="#ffb088" bold>{"  Roles"}</Text>
              {agent.getTeam().getRoles().map((r) => {
                const b = agent.tracker.getBreakdown().find((x) => x.provider === r.provider);
                return (
                  <Box key={r.role} flexDirection="column">
                    <Box>
                      <Text color="#ff9c73" bold>{`  ${r.role.padEnd(10)}`}</Text>
                      <Text color="#ffb088">{r.provider}</Text>
                      <Text color="gray">/{r.model}</Text>
                    </Box>
                    <Text color="gray" dimColor>{"              "}{b ? `${b.requests}r  ${formatTokens(b.totalTokens)} tok` : "no usage"}</Text>
                  </Box>
                );
              })}
              <Box marginTop={1} flexDirection="column">
                <Text color="#ffb088" bold>{"  Pipeline"}</Text>
                <Text color="gray">{"  Plan → Code → [Review+Test] → Optimize"}</Text>
                <Text color="gray" dimColor>{"  MAJOR → auto-rework (max 3x)"}</Text>
              </Box>
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

      {suggestions.length > 0 && mcpMode === "off" ? (() => {
        const maxVisible = 5;
        const half = Math.floor(maxVisible / 2);
        let start = Math.max(0, selectedIdx - half);
        let end = start + maxVisible;
        if (end > suggestions.length) { end = suggestions.length; start = Math.max(0, end - maxVisible); }
        const visible = suggestions.slice(start, end);
        return (
          <Box flexDirection="column" paddingX={2} marginBottom={0}>
            {start > 0 ? <Text color="gray">{`   ↑ ${start} more`}</Text> : null}
            {visible.map((cmd, vi) => {
              const i = start + vi;
              return (
                <Box key={cmd.name}>
                  <Text color={i === selectedIdx ? "#ff9c73" : "gray"} bold={i === selectedIdx}>
                    {i === selectedIdx ? " > " : "   "}
                  </Text>
                  <Text color={i === selectedIdx ? "#ff9c73" : "gray"} bold={i === selectedIdx}>
                    {cmd.name}
                  </Text>
                  <Text color="gray"> — {cmd.desc}</Text>
                </Box>
              );
            })}
            {end < suggestions.length ? <Text color="gray">{`   ↓ ${suggestions.length - end} more`}</Text> : null}
            <Text color="gray" italic>  Tab to complete | arrows to navigate</Text>
          </Box>
        );
      })() : null}

      {statusPanel ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d97757" paddingX={2} paddingY={1} marginBottom={1}>
          <Text color="#ff9c73" bold>Paw v1.0.0</Text>
          <Text color="gray">Mode: <Text bold color={mode === "team" ? "#ff9c73" : "white"}>{mode.toUpperCase()}</Text></Text>
          <Text color="gray">Active: <Text bold color="white">{agent.getActiveProvider()}/{agent.getActiveModel()}</Text></Text>

          <Box marginTop={1} flexDirection="column">
            <Text color="#ffb088" bold>Providers</Text>
            {agent.getMulti().getRegistered().map((p) => {
              const b = agent.tracker.getBreakdown().find((x) => x.provider === p.name);
              return (
                <Box key={p.name}>
                  <Text color={p.name === agent.getActiveProvider() ? "#ff9c73" : "gray"}>
                    {p.name === agent.getActiveProvider() ? "  * " : "    "}
                  </Text>
                  <Text color={p.name === agent.getActiveProvider() ? "#ff9c73" : "#ffb088"}>{p.name}</Text>
                  <Text color="gray"> — {p.model}</Text>
                  {b ? <Text color="gray"> ({b.requests}r, {formatTokens(b.totalTokens)} tok{b.estimatedCost > 0 ? `, $${b.estimatedCost.toFixed(4)}` : ""})</Text> : null}
                </Box>
              );
            })}
          </Box>

          {mode === "team" ? (
            <Box marginTop={1} flexDirection="column">
              <Text color="#ffb088" bold>Team</Text>
              {agent.getTeam().getRoles().map((r) => (
                <Box key={r.role}>
                  <Text color="gray">{"    "}</Text>
                  <Text color="#cc8866">{r.role.padEnd(10)}</Text>
                  <Text color="gray">{r.provider}/{r.model}</Text>
                </Box>
              ))}
            </Box>
          ) : null}

          <Box marginTop={1} flexDirection="column">
            <Text color="#ffb088" bold>Usage</Text>
            {agent.tracker.getBreakdown().length === 0 ? (
              <Text color="gray">{"    No usage yet"}</Text>
            ) : (
              agent.tracker.getBreakdown().map((b) => (
                <Box key={b.key}>
                  <Text color="gray">{"    "}{b.key}: </Text>
                  <Text color="white">{formatTokens(b.inputTokens)} in / {formatTokens(b.outputTokens)} out</Text>
                  <Text color="gray"> / {b.requests} req</Text>
                  {b.estimatedCost > 0 ? <Text color="yellow"> ~${b.estimatedCost.toFixed(4)}</Text> : <Text color="green"> (free)</Text>}
                </Box>
              ))
            )}
            {agent.tracker.getBreakdown().length > 0 ? (
              <Box>
                <Text color="gray">{"    Total: "}</Text>
                <Text color="white">{formatTokens(agent.tracker.getTotal().totalTokens)} tok</Text>
                {agent.tracker.getTotal().estimatedCost > 0 ? <Text color="yellow"> ~${agent.tracker.getTotal().estimatedCost.toFixed(4)}</Text> : null}
              </Box>
            ) : null}
          </Box>

          <Box marginTop={1}>
            <Text color="gray">MCP: {agent.getMcpStatus().length > 0 ? `${agent.getMcpStatus().length} server(s)` : "off"}</Text>
          </Box>
          <Text color="gray" italic>{"  Esc to close"}</Text>
        </Box>
      ) : null}

      <Box borderStyle="round" borderColor="#d97757" paddingX={1}>
        <Text color="#ff9c73" bold>{" > "}</Text>
        <Text>{[...input].slice(0, cursorPos).join("")}</Text><Text color="#ff9c73">█</Text><Text>{[...input].slice(cursorPos).join("")}</Text>
      </Box>

      <Box marginTop={0} paddingX={1} justifyContent="space-between">
        <Text color={mode === "team" ? "#ff9c73" : "gray"}>{mode === "team" ? "TEAM" : providerLabel}/{agent.getActiveModel()}</Text>
        <Text color="gray">{(() => {
          const breakdown = agent.tracker.getBreakdown();
          if (breakdown.length === 0) return `reqs: 0`;
          return breakdown.map((b) => {
            const cost = b.estimatedCost > 0 ? ` $${b.estimatedCost.toFixed(3)}` : "";
            const tok = b.totalTokens > 0 ? ` ${formatTokens(b.totalTokens)}` : "";
            return `${b.provider}:${b.requests}r${tok}${cost}`;
          }).join("  ");
        })()}</Text>
        <Text color={agent.getMcpStatus().length > 0 ? "green" : "gray"}>
          mcp: {agent.getMcpStatus().length > 0 ? `${agent.getMcpStatus().length} server(s)` : "off"}
        </Text>
      </Box>

      {/* Interactive prompt panel */}
      {activePrompt ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#cc6633" paddingX={2} paddingY={1}>
          <Text color="#ff6633" bold>{activePrompt.title}</Text>
          <Text color="gray">{activePrompt.message}</Text>
          {activePrompt.detail ? <Text color="#ffaa66" wrap="truncate-end">  {activePrompt.detail.slice(0, 120)}</Text> : null}
          <Box flexDirection="column" marginTop={1}>
            {activePrompt.choices.map((choice, i) => (
              <Text key={i} color={i === promptCursor ? "#ff9c73" : "gray"} bold={i === promptCursor}>
                {i === promptCursor ? " > " : "   "}{i + 1}. {choice.label}
              </Text>
            ))}
          </Box>
          {promptCustomMode ? (
            <Box marginTop={1}>
              <Text color="#ffaa66">{"  > "}</Text>
              <Text color="white">{promptCustomInput}<Text color="#ff9c73">▌</Text></Text>
            </Box>
          ) : null}
          <Text color="gray" italic>  ↑↓/1-{activePrompt.choices.length} select  Enter confirm  Esc cancel</Text>
        </Box>
      ) : null}

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

      {!activityView && turnCount > 0 ? (() => {
        const running = agent.activityLog.getRunning();
        if (running.length === 0) return null;
        return (
          <Box flexDirection="column" paddingX={2}>
            {running.map((act) => (
              <Box key={act.id} flexDirection="row">
                <Text color="yellow">{"  ◉ "}</Text>
                <Text color="gray">{act.name}...</Text>
              </Box>
            ))}
          </Box>
        );
      })() : null}
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
  agent.loadMemoryContext().catch(() => {});
  agent.getHooks().run("session-start", { source: "startup" }).catch(() => []);
  cursorManager.install();
  const ttyStdin = openTtyStdin();
  const instance = render(<App agent={agent} options={options} />, {
    ...(ttyStdin ? { stdin: ttyStdin } : {}),
  });
  await instance.waitUntilExit();
  ttyStdin?.destroy();
  cursorManager.uninstall();
  agent.getHooks().run("session-end", { source: "exit" }).catch(() => []);
}
