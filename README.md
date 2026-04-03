# Cat's Claw 🐱

```
  /\_/\   Cat's Claw
 ( o.o )  Scratch your code into shape~
  > ^ <
```

Multi-provider AI coding agent for the terminal. Solo or team mode, MCP support, session sync, and automatic fallback.

> **Disclaimer:** Cat's Claw is an independent, third-party project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Google. Claude, GPT, Gemini, and related names are trademarks of their respective owners.

## Architecture

```
                         paw (CLI)
                            │
              ┌─────────────┼─────────────┐
              │             │             │
          paw mcp       paw --help    paw [prompt]
          (manage)      (info)        (main flow)
                                         │
                                   ┌─────┴─────┐
                                   │ Auto-Detect│
                                   │  Claude CLI│
                                   │  Codex CLI │
                                   │  Ollama    │
                                   │  API Key   │
                                   └─────┬─────┘
                                         │
                               ┌─────────┼─────────┐
                               │  Init (parallel)   │
                               │  MCP + Team detect │
                               │  + Session restore │
                               └─────────┬─────────┘
                                         │
                                   ┌─────┴─────┐
                                   │   REPL     │
                                   │  (Ink UI)  │
                                   └─────┬─────┘
                                         │
                           ┌─────────────┼─────────────┐
                           │             │             │
                     /commands      Solo Mode      Team Mode
                           │             │               │
                           │      ┌──────┴──┐    ┌──────┴───────┐
                           │      │Provider │    │Plan → Code → │
                           │      │  Call   │    │[Review+Test] │
                           │      └────┬────┘    │  → Optimize  │
                           │           │         └──────┬───────┘
                           │      ┌────┴────┐          │
                           │      │ 8 Tools │     Fallback
                           │      │ + MCP   │     on error
                           │      └────┬────┘          │
                           │           └────────┬──────┘
                           │                    │
                           │             ┌──────┴──────┐
                           └────────────▶│  Response   │
                                         │  + Session  │
                                         │  + Sync     │
                                         └─────────────┘
```

### Fallback

```
Provider Call → Success → Response
      │
      └─ Error (429/401/quota) → Next Provider → ... → Ollama (last resort)
```

### Team Pipeline

```
Plan(sequential) → Code(sequential) → [Review + Test](parallel) → Optimize(sequential)

Example:  anthropic → planner, reviewer, optimizer
          codex     → coder (score: 9)
          ollama    → tester (unique spread)
```

## Features

- **3 Providers** — Anthropic (Claude CLI), Codex (CLI), Ollama (local)
- **Auto-detect** — No login prompt; finds Claude login, Codex CLI, Ollama automatically
- **Solo/Team mode** — Single provider or 5-agent pipeline in one terminal
- **Session sync** — Conversations persist and sync across terminals in real-time (fs.watch)
- **Resume** — `--continue` or `--session <id>` to pick up where you left off
- **Arrow-key UI** — All panels: ↑↓ navigate, Enter select, Esc back
- **Effort levels** — Anthropic & Codex: low/medium/high/max (configurable per model and per team role)
- **MCP support** — External tools via Model Context Protocol (stdio/http/sse)
- **Auto-fallback** — Rate limit? Instantly tries next provider
- **Plan-aware models** — Shows models based on your subscription (free/pro/max)
- **Live Ollama detection** — Shows actually pulled models with sizes
- **Usage tracking** — Per-provider token count with estimated cost
- **Korean IME** — Native stdin handling for smooth CJK input
- **Autocomplete** — `/` triggers command list; Enter executes, Tab fills
- **Security hardened** — Injection protection, SSRF blocking, symlink guards

## Requirements

- Node.js 22+
- npm
- At least one: Claude Code, Codex CLI, or Ollama

