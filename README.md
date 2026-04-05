# Paw 🐱

```
  /\_/\   Paw
 ( o.o )  One terminal. Every AI. No lock-in.
  > ^ <
```

Multi-provider AI coding agent that runs Anthropic, OpenAI, and local models from a single CLI — with automatic fallback, parallel sub-agents, and built-in safety.

![Paw Terminal](assets/screenshot.png)

> **Disclaimer:** Paw is an independent, third-party project. It is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI or any AI provider.

---

## Why Paw

### 1. Multi-Provider, Zero Lock-in

Other tools lock you into one AI provider. Paw uses **Anthropic, Codex (OpenAI), and Ollama** simultaneously — switching automatically when rate limits hit, distributing work across models, and letting you pick the right model for each task.

```
Provider Call → Success → Response
      │
      └─ Error (429/quota) → Next Provider → ... → Ollama (last resort, free)
```

### 2. Parallel Sub-Agents (`/spawn`)

Don't wait for one task to finish before starting the next. Spawn independent agents that work **in parallel** — even while the main AI is thinking.

```
you  explain the architecture        ← main AI starts working
you  /spawn add tests for auth       ← runs immediately in background
you  /spawn update README            ← another agent, different provider
you  /tasks                          ← check progress anytime

  ◉ #1 [running] add tests... (codex/gpt-5.4) 12s...
  ◉ #2 [running] update README (ollama/llama3) 8s...
```

Each agent gets its own provider instance, round-robin distributed. Choose provider and model interactively or inline:

```
/spawn                                ← opens ↑↓ provider → model → task panel
/spawn codex/gpt-5.4 fix all lint    ← inline with specific model
```

### 3. Trust Layer (`/verify`)

AI-generated code has [1.7x more issues](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) than human code. Paw's verify mode automatically sends every code change to a **different AI for review** — catching bugs before they land.

```
you  add user authentication endpoint
=^.^= [writes src/auth.ts]

---
Verification (by ollama/llama3):
  Confidence: 85/100
  warning: src/auth.ts — Potential SQL injection in query builder
---
```

Choose the reviewer's provider, model, and effort level via `/verify` panel.

### 4. Agent Safety (`/safety`)

Every tool call is classified by risk level. Destructive commands (`rm`, `terraform destroy`, `kubectl delete`, `DROP TABLE`) are **blocked automatically** with git checkpoints.

```
[LOW]  read_file, search_text     → runs immediately
[MED]  write_file, edit_file      → runs immediately
[HIGH] rm, git reset, npm publish → blocked + git stash checkpoint
[CRIT] rm -rf /, mkfs, curl|sh   → permanently blocked
```

### 5. Extensible: Skills + Hooks (Claude Code-style)

**Skills** extend what Paw can do — custom slash commands with `$ARGUMENTS`, `` !`command` `` injection, and directory-based `SKILL.md`:

```
/deploy production              ← $ARGUMENTS = "production"
/fix-issue 123                  ← arguments passed to skill prompt
/review src/auth.ts             ← built-in skill
```

**Hooks** automate workflows at 10 lifecycle events — with regex matchers, JSON stdin, and exit code blocking:

```json
{ "hooks": { "post-tool": [
  { "matcher": "edit_file|write_file",
    "hooks": [{ "type": "command", "command": "npx prettier --write $(jq -r '.tool_input.path')" }] }
]}}
```

---

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
                                   │ Anthropic  │
                                   │  Codex CLI │
                                   │  Ollama    │
                                   └─────┬─────┘
                                         │
                               ┌─────────┼─────────┐
                               │  Init (parallel)   │
                               │  MCP + Team detect │
                               │  + Session restore │
                               │  + Hooks load      │
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
                                         │  + Hooks    │
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

| Category | Features |
|----------|----------|
| **Providers** | Anthropic, Codex (OpenAI), Ollama (local) — auto-detect, auto-fallback |
| **Agent Modes** | Solo, Team (5-agent pipeline), `/auto` (autonomous), `/spawn` (parallel sub-agents) |
| **Trust & Safety** | `/verify` (cross-provider review), `/safety` (risk classification + blocking) |
| **Extensibility** | Skills ($ARGUMENTS, !`cmd`, SKILL.md), Hooks (10 events, matchers, JSON stdin, blocking) |
| **Developer UX** | Arrow-key UI, message queue, session sync, Smart Router (EN/KO/JA/ZH), MCP support |

## Requirements

