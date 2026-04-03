# Cat's Claw 🐱

```
  /\_/\   Cat's Claw
 ( o.o )  Scratch your code into shape~
  > ^ <
```

Multi-provider AI coding agent for the terminal. Solo or team mode, MCP support, auto-login, and automatic fallback.

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
                    (18 cmds)         │               │
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
                                      │ + Status   │
                                      │   Bar      │
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
- **Auto-login** — Reuse Claude (`~/.claude/.credentials.json`) and Codex (`~/.codex/auth.json`) sessions
- **Solo/Team mode** — Single provider or 5-agent collaboration pipeline
- **MCP support** — Connect external tools via Model Context Protocol (stdio/http/sse)
- **Auto-fallback** — Rate limit or quota error? Automatically tries next provider
- **Live scoring** — Team roles auto-assigned by efficiency, adapts from real usage data
- **Interactive REPL** — Ink-powered terminal UI with cat theme

## Requirements

- Node.js 22+
- npm

## Installation

```bash
git clone https://github.com/jhcdev/cats-claw.git
cd cats-claw
npm install
cp .env.example .env   # Optional — auto-login works without .env
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
| Anthropic | API key or Claude login | Sign up at [console.anthropic.com](https://console.anthropic.com), or install [Claude Code](https://claude.ai/download) and run `claude` to login |
| OpenAI | API key or Codex login | Sign up at [platform.openai.com](https://platform.openai.com), or install [Codex](https://github.com/openai/codex) and run `codex login` |
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

### Auto-Login

Cat's Claw automatically detects existing CLI sessions — no manual API key entry needed:

| CLI Tool | Auth File | Provider |
|----------|----------|----------|
| Claude Code (`claude`) | `~/.claude/.credentials.json` | Anthropic |
| Codex (`codex login`) | `~/.codex/auth.json` | OpenAI |

If you already use Claude Code or Codex, just run `paw` and it will offer to reuse your session:

```
  =^.^= Use Claude login (max plan)? [Y/n]:
```

For other providers, enter your API key once and Cat's Claw saves it to `~/.cats-claw/credentials.json` (mode 0600) for next time.

## Modes

### Solo Mode (default)

Single provider handles all messages. Switch provider/model anytime with `/model`.

```
/mode solo              # Activate (default)
/model gemini           # Switch to Gemini
/model openai gpt-5.2   # Switch to specific model
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
| Reviewer | Code review, bugs, security | Parallel |
| Tester | Test cases & edge cases | Parallel |
| Optimizer | Performance & best practices | Sequential |

**Review + Test run in parallel** for speed.

```
/team implement a REST API with pagination   # One-shot team task
/providers                                    # See team assignments
/team                                         # Open team dashboard
```

### Team Auto-Assignment

Roles are assigned by efficiency scores (0-10 per provider/role):

```
planner  : anthropic/claude-sonnet-4    (score: 10)
coder    : ollama/qwen3                 (score: 6, unique spread)
reviewer : anthropic/claude-sonnet-4    (score: 9)
tester   : openai/gpt-5-mini           (score: 9)
optimizer: openai/gpt-5-mini            (score: 9)
```

- Greedy unique-first: spreads across providers, then fills gaps
- **Live scoring**: after 3+ uses, blends baseline with real speed/reliability
- Scores stored in `~/.cats-claw/team-scores.json`
- Edit any role: `/model reviewer gemini gemini-2.5-pro`

### Automatic Fallback

When a provider fails (rate limit, quota, auth error):

- **Solo**: auto-switches to next available provider
- **Team**: retries failed phase with a different provider
- Ollama serves as the ultimate local fallback

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

