# Paw 🐱

```
  /\_/\   Paw
 ( o.o )  Too lazy to pick one AI. So I use them all.
  > ^ <
```

Multi-provider AI coding agent that runs Anthropic, OpenAI, and local models from a single CLI — with automatic fallback, parallel sub-agents, and built-in safety.

![Paw Terminal](assets/screenshot.png)

> **Disclaimer:** Paw is an independent, third-party project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI or any AI provider.

---

## Why Paw

80+ AI coding tools exist. Most lock you into one model. Paw doesn't pick sides — it uses them all, catches their mistakes, and keeps you safe.

### 1. Multi-Provider, Zero Lock-in

Use **Anthropic, Codex (OpenAI), and Ollama** simultaneously. Rate limit on Claude? Auto-switches to Codex. Need free local inference? Ollama is always there.

```
Provider Call → Success → Response
      │
      └─ Error (429/quota) → Next Provider → ... → Ollama (free, last resort)
```

### 2. Parallel Sub-Agents (`/spawn`)

Don't wait. Spawn independent agents that work **in parallel** — even while the main AI is thinking.

```
you  explain the architecture        ← main AI starts working
you  /spawn add tests for auth       ← runs immediately in background
you  /spawn update README            ← another agent, different provider
you  /tasks                          ← check progress anytime
```

Choose provider and model via ↑↓ panel (`/spawn`) or inline (`/spawn codex/gpt-5.4 fix lint`).

### 3. Trust Layer (`/verify`)

AI code has [1.7x more issues](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) than human code. Paw sends every change to a **different AI for review** — automatically.

```
---
Verification (by ollama/llama3):
  Confidence: 85/100
  warning: src/auth.ts — Potential SQL injection in query builder
---
```

### 4. Agent Safety (`/safety`)

Every tool call is risk-classified. Destructive commands are **blocked before they execute**.

```
[LOW]  read_file, search_text     → runs immediately
[HIGH] rm, terraform destroy      → blocked + git stash checkpoint
[CRIT] rm -rf /, mkfs, curl|sh   → permanently blocked
```

### 5. Cross-Session Memory (`PAW.md`)

Paw remembers across sessions. Project instructions, coding standards, and learned context persist automatically.

```
~/.paw/PAW.md          → global instructions (all projects)
./PAW.md               → project instructions (shared with team)
./PAW.local.md         → personal notes (git-ignored)
~/.paw/memory/         → auto-learned context
```

### 6. Extensible: Skills + Hooks

**Skills** — custom `/commands` with `$ARGUMENTS`, `` !`command` `` injection, and `SKILL.md` directories.
**Hooks** — 10 lifecycle events, regex matchers, JSON stdin, exit 2 = block.

---

## Features

| Category | Features |
|----------|----------|
| **Providers** | Anthropic, Codex (OpenAI), Ollama (local) — auto-detect, auto-fallback |
| **Agent Modes** | Solo, Team (5-agent pipeline), `/auto` (autonomous), `/spawn` (parallel sub-agents) |
| **Trust & Safety** | `/verify` (cross-provider review), `/safety` (risk classification + blocking) |
| **Memory** | `PAW.md` hierarchy, `/memory`, `/remember`, auto-learned context |
| **Extensibility** | Skills ($ARGUMENTS, !`cmd`, SKILL.md), Hooks (10 events, matchers, JSON stdin, blocking) |
| **Developer UX** | Arrow-key UI, message queue, session sync, Smart Router (EN/KO/JA/ZH), MCP support |

---

## Quick Start

```bash
npm install -g paw                     # Install globally

paw                                    # Auto-detect providers and start
paw "explain this project"             # Direct prompt
paw --continue                         # Resume last session
paw --provider codex                   # Force specific provider
```

**Requirements:** Node.js 22+, at least one of: Anthropic API key, Codex CLI, or Ollama.

---

## Providers

| Provider | Auth | How it works |
|----------|------|-------------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude models, best reasoning, per-token pricing |
| **Codex** | `codex login` | Codex CLI with ChatGPT subscription, effort levels |
| **Ollama** | (none) | Local models, free, auto-detected |

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...     # in .env or /settings

# Codex
npm install -g @openai/codex && codex login