## Installation

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
npm link    # Installs 'paw' command globally
```

## Quick Start

```bash
paw                                # Auto-detect and start REPL
paw --provider anthropic           # Force Anthropic
paw --provider codex               # Force Codex
paw --provider ollama              # Force Ollama
paw "explain this project"         # Direct prompt, no REPL
paw "/team implement JWT auth"     # Team mode prompt
paw --continue                     # Resume last session
paw -c "what did I say before?"    # Resume + prompt
paw --session abc123               # Join specific session
```

## Providers

| Provider | Auth | How it works |
|----------|------|-------------|
| **Anthropic** | Claude Code login or API key | Runs `claude -p` (no rate limit sharing with active session) |
| **Codex** | `codex login` | Runs `codex exec` with ChatGPT subscription |
| **Ollama** | (none) | Connects to local Ollama server |

### Anthropic

Auto-detected if Claude Code is installed. Uses CLI mode so your active Claude Code session's rate limit is not affected.

```bash
paw                        # Auto-detects Claude login
paw --provider anthropic   # Or explicit
```

Effort: low, medium, high, max

### Codex

Auto-detected if Codex CLI is installed. Uses ChatGPT subscription — no API key needed.

```bash
npm install -g @openai/codex
codex login
paw --provider codex
```

Effort: low, medium (default), high, extra_high

Models: GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex, GPT-5.3 Codex Spark, GPT-5.2 Codex, GPT-5.2, GPT-5.1 Codex Max/Mini, o4 Mini, o3

### Ollama (Local)

Free, no account. Runs models on your machine.

```bash
ollama pull qwen3
paw --provider ollama
```

Hardware: 16GB RAM minimum, GPU recommended.

### Coming Soon

- **Gemini** — Google Gemini API
- **Groq** — Fast inference
- **OpenRouter** — Multi-model hub

## Sessions

Conversations auto-save and sync across terminals.

```bash
paw                          # New session (auto-generated ID)
paw --continue               # Resume last session
paw -c "continue working"    # Resume + prompt
paw --session abc123         # Join specific session
```

### Real-time Sync

Two terminals with the same session ID see each other's messages instantly (fs.watch, 50ms debounce).

```
Terminal A: paw --session abc123
Terminal B: paw --session abc123
→ Both see the same conversation, synced in real-time
```

### REPL Commands

```
/sessions     # List past sessions with preview
/session      # Show current session ID
/compact      # Compress conversation (keeps recent summary)
```

### Session Files

Stored in `~/.cats-claw/sessions/{id}.json` (mode 0600).

## Provider Settings (`/settings`)

Manage providers via arrow-key panel:

```
╭─ Provider Settings ──────────────────╮
│  > ● Anthropic (active)              │
│    ● Codex                           │
│    ● Ollama (local)                  │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Select → choose login or API key → configured.

## Model Selection (`/model`)

Arrow-key panel showing plan-filtered models. Ollama shows actually pulled models:

```
╭─ Model Selection ────────────────────╮
│ Active: anthropic/claude-sonnet-4    │
│ Select provider:                     │
│  > anthropic (max)                   │
│    codex                             │
│    ollama                            │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
         ↓ Enter
╭─ Select model ───────────────────────╮
│  > claude-haiku-4-5 — Haiku 4.5     │
│    claude-sonnet-4 — Sonnet 4 *      │
│    claude-opus-4 — Opus 4            │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
         ↓ Enter (Codex/Anthropic)
╭─ Select effort ──────────────────────╮
│    Low — Fast, lighter reasoning     │
│  > Medium — Balanced (default)       │
│    High — Complex problems           │
│    Extra High — Maximum depth        │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Direct command also works: `/model codex 3` or `/model anthropic opus`

## Modes

One terminal, two modes. Switch anytime.

### Solo Mode (default)

```
/mode solo
```

Single provider handles all messages.

### Team Mode

```
/mode team
```

5 agents collaborate on every message:

| Role | Job | Runs |
|------|-----|------|
| Planner | Architecture & plan | Sequential |
| Coder | Implementation | Sequential |
| Reviewer | Bugs, security | **Parallel** |
| Tester | Test cases | **Parallel** |
| Optimizer | Performance | Sequential |

### Team Dashboard (`/team`)

```
╭─ Team Dashboard ─────────────────────╮
│  planner   anthropic/claude-sonnet-4 │
│  coder     codex/gpt-5.4            │
│  reviewer  anthropic/claude-sonnet-4 │
│  tester    ollama/qwen3             │
│  optimizer codex/gpt-5.4            │
│                                      │
│  > Edit role assignment              │
│    Toggle mode (→ team)              │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

### Team Role Editing

Full arrow-key flow: **pick role → pick provider → pick model → pick effort**

After each role change, returns to role selection for more edits. Esc to exit.

```
Select role → coder
Select provider → codex
Select model → gpt-5.4
Select effort → high
~ coder → codex/gpt-5.4 (effort: high)
→ Back to role selection
```

### Auto-Assignment

Roles assigned by efficiency scores (greedy unique-first). Adapts from real usage after 3+ runs per role. Scores stored in `~/.cats-claw/team-scores.json`.

### Automatic Fallback

Provider fails → instantly tries next. Ollama = local fallback (free, no rate limits).

## Tools (8 built-in)

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories |
| `read_file` | Read a text file (size guard) |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace a unique string |
| `search_text` | Search patterns (no injection) |
| `run_shell` | Shell commands (dangerous blocked) |
| `glob` | Find files by pattern (ReDoS-safe) |
| `web_fetch` | Fetch URL (SSRF-protected) |

## MCP (Model Context Protocol)

### CLI