## REPL Commands (18)

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager |
| `/model [provider] [model]` | Show/switch provider & model |
| `/mode solo\|team` | Switch mode |
| `/team [prompt]` | Team dashboard or one-shot team task |
| `/ask <provider> <prompt>` | Query specific provider |
| `/providers` | List providers & team assignments |
| `/settings` | Overview of all config |
| `/cost` | Token usage |
| `/git` | Git status |
| `/diff` | Git diff |
| `/log` | Recent commits |
| `/history` | Export chat to markdown |
| `/compact` | Compress conversation context |
| `/init` | Generate CONTEXT.md |
| `/doctor` | Environment diagnostics |
| `/version` | Show version |
| `/clear` | Reset conversation |
| `/exit` | Quit |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Autocomplete slash command |
| `↑↓` | Navigate autocomplete / MCP select |
| `Ctrl+L` | Clear conversation |
| `Ctrl+K` | Compact conversation |
| `Esc` | Quit / go back |

### Slash Command Autocomplete

Type `/` and matching commands appear. Arrow keys to navigate, Tab to complete:

```
 > /help — show all commands
   /history — export conversation
 Tab to complete | arrows to navigate
╭──────────────────────────────╮
│  > /h                        │
╰──────────────────────────────╯
```

## Status Bar

Always visible at the bottom:

```
Ollama/qwen3    turns: 5    mcp: 2 server(s)    local
TEAM/qwen3      turns: 2    mcp: off             tokens: 12.3k
```

Shows: provider/model, turn count, MCP status, token usage (or "local" for Ollama).

## Credentials Storage

| File | Purpose |
|------|---------|
| `~/.cats-claw/credentials.json` | Saved API keys (mode 0600) |
| `~/.cats-claw/team-scores.json` | Live performance scores |
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
ANTHROPIC_API_KEY=...           # Or use Claude login
OPENAI_API_KEY=...              # Or use Codex login
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

  1. ~ Anthropic (saved) — Claude models (API key or Claude login)
  2. ~ OpenAI — GPT models (API key or Codex login)
  3. ~ Gemini — Google Gemini (strong long-context)
  4. ~ Groq — Fast inference, open models
  5. ~ OpenRouter — Multi-model hub, max flexibility
  6. ~ Ollama — Local models, no key needed

  =^.^= Choose (1-6):
```

If you have Claude Code or Codex installed, it auto-detects and offers to reuse the login:

```
  =^.^= Use Claude login (max plan)? [Y/n]:
```

### 3. Example Session — Solo Mode

```
=^.^= says:
  Welcome! I'm ready to help with your code.

you  explain the structure of this project
=^.^= says:
  This project has the following structure:
  src/
    index.ts    — entry point
    agent.ts    — coding agent with multi-provider support
    ...

you  /model gemini
~ Switched to Gemini/gemini-2.5-flash

you  find unnecessary dependencies in package.json
=^.^= says:
  Looking at your dependencies...

you  /cost
~ Turns: 3
  Input:  2.1k tokens
  Output: 1.8k tokens
  Total:  3.9k tokens
```

### 4. Example Session — Team Mode

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
3. Add JWT_SECRET to .env
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

In the REPL:

```
you  /mcp
╭─ MCP Server Manager ─────────────────╮
│  + github — npx — 12 tool(s)        │
│  + memory — npx — 9 tool(s)         │
│ Type: a(dd) / r(emove) / b(ack)      │
╰──────────────────────────────────────╯
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

### 7. Example — Team Dashboard

```
you  /team
╭─ Team Dashboard ─────────────────────╮
│ Mode: TEAM                           │
│   planner   anthropic/claude-sonnet-4│
│   coder     ollama/qwen3            │
│   reviewer  anthropic/claude-sonnet-4│
│   tester    openai/gpt-5-mini       │
│   optimizer openai/gpt-5-mini       │
│ Type: e(dit role) / t(oggle) / Enter │
╰──────────────────────────────────────╯

# Edit a role:
e → coder → gemini → gemini-2.5-pro
~ coder → gemini/gemini-2.5-pro
```

### 8. Example — Fallback in Action

```
you  refactor this complex module

=^.^= grooming the code...
[Fallback: ollama/qwen3]
  Anthropic rate limit exceeded. Automatically switched to Ollama.
  Here's the refactored code...
```

## License

MIT