- Node.js 22+
- npm
- At least one: Anthropic API key, Codex CLI, or Ollama

## Installation

```bash
# From source
git clone https://github.com/jhcdev/paw.git
cd paw
npm install
npm link    # Installs 'paw' command globally

# Or install globally (npm)
npm install -g paw
```

## Quick Start

```bash
paw                                # Auto-detect and start REPL
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
| **Anthropic** | API key (`ANTHROPIC_API_KEY`) | Claude models, best reasoning |
| **Codex** | `codex login` | Runs `codex exec` with ChatGPT subscription |
| **Ollama** | (none) | Connects to local Ollama server |

### Anthropic

API key from [console.anthropic.com](https://console.anthropic.com). Best for reasoning and planning.

```bash
# Set in .env
ANTHROPIC_API_KEY=sk-ant-api03-...
# Or configure in REPL
/settings → Anthropic → enter API key
```

Models: Haiku 4.5 (fast), Sonnet 4/4.6 (balanced), Opus 4/4.6 (powerful).
Pricing: per-token (e.g. Sonnet $3/1M input, $15/1M output).

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

### Session Files

Stored in `~/.paw/sessions/{id}.json` (mode 0600).

## Skills

Skills extend what Paw can do. Create a `SKILL.md` with instructions and Paw adds it to its capabilities.

### Built-in Skills (7)

| Skill | Description |
|-------|-------------|
| `/review` | Review code for bugs, security, and best practices |
| `/refactor` | Suggest refactoring improvements |
| `/test` | Generate test cases |
| `/explain` | Explain code in detail |
| `/optimize` | Optimize code for performance |
| `/document` | Generate documentation |
| `/commit` | Generate a conventional commit message from git diff |

### Using Skills

```
you  /review src/auth.ts
you  /commit
you  /explain this function
you  /fix-issue 123              ← arguments passed via $ARGUMENTS
you  /migrate-component SearchBar React Vue  ← indexed args via $0, $1, $2
```

### Custom Skills

Skills support two formats: **flat files** and **directory-based** (with supporting files).

#### Flat file — `.paw/skills/deploy.md`:

```md
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

#### Directory-based — `.paw/skills/explain-code/SKILL.md`:

```
explain-code/
├── SKILL.md           # Main instructions (required)
├── template.md        # Template for Paw to fill
├── examples/
│   └── sample.md      # Example output
└── scripts/
    └── visualize.py   # Script Paw can run
```

```md
---
name: explain-code
description: Explains code with visual diagrams and analogies
---

When explaining code, always include:
1. **Start with an analogy**: Compare to everyday life
2. **Draw a diagram**: Use ASCII art to show flow
3. **Walk through the code**: Step-by-step explanation

For detailed reference, see [template.md](template.md).
Run: !`python ${CLAUDE_SKILL_DIR}/scripts/visualize.py`
```

### Skill Locations

| Location | Path | Applies to |
|----------|------|-----------|
| Personal | `~/.paw/skills/<name>/SKILL.md` or `~/.paw/skills/<name>.md` | All projects |
| Project | `.paw/skills/<name>/SKILL.md` or `.paw/skills/<name>.md` | This project only |

### Frontmatter Reference

```yaml
---
name: my-skill
description: What this skill does
argument-hint: [issue-number]
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash Read
context: fork
---
```

| Field | Description |
|-------|-------------|
| `name` | Skill name (becomes `/name` command) |
| `description` | When to use this skill (shown in autocomplete) |
| `argument-hint` | Hint shown in autocomplete (e.g. `[env]`) |
| `disable-model-invocation` | `true` = user-only, AI won't auto-invoke |
| `user-invocable` | `false` = hidden from `/` menu, AI-only |
| `allowed-tools` | Tools auto-approved when skill is active |
| `context` | `fork` = run in isolated subagent |

### Dynamic Features

**`$ARGUMENTS` substitution** — arguments passed after the skill name:

```md
Fix GitHub issue $ARGUMENTS following our coding standards.
Migrate $0 component from $1 to $2.
```

- `$ARGUMENTS` → full args string
- `$ARGUMENTS[0]`, `$0` → first argument
- `$ARGUMENTS[1]`, `$1` → second argument
- If no `$ARGUMENTS` in prompt, args are appended automatically

**`` !`command` `` dynamic injection** — shell commands executed before sending to AI:

