# Cat's Claw 🐱

```
  /\_/\   Cat's Claw
 ( o.o )  Scratch your code into shape~
  > ^ <
```

Multi-provider AI coding agent for the terminal. Solo or team mode, MCP support, auto-login, and automatic fallback.

> **Disclaimer:** Cat's Claw is an independent, third-party project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, Google, Groq, or OpenRouter. Claude, GPT, Gemini, and related names are trademarks of their respective owners.

## Architecture Flow

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
                                  │  ┌────────┐│
                                  │  │Claude  ││  ~/.claude/.credentials.json
                                  │  │Codex   ││  ~/.codex/auth.json
                                  │  │API Key ││  ~/.cats-claw/credentials.json
                                  │  │.env    ││  .env
                                  │  └────────┘│
                                  └─────┬─────┘
                                        │
                              ┌─────────┼─────────┐
                              │  Init (parallel)   │
                              │  ┌──────┬────────┐ │
                              │  │ MCP  │  Team  │ │
                              │  │.mcp  │ detect │ ���
                              │  │.json │ score  │ ���
                              │  └──────┴────────┘ │
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
                    (13 cmds)         │               │
                                      ▼               ▼
                              ┌──────────┐    ┌──────────────┐
                              │ Provider │    │Plan → Code → │
                              │   API    │    │[Review+Test] │
                              │   Call   │    │  → Optimize  │
                              └────┬─────┘    └──────┬───────┘
                                   │                 │
                              ┌────┴────┐      ┌─────┴─────┐
                              │  Tools  │      │ Parallel   │
                              │(8 built │      │ Execution  │
                              │ + MCP)  │      │ + Fallback │
                              └────┬────┘      └─────┬─────┘
                                   │                 │
                                   └────────┬────────┘
                                            │
                                      ┌─────┴─────┐
                                      │ Response   │
                                      │ + Usage    │
                                      │ + Status   │
                                      └─────���─────┘
```

### Fallback Flow

```
Provider API Call
    │
    ├─ Success → Response
    │
    └─ Error (429/401/quota) → Try Next Provider
                                    │
                                    ├─ Success → [Fallback: provider] + Response
                                    │
                                    └─ Error → Try Next → ... → Ollama (local, last resort)
```

### Team Pipeline

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────���───┐     ┌──��───────┐
  │ PLANNER  │────▶│  CODER   │────▶│ REVIEWER  │  │  TESTER  │────▶│OPTIMIZER │
  │(reason)  │     │(implement│     │(bugs,sec) │  │(tests)   │     │(perf,dx) │
  │          │     │          │     └──────────┘  └──────────┘     │          │
  │sequential│     │sequential│      parallel ◀──▶ parallel        │sequential│
  └──────────┘     └──────────┘                                    └──────────┘

  Provider assignment (example with 3 providers):
  ┌─────────────────────────────────────────────┐
  │ anthropic → planner (10), reviewer (9)      │
  │ ollama    → coder (unique spread)           │
  │ openai    → tester (9), optimizer (9)       │
  └─────────────────────────────────────────────┘
```

## Features

- **Multi-provider** — Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama
- **Auto-detect** — No login prompt; auto-detects Claude, Codex, API keys, and .env
- **Solo/Team mode** — Single provider or 5-agent collaboration pipeline in one terminal
- **Arrow-key UI** — All panels use ↑↓ navigate, Enter select, Esc back
- **MCP support** — Connect external tools via Model Context Protocol (stdio/http/sse)
- **Auto-fallback** — Rate limit or quota error? Automatically tries next provider
- **Plan-aware models** — Shows only models available for your plan (free/pro/max)
- **Live model detection** — Ollama shows pulled models; cloud APIs show accessible models
- **Live scoring** — Team roles auto-assigned by efficiency, adapts from real usage
- **Usage tracking** — Per-provider token count with estimated cost
- **Security hardened** — Command injection protection, SSRF blocking, symlink guards

## Requirements

- Node.js 22+
- npm

## Installation

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
npm link               # Installs 'paw' command globally
```

No `.env` required — Cat's Claw auto-detects your providers on startup.

## Quick Start

```bash
# Auto-detect providers and start REPL
paw

# Use specific provider
paw --provider ollama --model qwen3

# Direct prompt (no REPL)
paw "explain this project"