# Ollama
ollama pull qwen3
```

**Coming soon:** Gemini, Groq, OpenRouter.

---

## Agent Modes

### Solo (default)

Single provider handles all messages. Switch models with `/model`.

### Team (`/team`)

5 agents collaborate on every message:

| Role | Job | Runs |
|------|-----|------|
| Planner | Architecture & plan | Sequential |
| Coder | Implementation | Sequential |
| Reviewer | Bugs, security | **Parallel** |
| Tester | Test cases | **Parallel** |
| Optimizer | Performance | Sequential |

Roles auto-assigned by efficiency scores. Adapts from real usage after 3+ runs per role.

### `/auto` — Autonomous Agent

Self-driving agent: plan → execute → verify → fix, until done.

```
/auto add input validation to all API endpoints

◉ Analyzing project...
✓ Creating plan...
◉ Executing step 1/10...
◉ Verifying...
✗ Build error found
◉ Fixing errors...
✓ All checks passed
✓ COMPLETED (32.4s)
```

### `/spawn` — Parallel Sub-Agents

Spawn independent agents that work in parallel. Works even while AI is thinking.

**Interactive (↑↓ panel):**

```
/spawn
╭─ Spawn Agent ──────────────────────────╮
│ Select provider:                        │
│  > anthropic — claude-sonnet-4-6       │
│    codex — gpt-5.4                     │
│    ollama — llama3                     │
╰────────────────────────────────────────╯
         ↓ Enter → Select model → Enter task
```

**Inline (fast):**

```
/spawn add tests for auth               ← round-robin provider
/spawn codex/gpt-5.4 update README      ← specific provider + model
```

**Manage:**

```
/tasks              → status of all spawned agents
/tasks results      → completed results
/tasks clear        → remove completed tasks
```

### `/pipe` — Shell Output → AI

```
/pipe npm test              → AI analyzes test failures
/pipe fix npm run build     → AI fixes errors, re-runs until clean
/pipe watch npm start       → AI monitors startup output
```

### Smart Router

Just type naturally — Paw auto-routes to the best mode:

| You type | Routed to |
|----------|-----------|
| `npm test` | `/pipe` |
| `implement JWT auth` | `/auto` |
| `review this code` | `/review` skill |
| `이 코드 리뷰해줘` | `/review` skill |

Supports: English, Korean, Japanese, Chinese.

---

## Trust & Safety

### `/verify` — Cross-Provider Code Verification

AI generates → different AI reviews. Choose reviewer via ↑↓ panel (provider/model/effort).

```
/verify
╭─ Verify Settings ──────────────────────╮
│ Status: OFF  Reviewer: auto            │
│  > Toggle ON/OFF                       │
│    Select reviewer provider            │
│    Auto (use different provider)       │
╰────────────────────────────────────────╯
```

When enabled, every file change triggers a verification pass:

```
---
Verification (by codex/gpt-5.4):
  Confidence: 85/100
  warning: src/auth.ts — Potential SQL injection
  info: src/routes.ts — Consider rate limiting
---
```

Checks: N+1 queries, race conditions, security vulnerabilities, logic errors, missing error handling.

### `/safety` — Agent Safety Guards

| Level | Tools | Action |
|-------|-------|--------|
| **Low** | `list_files`, `read_file`, `glob`, `search_text`, `web_fetch` | Execute immediately |
| **Medium** | `write_file`, `edit_file`, benign shell commands | Execute immediately |
| **High** | `rm`, `git reset`, `docker rm`, `terraform destroy`, `kubectl delete`... | Blocked + git checkpoint |
| **Critical** | `rm -rf /`, `mkfs`, fork bombs, `curl\|sh`... | Permanently blocked |

### Security Hardening

- 25+ dangerous shell patterns blocked
- Symlink traversal protection (realpath)
- SSRF blocked (private IPs, metadata endpoints)
- Shell injection prevented (execFile, not shell)
- MCP env allowlist (API keys not leaked)
- Credentials mode 0600
- ReDoS-safe glob conversion

---

## Memory

Paw remembers across sessions using a `PAW.md` hierarchy:

| File | Scope | Shared |
|------|-------|--------|
| `~/.paw/PAW.md` | All projects | No (local to machine) |
| `./PAW.md` or `.paw/PAW.md` | This project | Yes (commit to repo) |
| `./PAW.local.md` | This project | No (git-ignored) |
| `~/.paw/memory/` | Auto-learned context | No (auto-managed) |

Memory is injected into the first prompt of each session.

```
/memory             → view loaded memory sources
/remember <note>    → save a note across sessions
```

---

## Skills

7 built-in + unlimited custom skills with `$ARGUMENTS`, `` !`command` `` injection, and directory-based `SKILL.md`.

### Built-in

| Skill | Description |
|-------|-------------|
| `/review` | Bugs, security, best practices |
| `/refactor` | Refactoring improvements |
| `/test` | Generate test cases |
| `/explain` | Explain code in detail |
| `/optimize` | Performance optimization |
| `/document` | Generate documentation |
| `/commit` | Conventional commit from git diff |

### Custom Skills

**Flat file** — `.paw/skills/deploy.md`:

```yaml
---
name: deploy
description: Deploy the application
argument-hint: [environment]
disable-model-invocation: true
---

