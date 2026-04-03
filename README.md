# Cat's Claw 🐱

```
  /\_/\   Cat's Claw
 ( o.o )  Scratch your code into shape~
  > ^ <
```

Multi-provider AI coding agent for the terminal. Solo or team mode, MCP support, and automatic fallback.

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
                                  │  Login     │
                                  │  ┌────────┐│
                                  │  │API Key ││  ~/.cats-claw/credentials.json
                                  │  │.env    ││  .env
                                  │  └────────┘│
                                  └─────┬─────┘
                                        │
                              ┌─────────┼─────────┐
                              │  Init (parallel)   │
                              │  ┌──────┬────────┐ │
                              │  │ MCP  │  Team  │ │
                              │  │.mcp  │ detect │ │
                              │  │.json │ score  │ │
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
                                      └───────────┘
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
  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────────┐     ┌──────────┐
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
- **Solo/Team mode** — Single provider or 5-agent collaboration pipeline in one terminal
- **MCP support** — Connect external tools via Model Context Protocol (stdio/http/sse)
- **Auto-fallback** — Rate limit or quota error? Automatically tries next provider
- **Live scoring** — Team roles auto-assigned by efficiency, adapts from real usage data
- **Usage tracking** — Per-provider token count with estimated cost
- **Model catalog** — Browse and switch models by number or ID
- **Interactive REPL** — Ink-powered terminal UI with cat theme

## Requirements

- Node.js 22+
- npm

## Installation

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
cp .env.example .env   # Optional — set API keys here or enter them interactively
npm link               # Installs 'paw' command globally
```

## Quick Start

```bash
# Interactive REPL (provider selection + login)
paw

# Skip menu — use specific provider
paw --provider ollama --model qwen3
paw --provider anthropic

# Direct prompt (no REPL)
paw "explain this project"

# Team mode prompt
paw "/team implement JWT auth"
```

## Providers

### Cloud Providers (API key or login)

These are hosted services. You need an account and either an API key or an existing CLI login session.

| Provider | Auth | How to get access |
|----------|------|------------------|
| Anthropic | API key | Sign up at [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | API key | Sign up at [platform.openai.com](https://platform.openai.com) |
| Gemini | API key | Get a key at [aistudio.google.com](https://aistudio.google.com/apikey) |
| Groq | API key | Sign up at [console.groq.com](https://console.groq.com) |
| OpenRouter | API key | Sign up at [openrouter.ai](https://openrouter.ai) — access multiple models with one key |

### Local Provider (Ollama — free, no account needed)

Ollama runs AI models directly on your machine. No API key, no cloud, no cost.

**Setup:**

1. Install Ollama from [ollama.com/download](https://ollama.com/download)
2. Pull a model:
   ```bash
   ollama pull qwen3          # ~5GB, good general model
   # or
   ollama pull qwen2.5-coder:7b   # optimized for code
   ```
3. Make sure Ollama is running:
   ```bash
   ollama serve    # if not already running in background
   ```
4. Start Cat's Claw:
   ```bash
   paw --provider ollama --model qwen3
   ```

**Hardware notes:**
- 16GB RAM minimum, 32GB recommended
- GPU helps significantly but CPU-only works (slower)
- Smaller models (7B-8B) are the easiest starting point

### Model Catalog

Browse available models with `/model`:

```
* ollama:
  1. qwen3 * — Qwen3 8B (balanced)
  2. qwen2.5-coder:7b — Qwen2.5 Coder 7B (balanced)
  3. qwen2.5-coder:14b — Qwen2.5 Coder 14B (powerful)
  4. deepseek-r1:8b — DeepSeek R1 8B (balanced)

  anthropic:
  1. claude-haiku-4-5-20251001 — Haiku 4.5 (fast)
  2. claude-sonnet-4-20250514 — Sonnet 4 (balanced)
  3. claude-opus-4-20250514 — Opus 4 (powerful)

  openai:
  1. gpt-5-nano — GPT-5 Nano (fast)
  2. gpt-5-mini — GPT-5 Mini (balanced)
  3. gpt-5.2 — GPT-5.2 (powerful)
  ...