# Team mode prompt
paw "/team implement JWT auth"
```

On first run, Cat's Claw automatically detects available providers:

```
=^.^= Auto-detected: anthropic/claude-sonnet-4-20250514
```

If nothing is detected, it opens the provider selection menu.

## Providers

### Cloud Providers (API key or login)

| Provider | Auth | How to get access |
|----------|------|------------------|
| Anthropic | API key or Claude login | [console.anthropic.com](https://console.anthropic.com), or `claude` CLI login |
| OpenAI | API key or Codex login | [platform.openai.com](https://platform.openai.com), or `codex login` |
| Gemini | API key | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Groq | API key | [console.groq.com](https://console.groq.com) |
| OpenRouter | API key | [openrouter.ai](https://openrouter.ai) |

### Local Provider (Ollama)

Free, no account needed. Runs models on your machine.

```bash
# 1. Install from ollama.com/download
# 2. Pull a model
ollama pull qwen3
# 3. Start Cat's Claw
paw --provider ollama
```

Hardware: 16GB RAM minimum, GPU recommended, 7B-8B models easiest to start.

### Provider Settings (`/settings`)

Manage all providers from one panel — arrow keys to navigate:

```
╭─ Provider Settings ──────────────────╮
│  > ● Anthropic (active)              │
│    ● OpenAI                          │
│    ○ Gemini                          │
│    ○ Groq                            │
│    ○ OpenRouter                      │
│    ● Ollama (local)                  │
│                                      │
│  ↑↓ navigate  Enter select  Esc back │
╰───��──────────────────────────────────╯
```

Select a provider → choose auth method:

```
╭─ Configure Anthropic ────────────────╮
│  > Use Claude Code login             │
│    Enter API key manually            │
│                                      │
│  ↑↓ navigate  Enter select  Esc back │
╰��─────────────────────────────────────╯
```

- **Anthropic**: use Claude Code session or API key
- **OpenAI**: use Codex session or API key
- **Others**: API key only
- **Ollama**: no auth needed

### Auto-Login

If you have Claude Code or Codex installed, Cat's Claw reuses the session automatically:

| CLI Tool | Auth File | Provider |
|----------|----------|----------|
| Claude Code | `~/.claude/.credentials.json` | Anthropic |
| Codex | `~/.codex/auth.json` | OpenAI |

### Model Catalog (`/model`)

Shows models filtered by your plan. Ollama shows actually pulled models:

```
* anthropic (max):
  1. claude-haiku-4-5-20251001 — Haiku 4.5
  2. claude-sonnet-4-20250514 — Sonnet 4
  3. claude-sonnet-4-6-20250725 — Sonnet 4.6
  4. claude-opus-4-20250514 — Opus 4
  5. claude-opus-4-6-20250725 — Opus 4.6

  openai (pro):
  1. gpt-4o-mini — GPT-4o Mini
  2. gpt-4o — GPT-4o
  3. gpt-5-nano — GPT-5 Nano
  4. gpt-5-mini — GPT-5 Mini
  5. o4-mini — o4 Mini
  6. gpt-5.2 — GPT-5.2

* ollama:
  1. qwen3:latest — qwen3:latest (8.2B)
```

Switch by number or ID:

```
/model anthropic 4      # Switch to Opus 4
/model ollama 1         # Switch to qwen3
/model openai gpt-5.2   # Switch by ID
```

## Modes

One terminal, two modes. Switch freely anytime.

### Solo Mode (default)

Single provider handles all messages.

```
/mode solo              # Activate (default)
/model gemini           # Switch provider
```

### Team Mode

5 agents collaborate on every message:

```
/mode team              # Activate
```

| Role | Job | Runs |
|------|-----|------|
| Planner | Architecture & plan | Sequential |
| Coder | Implementation | Sequential |
| Reviewer | Bugs, security | **Parallel** |
| Tester | Test cases | **Parallel** |
| Optimizer | Performance | Sequential |

### Team Dashboard (`/team`)

Arrow-key interface for viewing and editing team configuration:

```
╭─ Team Dashboard ─────────────────────╮
│  planner   anthropic/claude-sonnet-4 │
│  coder     ollama/qwen3             │
│  reviewer  anthropic/claude-sonnet-4 │
│  tester    openai/gpt-5-mini        ���
│  optimizer openai/gpt-5-mini        │
│                                      │
│  > Edit role assignment              │
│    Toggle mode (→ team)              │
│                                      │
│  ↑↓ navigate  Enter select  Esc back │
╰─���────────────────────────────────────╯
```

Edit role → pick role → pick provider (all arrow-key based).

### Auto-Assignment

Roles assigned by efficiency scores. Uses greedy unique-first to spread across providers. Scores adapt from real usage after 3+ runs per role.

### Automatic Fallback

- **Solo**: provider fails → auto-tries next, shows `[Fallback: provider]`
- **Team**: phase fails → retries with different provider
- Ollama = ultimate local fallback (free, no rate limits)

## Usage Tracking (`/status`)

Per-provider token count with estimated cost:

```
Cat's Claw v1.0.0 | Mode: SOLO
Active: anthropic/claude-sonnet-4

Providers (3):
  * anthropic — claude-sonnet-4
    openai — gpt-5-mini
    ollama — qwen3

Usage:
  anthropic/claude-sonnet-4
    2.1k in / 1.8k out / 3 req  ~$0.0333
  ollama/qwen3
    500 in / 300 out / 1 req  (free)

  Total: 2.6k in / 2.1k out
  Estimated cost:  ~$0.0333