Deploy $ARGUMENTS to production:
1. Run the test suite
2. Build the application
3. Push to the deployment target
```

**Directory-based** — `.paw/skills/explain-code/SKILL.md`:

```
explain-code/
├── SKILL.md           # Main instructions (required)
├── template.md        # Supporting file
└── scripts/
    └── visualize.py   # Script Paw can run
```

### Dynamic Features

- `$ARGUMENTS` / `$0`, `$1`, `$2` — argument substitution
- `` !`git branch --show-current` `` — dynamic command injection
- `${CLAUDE_SKILL_DIR}` — skill directory path

### Frontmatter

| Field | Description |
|-------|-------------|
| `name` | `/name` command |
| `description` | When to use (shown in autocomplete) |
| `argument-hint` | Hint in autocomplete (e.g. `[env]`) |
| `disable-model-invocation` | `true` = user-only |
| `user-invocable` | `false` = hidden from `/` menu |
| `allowed-tools` | Auto-approved tools |
| `context` | `fork` = run in subagent |

---

## Hooks

10 lifecycle events. Regex matchers. JSON stdin. Exit 2 = block.

### Events

| Event | When | Matcher |
|-------|------|---------|
| `pre-turn` | Before sending to model | — |
| `post-turn` | After model responds | — |
| `pre-tool` | Before tool execution (can block) | Tool name |
| `post-tool` | After tool succeeds | Tool name |
| `post-tool-failure` | After tool fails | Tool name |
| `on-error` | When any error occurs | — |
| `session-start` | REPL starts | Source |
| `session-end` | REPL ends | Source |
| `stop` | AI finishes responding (can block to continue) | — |
| `notification` | Notification sent | — |

### Configuration

**Markdown** — `.paw/hooks/lint.md`:

```yaml
---
event: post-tool
command: npm run lint --silent
name: auto-lint
---
```

**JSON** — `.paw/settings.json`:

```json
{
  "hooks": {
    "post-tool": [{
      "matcher": "edit_file|write_file",
      "hooks": [{ "type": "command", "command": "npx prettier --write $(jq -r '.tool_input.path')" }]
    }]
  }
}
```

### How Hooks Work

- Hooks receive full event data as JSON via stdin
- Exit 0 = proceed (stdout injected into AI context)
- Exit 2 = block (stderr sent as feedback to AI)
- Environment: `PAW_EVENT`, `PAW_CWD`, `PAW_TOOL_NAME`
- All matching hooks run in parallel

---

## Sessions

Auto-save. Real-time sync across terminals. Resume anytime.

```bash
paw                          # New session
paw --continue               # Resume last
paw --session abc123         # Join specific session
```

Two terminals with the same session ID see messages in real-time (fs.watch, 50ms debounce).

---

## Tools & MCP

### 8 Built-in Tools

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories |
| `read_file` | Read text file (512KB guard) |
| `write_file` | Create or overwrite file |
| `edit_file` | Replace unique string |
| `search_text` | Search patterns (no injection) |
| `run_shell` | Shell commands (dangerous blocked) |
| `glob` | Find files by pattern (ReDoS-safe) |
| `web_fetch` | Fetch URL (SSRF-protected) |

### MCP (Model Context Protocol)

```bash
paw mcp add --transport http github https://api.github.com/mcp
paw mcp add --transport stdio memory -- npx -y @modelcontextprotocol/server-memory
paw mcp list
```

Interactive manager via `/mcp`. Supports stdio, HTTP, SSE.

---

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Providers, usage, cost |
| `/settings` | Provider management (↑↓) |
| `/model` | Model catalog & switch (↑↓) |
| `/team` | Team dashboard (↑↓) |
| `/spawn` | Spawn parallel sub-agent (↑↓) |
| `/tasks` | Spawned agent status/results/clear |
| `/auto <task>` | Autonomous agent mode |
| `/pipe <cmd>` | Shell output → AI (fix/watch) |
| `/verify` | Verify settings (↑↓) |
| `/safety` | Safety guards (on/off) |
| `/memory` | View loaded memory sources |
| `/remember` | Save note across sessions |
| `/skills` | List all skills |
| `/hooks` | List configured hooks |
| `/ask <provider> <prompt>` | Query specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager (↑↓) |
| `/git` | Status + diff + log |
| `/sessions` | List past sessions |
| `/history` | Export chat to markdown |
| `/compact` | Compress conversation |
| `/init` | Generate CONTEXT.md |
| `/doctor` | Diagnostics |
| `/clear` | Reset conversation |
| `/exit` | Quit |

### Keyboard

| Key | Action |
|-----|--------|
| `↑↓` | Navigate menus |
| `Enter` | Select / execute |
| `Tab` | Autocomplete (fill only) |
| `Esc` | Go back / quit |
| `Ctrl+L` | Clear conversation |
| `Ctrl+K` | Compact conversation |

---

## Files

| File | Purpose |
|------|---------|
| `~/.paw/credentials.json` | API keys (0600) |
| `~/.paw/sessions/*.json` | Session history (0600) |
| `~/.paw/team-scores.json` | Team performance |
| `~/.paw/PAW.md` | Global instructions |
| `~/.paw/memory/` | Auto-learned memory |
| `~/.paw/skills/*.md` | User-wide skills |
| `~/.paw/hooks/*.md` | User-wide hooks |
| `PAW.md` | Project instructions |
| `PAW.local.md` | Personal project notes |
| `.paw/skills/*.md` | Project skills |
| `.paw/hooks/*.md` | Project hooks |
| `.paw/settings.json` | Project settings (hooks, etc.) |
| `.mcp.json` | MCP server config |

---

## Changelog

1. **Initial release** — Multi-provider REPL with Ink UI, 8 tools, cat theme
2. **MCP support** — stdio/HTTP/SSE transport, interactive manager
3. **Team mode** — 5-agent pipeline with parallel review+test
4. **Auto-detect** — Codex login, no startup prompt needed
5. **Arrow-key UI** — All panels: ↑↓ + Enter + Esc
6. **Plan-aware models** — Subscription filtering, live Ollama detection
7. **Codex provider** — ChatGPT subscription via CLI
8. **Effort levels** — Per model and per team role
9. **Sessions** — Auto-save, resume, real-time sync
10. **Korean IME** — Native CJK input handling
11. **Security audit** — 14 vulnerabilities fixed
12. **`paw` CLI** — 3-character global command
13. **Skills** — 7 built-in + custom skills via Markdown
14. **Hooks** — Event-driven automation, 7 lifecycle events
15. **Anthropic provider** — API key mode with per-token pricing
16. **`/auto`** — Autonomous plan→execute→verify→fix loop
17. **`/pipe`** — Shell output → AI analysis/fix/watch
18. **Smart Router** — Auto-detect mode from message (multilingual)
19. **Trust Layer** — `/verify` cross-provider verification (↑↓ provider/model/effort)
20. **Agent Safety** — `/safety` 4-tier risk classification + auto git checkpoint
21. **Skills upgrade** — SKILL.md directories, $ARGUMENTS, !`command` injection
22. **Hooks upgrade** — Matchers, JSON stdin, exit code blocking, settings.json, 10 events
23. **`/spawn`** — Parallel sub-agents with ↑↓ provider/model selection
24. **`/tasks`** — Monitor and manage spawned agents
25. **Memory** — Cross-session PAW.md hierarchy, `/memory`, `/remember`, auto-learned context

## License

MIT