```

Switch by number or ID:

```
/model ollama 3             # Switch to qwen2.5-coder:14b
/model anthropic 1          # Switch to Haiku 4.5
/model openai gpt-5.2       # Switch by ID
```

## Modes

Cat's Claw runs in a **single terminal** with two modes. Switch freely at any time.

### Solo Mode (default)

Single provider handles all messages.

```
/mode solo              # Activate (default)
/model gemini           # Switch to Gemini
/model openai 3         # Switch by number
```

### Team Mode

5 specialized agents collaborate on every message:

```
/mode team              # Activate team mode
```

| Role | Job | Runs |
|------|-----|------|
| Planner | Architecture & step-by-step plan | Sequential |
| Coder | Implementation from plan | Sequential |
| Reviewer | Code review, bugs, security | **Parallel** |
| Tester | Test cases & edge cases | **Parallel** |
| Optimizer | Performance & best practices | Sequential |

### Team Configuration

Three ways to configure the team:

**1. Interactive Dashboard (`/team`):**

```
/team
╭─ Team Dashboard ─────────────────────╮
│ Mode: TEAM                           │
│   planner   anthropic/claude-sonnet-4│
│   coder     ollama/qwen3            │
│   reviewer  anthropic/claude-sonnet-4│
│   tester    openai/gpt-5-mini       │
│   optimizer openai/gpt-5-mini       │
│ Type: e(dit role) / t(oggle) / Enter │
╰──────────────────────────────────────╯

e → coder → gemini → gemini-2.5-pro
~ coder → gemini/gemini-2.5-pro
```

**2. Direct command:**

```
/model planner anthropic 3     # Planner → Opus 4
/model coder gemini             # Coder → Gemini default
/model reviewer openai gpt-5.2  # Reviewer → GPT-5.2
```

**3. Auto-assignment (default):**

Roles are assigned by efficiency scores (0-10). Uses greedy unique-first strategy to spread across providers:

```
planner  : anthropic/claude-sonnet-4    (score: 10)
coder    : ollama/qwen3                 (unique spread)
reviewer : anthropic/claude-sonnet-4    (score: 9)
tester   : openai/gpt-5-mini           (score: 9)
optimizer: openai/gpt-5-mini            (score: 9)
```

After 3+ uses per role, scores blend with real speed/reliability data from `~/.cats-claw/team-scores.json`.

### Automatic Fallback

When a provider fails (rate limit, quota, auth error):

- **Solo**: auto-switches to next available provider, shows `[Fallback: provider]`
- **Team**: retries failed phase with a different provider
- Ollama serves as the ultimate local fallback (free, no rate limits)

## Usage Tracking

`/status` shows per-provider token usage and estimated cost:

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
| `search_text` | Search patterns with ripgrep/grep |
| `run_shell` | Execute shell commands (cross-platform) |
| `glob` | Find files by pattern (*.ts, **/*.tsx) |
| `web_fetch` | Fetch URL content |

## MCP (Model Context Protocol)

### CLI Commands

```bash
# Add servers
paw mcp add --transport http notion https://mcp.notion.com/mcp
paw mcp add --transport sse asana https://mcp.asana.com/sse
paw mcp add --transport http github https://api.github.com/mcp \
  --header "Authorization:Bearer your-token"
paw mcp add --transport stdio --env API_KEY=abc myserver -- npx -y @some/package
paw mcp add-json weather '{"type":"http","url":"https://api.weather.com/mcp"}'

# Manage
paw mcp list
paw mcp get notion
paw mcp remove notion
```

### Interactive Manager (in REPL)

```
/mcp                    # Open MCP manager
  a + Enter             # Add server (guided flow)
  r + Enter             # Remove server (arrow select)
  b + Enter             # Back to chat
```

Failed connections show an error and are not saved.

### Config File

Servers are stored in `.mcp.json` (project root):

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.github.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    },
    "memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

Supports stdio, HTTP, and SSE transports. MCP tools are automatically injected into all providers.

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/status` | Providers, usage, cost overview (aliases: /settings, /providers, /cost, /version) |
| `/model [provider] [id\|number]` | List models / switch provider & model |
| `/team [prompt]` | Team dashboard (no args) or run team task |
| `/ask <provider> <prompt>` | One-shot query to specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager |
| `/git` | Git status + diff + recent log (aliases: /diff, /log) |
| `/history` | Export chat to markdown |
| `/compact` | Compress conversation context |
| `/init` | Generate CONTEXT.md |
| `/doctor` | Environment diagnostics |
| `/clear` | Reset conversation |
| `/exit` | Quit |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Autocomplete slash command |
| `↑↓` | Navigate autocomplete / selections |
| `Ctrl+L` | Clear conversation |
| `Ctrl+K` | Compact conversation |
| `Esc` | Quit / go back |

### Slash Command Autocomplete

Type `/` and matching commands appear. Arrow keys to navigate, Tab to complete:

```
 > /status — providers, usage, cost overview
   /model  — list/switch models & providers
 Tab to complete | arrows to navigate
╭──────────────────────────────╮
│  > /s                        │
╰──────────────────────────────╯
```

## Status Bar

Always visible at the bottom of the REPL:

```
Ollama/qwen3    turns: 5    mcp: 2 server(s)    local
TEAM/qwen3      turns: 2    mcp: off             tokens: 12.3k
```

Shows: mode/model, turn count, MCP status, token usage (or "local" for Ollama).

## File Locations

| File | Purpose |
|------|---------|
| `~/.cats-claw/credentials.json` | Saved API keys (mode 0600) |
| `~/.cats-claw/team-scores.json` | Live team performance scores |
| `~/.cats-claw/mcp.json` | Global MCP config (fallback) |
| `.mcp.json` | Project-level MCP config |
| `.env` | Environment variables |

```bash
paw --list              # Show saved credentials
paw --logout            # Remove all saved keys
paw --logout openai     # Remove specific provider key
```

## Environment Variables

See `.env.example` for all supported variables. Key ones:

```env
LLM_PROVIDER=anthropic          # Default provider
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GEMINI_API_KEY=...
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
```

## Getting Started (Step by Step)

### 1. Clone & Install

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
npm link    # Now 'paw' works globally
```

### 2. First Run

```bash
paw
```

You'll see:

```
  /\_/\
 ( o.o )  Cat's Claw
  > ^ <   Scratch your code into shape~

  Pick a brain for this cat:

  1. ~ Anthropic (saved) — Claude models
  2. ~ OpenAI — GPT models
  3. ~ Gemini — Google Gemini (strong long-context)
  4. ~ Groq — Fast inference, open models
  5. ~ OpenRouter — Multi-model hub, max flexibility
  6. ~ Ollama — Local models, no key needed

  =^.^= Choose (1-6):
```

### 3. Example — Solo Mode

```
you  explain the structure of this project
=^.^= says:
  This project has the following structure...

you  /model gemini
~ Switched to Gemini/gemini-2.5-flash

you  find unnecessary dependencies in package.json
=^.^= says:
  Looking at your dependencies...

you  /status
~ Cat's Claw v1.0.0 | Mode: SOLO
  Active: gemini/gemini-2.5-flash
  ...
  Usage:
    gemini/gemini-2.5-flash
      1.2k in / 900 out / 2 req  ~$0.0007
```

### 4. Example — Team Mode

```
you  /mode team
~ Switched to team mode. All messages go through the pipeline:
  planner: anthropic/claude-sonnet-4
  coder: ollama/qwen3
  reviewer: anthropic/claude-sonnet-4
  tester: openai/gpt-5-mini
  optimizer: openai/gpt-5-mini

you  implement a JWT authentication system

=^.^= Planning (anthropic/claude-sonnet-4)...
=^.^= Implementing (ollama/qwen3)...
=^.^= Reviewing (anthropic/claude-sonnet-4)...
=^.^= Testing (openai/gpt-5-mini)...
=^.^= Optimizing (openai/gpt-5-mini)...

--- PLANNER (anthropic/claude-sonnet-4, 3200ms) ---
1. Create src/auth.ts — JWT issue/verify
2. Create src/middleware.ts — auth middleware
...

--- CODER (ollama/qwen3, 8100ms) ---
[implementation code]

--- REVIEWER (anthropic/claude-sonnet-4, 2800ms) ---
Rating: MINOR
- auth.ts:15 — JWT_SECRET env validation missing
...

--- TESTER (openai/gpt-5-mini, 4200ms) ---
[test cases]

--- OPTIMIZER (openai/gpt-5-mini, 3100ms) ---
[optimization suggestions]

Total: 21400ms
```

### 5. Example — MCP Setup

```bash
# Add GitHub MCP server
paw mcp add --transport http github https://api.githubcopilot.com/mcp/

# Add Memory server
paw mcp add --transport stdio memory -- npx -y @modelcontextprotocol/server-memory

# Verify
paw mcp list
```

### 6. Example — Cross-Provider Query

```
you  /ask gemini what's the time complexity of this algorithm?
=^.^= says:
  [gemini] O(n log n) because...

you  /ask openai any security vulnerabilities?
=^.^= says:
  [openai] SQL injection risk at line 42...
```

### 7. Example — Fallback in Action

```
you  refactor this complex module

=^.^= grooming the code...
[Fallback: ollama/qwen3]
  Anthropic rate limit exceeded. Automatically switched to Ollama.
  Here's the refactored code...
```

## License

MIT