```

## Tools (8 built-in)

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories |
| `read_file` | Read a text file (with size guard) |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace a unique string in a file |
| `search_text` | Search patterns (no shell injection) |
| `run_shell` | Shell commands (dangerous patterns blocked) |
| `glob` | Find files by pattern (ReDoS-safe) |
| `web_fetch` | Fetch URL (SSRF-protected) |

## MCP (Model Context Protocol)

### CLI Commands

```bash
paw mcp add --transport http notion https://mcp.notion.com/mcp
paw mcp add --transport sse asana https://mcp.asana.com/sse
paw mcp add --transport http github https://api.github.com/mcp \
  --header "Authorization:Bearer your-token"
paw mcp add --transport stdio --env API_KEY=abc myserver -- npx -y @some/package
paw mcp add-json weather '{"type":"http","url":"https://api.weather.com/mcp"}'
paw mcp list
paw mcp get notion
paw mcp remove notion
```

### Interactive Manager (`/mcp`)

Arrow-key interface:

```
╭─ MCP Server Manager ────────────────╮
│  ● github — 12 tool(s)              │
│  ● memory — 9 tool(s)               │
│                                      │
│  > Add server                        │
│    Remove server                     │
│    Back                              │
│                                      │
│  ��↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Add: guided text input (name → command → args). Remove: arrow-select server. Failed connections show error and aren't saved.

### Config File

`.mcp.json` in project root:

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

Supports stdio, HTTP, SSE. MCP tools auto-injected into all providers.

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Providers, usage, cost overview |
| `/settings` | Provider management panel (↑↓ select) |
| `/model` | Model catalog & switch (↑↓ or number/ID) |
| `/team` | Team dashboard & config (↑↓ select) |
| `/ask <provider> <prompt>` | Query specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager (↑↓ select) |
| `/git` | Git status + diff + log |
| `/history` | Export chat to markdown |
| `/compact` | Compress conversation |
| `/init` | Generate CONTEXT.md |
| `/doctor` | Diagnostics |
| `/clear` | Reset conversation |
| `/exit` | Quit |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑↓` | Navigate menus / autocomplete |
| `Enter` | Select / confirm |
| `Esc` | Go back / quit |
| `Tab` | Autocomplete slash command |
| `Ctrl+L` | Clear conversation |
| `Ctrl+K` | Compact conversation |

### Status Bar

Always visible at the bottom:

```
Anthropic/claude-sonnet-4  turns: 5  mcp: 2 server(s)  tokens: 4.2k
TEAM/qwen3                 turns: 2  mcp: off           local
```

## Security

- Shell commands: dangerous patterns blocked (rm -rf /, etc.)
- Search: no shell injection (uses execFile, not shell)
- File access: symlink traversal protection (realpath check)
- Web fetch: SSRF protection (blocks private IPs, metadata endpoints)
- MCP: safe env allowlist (API keys not leaked to child processes)
- Credentials: saved with mode 0600
- Glob: ReDoS-safe regex conversion

## File Locations

| File | Purpose |
|------|---------|
| `~/.cats-claw/credentials.json` | Saved API keys (mode 0600) |
| `~/.cats-claw/team-scores.json` | Team performance scores |
| `~/.cats-claw/mcp.json` | Global MCP config |
| `.mcp.json` | Project-level MCP config |
| `.env` | Environment variables (optional) |

```bash
paw --list              # Show saved credentials
paw --logout            # Remove all saved keys
paw --logout openai     # Remove specific key
```

## Examples

### Solo Mode

```
you  explain the structure of this project
=^.^= says:
  This project has the following structure...

you  /model gemini
~ Switched to Gemini/gemini-2.5-flash

you  /status
~ Active: gemini/gemini-2.5-flash
  Usage: 1.2k in / 900 out  ~$0.0007
```

### Team Mode

```
you  /mode team
you  implement a JWT authentication system

=^.^= Planning (anthropic/claude-sonnet-4)...
=^.^= Implementing (ollama/qwen3)...
=^.^= Reviewing (anthropic/claude-sonnet-4)...
=^.^= Testing (openai/gpt-5-mini)...
=^.^= Optimizing (openai/gpt-5-mini)...

--- PLANNER (3200ms) ---  --- CODER (8100ms) ---
--- REVIEWER (2800ms) --- --- TESTER (4200ms) ---
--- OPTIMIZER (3100ms) ---
Total: 21400ms
```

### Cross-Provider Query

```
you  /ask gemini what's the time complexity?
=^.^= [gemini] O(n log n) because...

you  /ask openai any security issues?
=^.^= [openai] SQL injection at line 42...
```

### Fallback

```
you  refactor this module
=^.^= grooming the code...
[Fallback: ollama/qwen3]
  Rate limit exceeded. Switched to Ollama automatically.
```

## License

MIT