```md
## Context
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -5`
- PR diff: !`gh pr diff`
```

**`${CLAUDE_SKILL_DIR}`** — resolves to the skill's directory path:

```md
Run the helper script:
!`python ${CLAUDE_SKILL_DIR}/scripts/analyze.py`
```

Skills load automatically on startup. Use `/skills` to list all available skills.

## Hooks

Hooks run shell commands at specific points in the REPL lifecycle. They receive event data via JSON stdin and can block actions via exit codes.

### Events

| Event | When | Matcher filters |
|-------|------|----------------|
| `pre-turn` | Before sending to the model | — |
| `post-turn` | After model responds | — |
| `pre-tool` | Before tool execution (can block) | Tool name |
| `post-tool` | After tool succeeds | Tool name |
| `post-tool-failure` | After tool fails | Tool name |
| `on-error` | When any error occurs | — |
| `session-start` | REPL session starts | Source |
| `session-end` | REPL session ends | Source |
| `stop` | After AI finishes responding (can block to continue) | — |
| `notification` | When a notification is sent | — |

### Configuration — Two formats

#### Markdown files (`.paw/hooks/*.md`):

```md
---
event: post-tool
command: npm run lint --silent 2>/dev/null || true
name: lint-on-tool
timeout: 15000
---
```

#### JSON settings (`.paw/settings.json`):

```json
{
  "hooks": {
    "pre-tool": [
      {
        "matcher": "run_shell",
        "hooks": [
          { "type": "command", "command": ".paw/hooks/validate-shell.sh" }
        ]
      }
    ],
    "post-tool": [
      {
        "matcher": "edit_file|write_file",
        "hooks": [
          { "type": "command", "command": "npx prettier --write $(jq -r '.tool_input.path')" }
        ]
      }
    ]
  }
}
```

### Matchers

Matchers filter hooks using regex against the event's context (tool name, source, etc.):

```json
"matcher": "run_shell"            // Only run_shell tool calls
"matcher": "edit_file|write_file" // Edit or write tool calls
"matcher": "mcp__.*"              // All MCP tools
```

No matcher = matches all events of that type.

### JSON stdin Input

Every hook receives event data as JSON via stdin:

```json
{
  "cwd": "/Users/dev/myproject",
  "hook_event_name": "pre-tool",
  "tool_name": "run_shell",
  "tool_input": { "command": "npm test" }
}
```

Parse with `jq`: `jq -r '.tool_input.command'`

### Exit Codes

| Exit code | Effect |
|-----------|--------|
| **0** | Proceed. stdout is injected into AI context |
| **2** | **Block** the action. stderr is sent as feedback |
| Other | Proceed. stderr is logged but not shown |

### Environment Variables

| Variable | Value |
|----------|-------|
| `PAW_EVENT` | The event name |
| `PAW_CWD` | Current working directory |
| `PAW_TOOL_NAME` | Tool name (for tool events) |

### Examples

**Block dangerous shell commands:**
```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q "drop table"; then
  echo "Blocked: dropping tables is not allowed" >&2
  exit 2
fi
exit 0
```

**Auto-format after file edits:**
```json
{
  "hooks": {
    "post-tool": [
      {
        "matcher": "edit_file|write_file",
        "hooks": [
          { "type": "command", "command": "jq -r '.tool_input.path' | xargs npx prettier --write" }
        ]
      }
    ]
  }
}
```

**Keep AI working until tests pass (stop hook):**
```json
{
  "hooks": {
    "stop": [
      {
        "hooks": [
          { "type": "command", "command": "npm test >/dev/null 2>&1 || (echo 'Tests failing, keep working' >&2; exit 2)" }
        ]
      }
    ]
  }
}
```

Hooks time out after 10s by default (configurable per hook via `timeout` in ms). All matching hooks run in parallel.

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
│ Active: codex/gpt-5.4                │
│ Select provider:                     │
│  > anthropic                         │
│    codex                             │
│    ollama                            │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
         ↓ Enter
╭─ Select model ───────────────────────╮
│  > gpt-5.4 — GPT-5.4                │
│    gpt-5.4-mini — GPT-5.4 Mini      │
│    o4-mini — o4 Mini                 │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
         ↓ Enter (Anthropic)
╭─ Select model ───────────────────────╮
│  > claude-haiku-4-5 — Haiku 4.5     │
│    claude-sonnet-4 — Sonnet 4        │
│    claude-sonnet-4-6 — Sonnet 4.6    │
│    claude-opus-4 — Opus 4            │
│    claude-opus-4-6 — Opus 4.6        │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
         ↓ Enter (Codex)
╭─ Select effort ──────────────────────╮
│    Low — Fast, lighter reasoning     │
│  > Medium — Balanced (default)       │
│    High — Complex problems           │
│    Extra High — Maximum depth        │
│  ↑↓ navigate  Enter select  Esc back │
╰──────────────────────────────────────╯
```

Direct command also works: `/model codex 3` or `/model ollama qwen3`

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
│  planner   codex/gpt-5.4            │
│  coder     codex/gpt-5.4            │
│  reviewer  codex/gpt-5.4            │
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

Roles assigned by efficiency scores (greedy unique-first). Adapts from real usage after 3+ runs per role. Scores stored in `~/.paw/team-scores.json`.

### Automatic Fallback

Provider fails → instantly tries next. Ollama = local fallback (free, no rate limits).

## Paw Exclusive Features

### `/spawn` — Parallel Sub-Agents

Spawn independent agents that work in parallel on different tasks. Unlike `/auto` (one agent, sequential) or `/team` (fixed pipeline), `/spawn` creates arbitrary agents that run simultaneously.

**Interactive (↑↓ panel):**

```
/spawn
╭─ Spawn Agent ──────────────────────────╮
│ Select provider:                        │
│  > anthropic — claude-sonnet-4-6       │
│    codex — gpt-5.4                     │
│    ollama — llama3                     │
╰────────────────────────────────────────╯
         ↓ Enter
╭─ Select model for anthropic ──────────╮
│  > claude-haiku-4-5 — Haiku 4.5       │
│    claude-sonnet-4-6 — Sonnet 4.6     │
╰────────────────────────────────────────╯
         ↓ Enter
╭─ Enter task: ─────────────────────────╮
│ > add tests for auth module_           │
╰────────────────────────────────────────╯
```

**Inline (fast):**

```
/spawn add tests for auth               ← round-robin provider
/spawn anthropic fix lint errors         ← specific provider
/spawn codex/gpt-5.4 update README      ← provider + model
```

**Works while AI is thinking** — `/spawn` and `/tasks` bypass the message queue:

```
you  explain the architecture        ← AI thinking...
you  /spawn add tests for auth       ← spawns immediately
you  /spawn update README            ← spawns immediately
you  /tasks                          ← shows status immediately

  ◉ #1 [running] add tests... (anthropic/claude-sonnet-4-6) 12s...
  ◉ #2 [running] update README (ollama/llama3) 8s...
  2 running, 0 done, 0 failed
```

**Manage tasks:**

```
/tasks              → status of all spawned agents
/tasks results      → detailed results of completed tasks
/tasks clear        → remove completed tasks from the list
```

- Each agent gets its own provider instance and tool access
- Providers distributed via round-robin or manual selection
- Auto-notifies in the chat when agents complete

### `/auto` — Autonomous Agent

Runs a self-driving agent that works until the task is done — no manual intervention.

```
/auto add input validation to all API endpoints
/auto refactor the auth module to use JWT
/auto fix all TypeScript errors in the project
```

Flow:
```
◉ Analyzing project...          (reads files, package.json)
✓ Creating plan...               (step-by-step actions)
◉ Executing step 1/10...        (reads/writes/runs commands)
◉ Executing step 2/10...
◉ Verifying...                   (runs build + tests)
✗ Build error found
◉ Fixing errors...               (auto-patches code)
◉ Verifying...
✓ All checks passed
✓ COMPLETED (32.4s)
```

- Plans work, executes with tools, verifies with build/test
- Auto-fixes errors and retries (max 10 iterations)
- Multi-provider: fallback if one provider fails mid-task

### `/pipe` — Shell Output → AI

Feeds real terminal output directly to the AI for analysis or automatic fixing.

```
/pipe npm test              → AI analyzes test failures
/pipe fix npm run build     → AI fixes build errors, re-runs until clean
/pipe fix tsc --noEmit      → AI fixes type errors automatically
/pipe watch npm start       → AI monitors startup output
```

Three modes:
| Mode | Command | What happens |
|------|---------|-------------|
| Analyze | `/pipe <cmd>` | Run → AI explains output |
| Fix | `/pipe fix <cmd>` | Run → AI fixes errors → re-run (loop, max 5) |
| Watch | `/pipe watch <cmd>` | Run with timeout → AI analyzes |

Example fix loop:
```
Running (1/5): npm run build
Errors found — fixing (1/5)...
Running (2/5): npm run build
Errors found — fixing (2/5)...
Running (3/5): npm run build
Pass — no errors
FIXED after 3 iteration(s) (18.2s)
```

### `/verify` — Trust Layer (Cross-Provider Verification)

After AI generates code, a different provider automatically reviews the changes for bugs, security issues, and logic errors.

```
/verify              → Open verify settings panel (↑↓)
```

Full arrow-key configuration — same pattern as `/model` and `/team`:

```
╭─ Verify Settings ──────────────────────╮
│ Status: OFF  Reviewer: auto            │
│  > Toggle ON/OFF                       │
│    Select reviewer provider            │
│    Auto (use different provider)       │
│  ↑↓ navigate  Enter select  Esc back   │
╰────────────────────────────────────────╯
         ↓ Select reviewer provider
╭─ Select reviewer provider ─────────────╮
│  > anthropic — claude-sonnet-4-6       │
│    codex — gpt-5.4                     │
│    ollama — llama3                     │
╰────────────────────────────────────────╯
         ↓ Select model
╭─ Select model for codex ──────────────╮
│  > gpt-5.4 — GPT-5.4                  │
│    gpt-5.4-mini — GPT-5.4 Mini        │
╰────────────────────────────────────────╯
         ↓ Select effort (Codex only)
╭─ Select effort level ─────────────────╮
│    Low — Fast, lighter reasoning       │
│  > Medium — Balanced (default)         │
│    High — Complex problems             │
│    Extra High — Maximum depth          │
╰────────────────────────────────────────╯
         ↓ Enter
~ Auto-verify: ON (reviewer: codex/gpt-5.4, effort: high)
```

When enabled, every turn that modifies files triggers a verification pass:

```
you  add user authentication endpoint
=^.^= [writes src/auth.ts, edits src/routes.ts]

---
Verification (by codex/gpt-5.4):
  Confidence: 85/100
  warning: src/auth.ts — Potential SQL injection in query builder
  info: src/routes.ts — Consider adding rate limiting
---
```

- **Full control**: choose reviewer provider, model, and effort level (Codex)
- Uses a **different provider** than the one that generated code (e.g. Anthropic generates → Codex reviews)
- **Auto mode**: automatically picks a different provider; falls back to same provider with a reviewer prompt if only one is available
- Checks: N+1 queries, race conditions, security vulnerabilities, logic errors, missing error handling

### `/safety` — Agent Safety Guards

Risk classification for every tool call. Blocks dangerous commands before they execute.

```
/safety              → Show current safety config
/safety on           → Enable safety guards (default)
/safety off          → Disable safety guards
```

Risk levels:

| Level | Tools | Action |
|-------|-------|--------|
| **Low** | `list_files`, `read_file`, `glob`, `search_text`, `web_fetch` | Execute immediately |
| **Medium** | `write_file`, `edit_file`, benign shell commands | Execute immediately |
| **High** | `rm`, `git reset`, `docker rm`, `terraform destroy`, `kubectl delete`, `npm publish`... | Blocked with warning |
| **Critical** | `rm -rf /`, `mkfs`, fork bombs, `curl\|sh`... | Blocked permanently |

High-risk operations automatically create a git checkpoint (`git stash`) before execution when `autoCheckpoint` is enabled.

```
=^.^= [run_shell blocked]
  ⚠️ High risk: "rm -rf dist/" matches destructive pattern.
  Safety policy blocked this command. Run manually if intended.
```

### Smart Router — Auto Mode Selection

No need to remember commands. Just type naturally — Paw picks the best execution mode automatically.

| You type | Paw routes to | Why |
|----------|--------------|-----|
| `npm test` | `/pipe` | Shell command detected |
| `implement JWT auth` | `/auto` | Complex implementation task |
| `review this code` | `/review` skill | Code review pattern |
| `이 코드 리뷰해줘` | `/review` skill | Korean skill match |
| `모든 에러 수정해줘` | `/auto` | Korean auto task |
| `tsc --noEmit` | `/pipe` | Shell command |
| `hello` | solo | Simple message |

Supports: English, Korean, Japanese, Chinese.
CJK-aware (shorter messages still trigger correctly).
Disable with explicit `/` commands to override routing.

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
| `/skills` | List all skills (built-in + custom) |
| `/hooks` | List loaded hooks and events |
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
| `/auto <task>` | Autonomous agent mode |
| `/pipe <cmd>` | Feed shell output to AI (fix/watch) |
| `/spawn` | Spawn parallel sub-agent (↑↓ or `/spawn <task>`) |
| `/tasks` | List spawned agents (status/results/clear) |
| `/verify` | Verify settings: reviewer provider/model/effort (↑↓) |
| `/safety` | Configure safety guards (on/off) |

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
anthropic:2r 1.5k $0.003  codex:5r  ollama:3r 8.2k  mcp: 1
TEAM/gpt-5.4               turns: 2  mcp: off           local
```

## Security

- **Safety system**: 4-tier risk classification (low/medium/high/critical) for all tool calls
- **Shell**: 25+ dangerous patterns blocked (rm, git reset, terraform destroy, kubectl delete, etc.)
- **Trust layer**: Cross-provider verification catches bugs before they land
- **Auto-checkpoint**: Git stash before high-risk operations
- **Search**: no shell injection (uses execFile, not shell)
- **Files**: symlink traversal protection (realpath check)
- **Web**: SSRF blocked (private IPs, metadata endpoints)
- **MCP**: safe env allowlist (API keys not leaked to child processes)
- **Credentials**: mode 0600
- **Glob**: ReDoS-safe regex conversion

## Files

| File | Purpose |
|------|---------|
| `~/.paw/credentials.json` | API keys (0600) |
| `~/.paw/sessions/*.json` | Session history (0600) |
| `~/.paw/team-scores.json` | Team performance |
| `~/.paw/skills/*.md` | User-wide custom skills |
| `~/.paw/hooks/*.md` | User-wide hooks |
| `.paw/skills/*.md` | Project-scoped custom skills |
| `.paw/hooks/*.md` | Project-scoped hooks |
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

### Skills

```
you  /review src/auth.ts
=^.^= Reviewing for bugs, security, and best practices...

you  /commit
=^.^= feat(auth): add JWT token validation with expiry check

you  /explain
=^.^= This module handles...
```

### Hooks

```md
# .paw/hooks/auto-test.md
---
event: post-tool
command: npm test --silent
name: auto-test
---
# → tests run automatically after every tool call
```

### Team Mode

```
you  /mode team
you  implement JWT auth

=^.^= Planning (codex/gpt-5.4)...
=^.^= Implementing (codex/gpt-5.4)...
=^.^= Reviewing (codex/gpt-5.4)...
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

you  /ask ollama review this code
=^.^= [ollama] LGTM with one suggestion...
```

### Fallback

```
you  analyze this codebase
[Fallback: ollama/qwen3]
  Rate limit hit. Switched automatically.
```

## Changelog

### Major Milestones

1. **Initial release** — Multi-provider REPL with Ink UI, 8 tools, cat theme
2. **MCP support** — stdio/HTTP/SSE transport, interactive manager, CLI commands
3. **Team mode** — 5-agent pipeline with parallel execution, efficiency scoring
4. **Auto-detect** — Codex login, no startup prompt needed
5. **Arrow-key UI** — All panels redesigned for ↑↓ + Enter + Esc
6. **Plan-aware models** — Subscription-based filtering, live Ollama detection
7. **Codex provider** — Replaced OpenAI API with Codex CLI (ChatGPT subscription)
8. **Effort levels** — Configurable per model and per team role
9. **Sessions** — Auto-save, resume, real-time sync across terminals
10. **Korean IME** — Native stdin handling, smooth CJK input
11. **Security audit** — 14 vulnerabilities fixed (injection, SSRF, symlink, permissions)
12. **`paw` CLI** — 3-character global command
13. **Skills system** — 7 built-in skills + user/project custom skills via Markdown files
14. **Hooks system** — Event-driven automation with 7 lifecycle events via Markdown config
15. **Anthropic provider** — API key mode with per-token pricing
16. **`/auto` mode** — Autonomous plan→execute→verify→fix agent loop
17. **`/pipe` mode** — Shell output → AI analysis/fix/watch
18. **Smart Router** — Auto-detect best mode from message content (multilingual)
19. **Trust Layer** — `/verify` cross-provider code verification with provider/model/effort selection (↑↓)
20. **Agent Safety** — `/safety` 4-tier risk classification, destructive command blocking, auto git checkpoint
21. **Skills upgrade** — Directory-based SKILL.md, $ARGUMENTS substitution, !`command` injection, extended frontmatter
22. **Hooks upgrade** — Claude Code-style: matchers, JSON stdin, exit code blocking, settings.json config, 10 events
23. **`/spawn` mode** — Parallel sub-agent spawning with provider/model selection, runs even while AI is thinking
24. **`/tasks` dashboard** — Monitor, view results, and manage spawned agents

## License

MIT
