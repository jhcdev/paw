# Cat's Claw 🐱

```
  /\_/\   Cat's Claw
 ( o.o )  Scratch your code into shape~
  > ^ <
```

Multi-provider AI coding agent for the terminal. Solo or team mode, MCP support, auto-detect login, and automatic fallback.

> **Disclaimer:** Cat's Claw is an independent, third-party project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Google. Claude, GPT, Gemini, and related names are trademarks of their respective owners.

## Architecture

```
                         paw (CLI)
                            │
                 ┌──────────┼──────────┐
                 │          │          │
             paw mcp    paw --help   paw [prompt]
             (manage)   (info)       (main flow)
                                        │
                                  ┌─────┴─────┐
                                  │ Auto-Detect│
                                  │  Claude    │  ~/.claude/.credentials.json
                                  │  Codex CLI │  codex --version
                                  │  API Key   │  ~/.cats-claw/credentials.json
                                  │  Ollama    │  localhost:11434
                                  └─────┬─────┘
                                        │
                              ┌─────────┼─────────┐
                              │  Init (parallel)   │
                              │  MCP + Team detect │
                              └─────────┬─────────┘
                                        │
                                  ┌─────┴─────┐
                                  │   REPL     │
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
                          │      │ 8 Tools │          │
                          │      │ + MCP   │          │
                          │      └────┬────┘          │
                          │           └────────┬──────┘
                          │                    │
                          │             ┌──────┴──────┐
                          │             │  Response   │
                          └────────────▶│  + Status   │
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

Example with 3 providers:
  anthropic → planner, reviewer, optimizer
  codex     → coder (score: 9)
  ollama    → tester (unique spread)
```

## Features

- **3 Providers** — Anthropic (Claude CLI), Codex (CLI), Ollama (local)
- **Auto-detect** — No login prompt; finds Claude login, Codex CLI, Ollama automatically
- **Solo/Team mode** — Single provider or 5-agent pipeline in one terminal
- **Arrow-key UI** — All panels: ↑↓ navigate, Enter select, Esc back
- **Effort levels** — Anthropic & Codex: low/medium/high/max (or extra_high)
- **MCP support** — External tools via Model Context Protocol (stdio/http/sse)
- **Auto-fallback** — Rate limit? Instantly tries next provider
- **Plan-aware models** — Shows models based on your subscription (free/pro/max)
- **Live Ollama detection** — Shows actually pulled models with sizes
- **Usage tracking** — Per-provider token count with estimated cost
- **Korean IME** — Native stdin handling for smooth CJK input
- **Security hardened** — Injection protection, SSRF blocking, symlink guards

## Requirements

- Node.js 22+
- npm
- At least one provider: Claude Code, Codex CLI, or Ollama

## Installation

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
npm link    # Installs 'paw' command globally
```

## Quick Start

```bash
paw                              # Auto-detect and start REPL
paw --provider anthropic         # Force Anthropic
paw --provider codex             # Force Codex
paw --provider ollama            # Force Ollama
paw "explain this project"       # Direct prompt, no REPL
paw "/team implement JWT auth"   # Team mode prompt
```

## Providers

| Provider | Auth | How it works |
|----------|------|-------------|
| **Anthropic** | Claude Code login or API key | Runs `claude -p` CLI for login users, SDK for API keys |
| **Codex** | `codex login` | Runs `codex exec` CLI, ChatGPT subscription |
| **Ollama** | (none) | Connects to local Ollama server |

### Anthropic

Auto-detected if Claude Code is installed. Uses `claude -p` (CLI mode) so there's no rate limit sharing with your active Claude Code session.

```bash
# Already logged in to Claude Code? Just run:
paw
# Or with API key in .env:
# ANTHROPIC_API_KEY=sk-ant-...
```

**Effort levels:** low, medium, high, max

### Codex

Auto-detected if Codex CLI is installed. Uses `codex exec` with your ChatGPT subscription.

```bash
npm install -g @openai/codex
codex login
paw --provider codex
```

**Effort levels:** low, medium (default), high, extra_high

**Models:** GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex, GPT-5.3 Codex Spark, GPT-5.2 Codex, GPT-5.2, GPT-5.1 Codex Max/Mini, o4 Mini, o3

### Ollama (Local)

Free, no account. Runs models on your machine.

```bash
ollama pull qwen3
paw --provider ollama
```

Hardware: 16GB RAM minimum, GPU recommended.

### Coming Soon

- **Gemini** — Google Gemini API (planned)
- **Groq** — Fast inference (planned)
- **OpenRouter** — Multi-model hub (planned)

### Provider Settings (`/settings`)

```
╭─ Provider Settings ──────────────────╮
│  > ● Anthropic (active)              │
│    ● Codex                           │
│    ● Ollama (local)                  │
│                                      │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Configure providers, enter API keys, or use existing logins — all via arrow keys.

### Model Catalog (`/model`)

Models filtered by your plan. Ollama shows actually pulled models:

```
* anthropic (max):
  1. claude-haiku-4-5 — Haiku 4.5
  2. claude-sonnet-4 — Sonnet 4
  3. claude-sonnet-4-6 — Sonnet 4.6
  4. claude-opus-4 — Opus 4
  5. claude-opus-4-6 — Opus 4.6

  codex:
  1. gpt-5.4 — GPT-5.4 (default)
  2. gpt-5.4-mini — GPT-5.4 Mini
  ...

* ollama:
  1. qwen3:latest — qwen3:latest (8.2B)
```

After selecting a Codex or Anthropic model, choose effort level:

```
╭─ Select effort level ────────────────╮
│    Low — Fast, lighter reasoning     │
│  > Medium — Balanced (default)       │
│    High — Complex problems           │
│    Extra High — Maximum depth        │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

## Modes

One terminal, two modes. Switch anytime.

### Solo Mode (default)

```
/mode solo
/model anthropic 4    # Switch to Opus 4
```

### Team Mode

5 agents collaborate on every message:

```
/mode team
```

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

Roles auto-assigned by efficiency scores. Adapts from real usage after 3+ runs.

### Automatic Fallback

Provider fails → instantly tries next. Ollama = ultimate local fallback.

```
=^.^= grooming the code...
[Fallback: codex/gpt-5.4]
  Rate limit hit. Switched automatically.
```

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

Supports stdio, HTTP, SSE. Tools auto-injected into all providers.

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

- Shell: dangerous patterns blocked
- Search: no shell injection (execFile)
- Files: symlink traversal protection
- Web: SSRF blocked (private IPs, metadata)
- MCP: safe env allowlist
- Credentials: mode 0600
- Glob: ReDoS-safe

## Files

| File | Purpose |
|------|---------|
| `~/.cats-claw/credentials.json` | API keys (0600) |
| `~/.cats-claw/team-scores.json` | Team performance |
| `.mcp.json` | MCP config |
| `.env` | Environment (optional) |

## Examples

### Solo

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

### Team

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

### Cross-Provider

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
  Anthropic rate limit. Switched automatically.
```

## License

MIT