```bash
paw mcp add --transport http github https://api.github.com/mcp \
  --header "Authorization:Bearer token"
paw mcp add --transport stdio memory -- npx -y @modelcontextprotocol/server-memory
paw mcp list
paw mcp remove github
```

### Interactive (`/mcp`)

```
╭─ MCP Server Manager ────────────────╮
│  ● github — 12 tool(s)              │
│  ● memory — 9 tool(s)               │
│  > Add server                        │
│    Remove server                     │
│    Back                              │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Supports stdio, HTTP, SSE. Tools auto-injected into all providers. Failed connections show error and aren't saved.

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Providers, usage, cost |
| `/settings` | Provider management (↑↓) |
| `/model` | Model catalog & switch (↑↓) |
| `/team` | Team dashboard (↑↓) |
| `/ask <provider> <prompt>` | Query specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager (↑↓) |
| `/git` | Status + diff + log |
| `/sessions` | List past sessions |
| `/session` | Current session ID |
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
| `Enter` | Select / execute autocomplete |
| `Tab` | Autocomplete (fill only) |
| `Esc` | Go back / quit |
| `Ctrl+L` | Clear conversation |
| `Ctrl+K` | Compact conversation |

### Status Bar

```
Anthropic/claude-sonnet-4  turns: 5  mcp: 1 server(s)  tokens: 4.2k
TEAM/gpt-5.4               turns: 2  mcp: off           local
```

## Security

- **Shell**: dangerous patterns blocked (rm -rf /, mkfs, etc.)
- **Search**: no shell injection (uses execFile, not shell)
- **Files**: symlink traversal protection (realpath check)
- **Web**: SSRF blocked (private IPs, metadata endpoints)
- **MCP**: safe env allowlist (API keys not leaked to child processes)
- **Credentials**: mode 0600
- **Glob**: ReDoS-safe regex conversion
- **Claude CLI**: IS_SANDBOX=1 for safe permissions

## Files

| File | Purpose |
|------|---------|
| `~/.cats-claw/credentials.json` | API keys (0600) |
| `~/.cats-claw/sessions/*.json` | Session history (0600) |
| `~/.cats-claw/team-scores.json` | Team performance |
| `.mcp.json` | MCP config |
| `.env` | Environment (optional) |

```bash
paw --list              # Show saved credentials
paw --logout            # Remove all saved keys
paw --logout codex      # Remove specific key
```

## Examples

### Solo Mode

```
you  explain the structure of this project
=^.^= says:
  This project has the following structure...

you  /model codex 1
~ codex/gpt-5.4 (effort: medium)

you  /status
~ Active: codex/gpt-5.4
  Usage: codex/gpt-5.4  500 in / 300 out  (free)
```

### Team Mode

```
you  /mode team
you  implement JWT auth

=^.^= Planning (anthropic/claude-sonnet-4)...
=^.^= Implementing (codex/gpt-5.4)...
=^.^= Reviewing (anthropic/claude-sonnet-4)...
=^.^= Testing (ollama/qwen3)...
=^.^= Optimizing (codex/gpt-5.4)...
Total: 21400ms
```

### Session Resume

```bash
paw "remember: secret code is TIGER42"
# Later, in any terminal:
paw --continue "what is the secret code?"
# → "The secret code is TIGER42"
```

### Cross-Provider Query

```
you  /ask codex refactor this function
=^.^= [codex] Here's the refactored version...

you  /ask anthropic review this code
=^.^= [anthropic] LGTM with one suggestion...
```

### Fallback

```
you  analyze this codebase
[Fallback: codex/gpt-5.4]
  Rate limit hit. Switched automatically.
```

## Changelog

### Major Milestones

1. **Initial release** — Multi-provider REPL with Ink UI, 8 tools, cat theme
2. **MCP support** — stdio/HTTP/SSE transport, interactive manager, CLI commands
3. **Team mode** — 5-agent pipeline with parallel execution, efficiency scoring
4. **Auto-detect** — Claude/Codex login, no startup prompt needed
5. **Arrow-key UI** — All panels redesigned for ↑↓ + Enter + Esc
6. **Plan-aware models** — Subscription-based filtering, live Ollama detection
7. **Codex provider** — Replaced OpenAI API with Codex CLI (ChatGPT subscription)
8. **Claude CLI** — Runs `claude -p` instead of direct API (no rate limit sharing)
9. **Effort levels** — Configurable per model and per team role
10. **Sessions** — Auto-save, resume, real-time sync across terminals
11. **Korean IME** — Native stdin handling, smooth CJK input
12. **Security audit** — 14 vulnerabilities fixed (injection, SSRF, symlink, permissions)
13. **`paw` CLI** — 3-character global command

## License

MIT
