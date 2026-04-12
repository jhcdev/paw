# Paw 🐱

```
  /\_/\   Paw
 ( o.o )  Too lazy to pick one AI. So I use them all.
  > ^ <
```

**The multi-provider AI coding agent for the terminal.** Use Anthropic, OpenAI Codex, Ollama, and vLLM/OpenAI-compatible endpoints — with automatic fallback, parallel sub-agents, cross-provider verification, and built-in safety. Not tied to one model, not tied to one provider. Switch with `/model` — no code changes, no lock-in.

<table>
<tr><td><b>Multi-provider, zero lock-in</b></td><td>Anthropic (Claude), Codex (ChatGPT subscription), Ollama (local/free), and vLLM/OpenAI-compatible endpoints — all available behind one CLI. Rate limit on Claude? Auto-switches to Codex. Need self-hosted inference? Point Paw at your vLLM server.</td></tr>
<tr><td><b>Problem Classifier</b></td><td>Every prompt is instantly classified into a category (security, debugging, architecture, performance, testing, data, API, web, DevOps, refactoring, explanation). The right features activate automatically — no flags needed.</td></tr>
<tr><td><b>Live Activity Display</b></td><td>Every tool call shown in real time: color-coded icons (Read=cyan, Write=yellow, Bash=magenta, Search=blue), elapsed time, result summary. AI intermediate responses stream live between tool calls so you always see what the agent is doing.</td></tr>
<tr><td><b>Cross-session skill learning</b></td><td>Successful auto-agent tasks are recorded across sessions. Repeated patterns auto-generate reusable skills. Bad patterns self-correct via confidence decay. Fully under user control via <code>/memory</code>.</td></tr>
<tr><td><b>Parallel sub-agents</b></td><td>Spawn independent agents that work in background while you keep chatting. Each spawned agent inherits your current model and session context.</td></tr>
<tr><td><b>Cross-provider verification</b></td><td>AI writes code → a <i>different</i> AI reviews it automatically. Paw also runs local checks (typecheck/build/test/lint when available), summarizes blockers inline, and keeps browsable verification logs across sessions.</td></tr>
<tr><td><b>Agent safety</b></td><td>Every tool call is risk-classified in real-time. Destructive commands (rm -rf, mkfs, curl|sh) are blocked before they execute. High-risk operations auto-checkpoint via git stash.</td></tr>
<tr><td><b>Cross-session memory</b></td><td>PAW.md hierarchy — global instructions, project instructions, personal notes, and auto-learned context. Memory injected on session start, survives compaction, persists across sessions.</td></tr>
<tr><td><b>Skills + Hooks</b></td><td>7 built-in slash commands + unlimited custom skills with $ARGUMENTS, !`command` injection, and SKILL.md directories. 10 lifecycle hook events with regex matchers, JSON stdin, and exit-code blocking.</td></tr>
<tr><td><b>AI-powered compaction</b></td><td>Conversation too long? Auto-compact summarizes old turns via AI, keeps recent messages intact, re-injects PAW.md. Manual <code>/compact [focus]</code> for targeted compression.</td></tr>
<tr><td><b>Smart Router</b></td><td>Just type naturally — Paw auto-detects the best mode from your message. Works in English, Korean, Japanese, and Chinese.</td></tr>
</table>

> **Disclaimer:** Paw is an independent, third-party project. Not affiliated with Anthropic, OpenAI, or any AI provider.

---

## Quick Install

```bash
git clone https://github.com/jhcdev/paw.git
cd paw
npm install
npm link
```

Works on Linux, macOS, and WSL2. Requires Node.js 22+ and at least one provider (Anthropic API key, Codex CLI, Ollama, or vLLM).

After installation:

```bash
paw                                    # Auto-detect providers and start
paw "explain this project"             # Direct prompt
paw --continue                         # Resume last session
paw --provider codex                   # Force specific provider
paw --provider vllm                    # Use your vLLM/OpenAI-compatible server
```

---

## Getting Started

```bash
paw                          # Interactive REPL — start coding
paw --provider ollama        # Force a specific provider
paw --provider vllm          # Force vLLM
paw --continue               # Resume last session
paw --session abc123         # Join specific session
paw --help                   # All flags and MCP commands
paw mcp list                 # List connected MCP servers
paw --logout                 # Remove saved credentials
```

---

## Providers

| Provider | Auth | Models | Cost |
|----------|------|--------|------|
| **Anthropic** | `ANTHROPIC_API_KEY` | Haiku 4.5, Sonnet 4/4.6, Opus 4/4.6 | Per-token |
| **Codex** | `codex login` | GPT-5.4, GPT-5.3, o4 Mini, o3 | ChatGPT subscription |
| **Ollama** | (none) | Any pulled model | Free (local) |
| **vLLM** | `VLLM_API_KEY` optional | Any model exposed via `/v1/models` | Self-hosted |

```bash
# Anthropic — set in .env or configure via /settings
ANTHROPIC_API_KEY=sk-ant-api03-...

# Codex — install CLI and login
npm install -g @openai/codex && codex login

# Ollama — pull a model and go
ollama pull qwen3

# vLLM — point Paw at your OpenAI-compatible endpoint
VLLM_BASE_URL=http://localhost:8000
VLLM_MODEL=auto
# optional
VLLM_API_KEY=dummy
```

**Coming soon:** Gemini, Groq, OpenRouter.

---

## Live Activity Display

Every tool call and AI response is shown in real time while the agent works:

```
=^.^= ◉ Executing step 2/5

  ✓ Read     src/cli.tsx             0.3s  ⎿  245 lines
  ✓ Search   "thinkMsg"              0.1s  ⎿  8 results
  ✓ Bash     npm run build           1.2s
  ◉ Write    src/output.ts

  I'll now update the render section to add the new...
```

| Icon | Meaning |
|------|---------|
| `◉` | Tool running / step in progress |
| `✓` | Tool completed (elapsed time + result shown) |

Tool colors:

| Color | Tools |
|-------|-------|
| Cyan | `Read`, `List` |
| Yellow | `Write`, `Update` |
| Magenta | `Bash` |
| Blue | `Search`, `Glob` |
| Green | `Fetch` |

AI intermediate responses stream between tool calls so you see reasoning as it happens, not just the final answer.

---

## Agent Modes

### Solo (default)

Single provider handles all messages. Switch models anytime with `/model`.

### Team (`/team`)

5 agents collaborate on every message:

| Role | Job | Execution |
|------|-----|-----------|
| Planner | Architecture & plan | Sequential |
| Coder | Implementation | Sequential |
| Reviewer | Bugs, security, correctness | **Parallel** |
| Tester | Test case generation | **Parallel** |
| Optimizer | Performance improvements | Sequential |

Roles auto-assigned by efficiency scores. Review → rework loop (MAJOR → recode → re-review, max 3x).

### `/auto` — Autonomous Agent

Self-driving agent: analyze → plan → execute → verify → fix, until done.

```
/auto add input validation to all API endpoints

◉ Analyzing project...
✓ Creating plan...
◉ Executing step 1/10...
  ✓ Read    src/api/auth.ts         0.2s
  ✓ Search  "validate"              0.1s  ⎿  3 results
  ◉ Write   src/api/auth.ts

◉ Verifying...
✗ Build error found
◉ Fixing errors...
✓ All checks passed
✓ COMPLETED (32.4s)
```

### `/spawn` — Parallel Sub-Agents

Spawn independent agents that work in parallel — even while the main AI is thinking.

```
you  explain the architecture        ← main AI starts working
you  /spawn add tests for auth       ← runs immediately in background
you  /spawn update README            ← another agent, same or different provider
you  /agents                         ← check all agent progress and details
```

### `/agents` — Agent Activity Browser

```
/agents               → summary + interactive browser
/agents search auth   → filter by keyword
/agents latest        → latest agent detail
/agents list          → print unified overview
/agents results       → completed spawn results
/agents clear         → clear completed tasks
```

### `/pipe` — Shell Output → AI

```
/pipe npm test              → AI analyzes test failures
/pipe fix npm run build     → AI fixes errors, re-runs until clean (max 5)
/pipe watch npm start       → AI monitors startup output
```

---

## Smart Router + Problem Classifier

Just type naturally — Paw picks the best mode and auto-activates the right features:

| You type | Category detected | Routed to | Auto-activated |
|----------|-------------------|-----------|----------------|
| `npm test` | — | `/pipe` | — |
| `fix the JWT auth vulnerability` | Security | `/auto` + team | auto-verify ON |
| `why does the app crash?` | Debugging | `/auto` | auto-verify ON |
| `design a microservice architecture` | Architecture | team | team review |
| `write unit tests for the auth module` | Testing | `/test` skill | auto-verify ON |
| `review this code` | — | `/review` skill | — |
| `이 코드 리뷰해줘` | — | `/review` skill | — |
| `보안 취약점 찾아서 고쳐줘` | Security | `/auto` + team | auto-verify ON |

Supports: English, Korean, Japanese, Chinese.

Categories: `security` · `debugging` · `architecture` · `performance` · `testing` · `data` · `api` · `web` · `devops` · `refactoring` · `explanation`

---

## Cross-Session Skill Learning

Paw automatically learns from every successful `/auto` run across sessions.

### How it works

```
1st JWT auth fix   → recorded in ~/.paw/learned-tasks.json
2nd JWT auth fix   → past context injected automatically
3rd JWT auth fix   → auto-skill created: /auto-security-auth
```

Every learned task carries a **confidence score** (0–1) that self-corrects:

| Event | Effect |
|-------|--------|
| Task succeeds | Similar patterns +0.1 confidence (cap 1.0) |
| Task fails | Similar patterns −0.3 confidence |
| Confidence < 0.15 | Pattern auto-pruned |
| Auto-skill has < 2 backing patterns | Skill file auto-deleted |

Only patterns with confidence ≥ 0.4 are injected as context.

### User control — all via `/memory`

Learning is integrated into the existing `/memory` command alongside PAW.md:

```bash
/memory              # PAW.md sources + learned pattern summary + current mode
/memory auto         # learn silently, create skills automatically (default)
/memory ask          # learn silently, ask before creating skills
/memory off          # disable learning and context injection entirely

/memory yes          # confirm pending skill creation (ask mode)
/memory no           # skip pending skill creation (ask mode)

/memory forget <skill>           # delete skill + backing patterns
/memory forget --category <cat>  # purge all patterns for a category
/memory forget --all             # wipe the entire learned store
```

---

## Trust & Safety

### `/verify` — Cross-Provider Verification

AI generates code → a different AI reviews it. Paw also runs local verification checks when available.

```
---
Verification (by codex/gpt-5.4):
  Status: BLOCKED
  Confidence: 85/100
  Blocking summary:
    - test: failing suite
  Checks:
    ✗ npm run --silent test
      ↳ failing suite
  [error] src/auth.ts: Potential SQL injection
---
```

```bash
/verify        # reviewer / effort settings
/verify logs   # browse recent verification runs
```

### `/safety` — Risk Classification

| Level | Examples | Action |
|-------|---------|--------|
| **Low** | `read_file`, `search_text`, `glob` | Execute immediately |
| **Medium** | `write_file`, `edit_file`, `npm run build` | Execute immediately |
| **High** | `rm`, `git reset`, `terraform destroy` | Blocked + git checkpoint |
| **Critical** | `rm -rf /`, `mkfs`, `curl\|sh` | Permanently blocked |

25+ dangerous patterns blocked. Symlink traversal protection. SSRF blocked. Shell injection prevented.

---

## Memory

Cross-session memory via `PAW.md` hierarchy + learned task patterns:

| File | Scope | Shared |
|------|-------|--------|
| `~/.paw/PAW.md` | All projects | No |
| `./PAW.md` or `.paw/PAW.md` | This project | Yes (commit to repo) |
| `./PAW.local.md` | This project, personal | No (git-ignored) |
| `~/.paw/memory/` | Auto-learned context | No |
| `~/.paw/learned-tasks.json` | Cross-session task patterns | No |

```bash
/memory              # view memory sources + learned patterns
/remember <note>     # save note across sessions
/sessions <query>    # search and summarize past sessions
/compact [focus]     # AI-powered conversation compression
/export              # export full context as markdown
/export chat         # export conversation only
```

---

## Skills

7 built-in + unlimited custom. `$ARGUMENTS`, `` !`command` `` injection, `SKILL.md` directories.

| Built-in | Description |
|----------|-------------|
| `/review` | Bugs, security, best practices |
| `/refactor` | Refactoring improvements |
| `/test` | Generate test cases |
| `/explain` | Explain code in detail |
| `/optimize` | Performance optimization |
| `/document` | Generate documentation |
| `/commit` | Conventional commit from diff |

**Custom skill** — `.paw/skills/deploy.md`:

```yaml
---
name: deploy
description: Deploy the application
argument-hint: [environment]
---

Deploy $ARGUMENTS to production.
Current branch: !`git branch --show-current`
```

**Auto-learned skills** — after 3 similar `/auto` tasks, a global skill is auto-created in `~/.paw/skills/auto-<category>-<keyword>.md`. Manage via `/memory`.

---

## Hooks

10 lifecycle events. Regex matchers. JSON stdin. Exit 2 = block.

| Event | When | Can Block |
|-------|------|-----------|
| `pre-turn` | Before sending to model | — |
| `post-turn` | After model responds | — |
| `pre-tool` | Before tool execution | Yes |
| `post-tool` | After tool succeeds | — |
| `post-tool-failure` | After tool fails | — |
| `on-error` | On any error | — |
| `session-start` | REPL starts | — |
| `session-end` | REPL ends | — |
| `stop` | AI finishes responding | Yes |
| `notification` | Notification sent | — |

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

Exit 0 = proceed. Exit 2 = block. Env: `PAW_EVENT`, `PAW_CWD`, `PAW_TOOL_NAME`.

---

## Tools & MCP

### 9 Built-in Tools

`list_files` · `read_file` · `read_image` · `write_file` · `edit_file` · `search_text` · `run_shell` · `glob` · `web_fetch`

### MCP (Model Context Protocol)

```bash
paw mcp add --transport http github https://api.github.com/mcp
paw mcp add --transport stdio memory -- npx -y @modelcontextprotocol/server-memory
paw mcp list
paw mcp remove github
```

Interactive manager via `/mcp`. Supports stdio, HTTP, SSE. Tools auto-injected into all providers.

---

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | All commands |
| `/status` | Providers, usage, cost |
| `/settings` | Provider API key management |
| `/model` | Model catalog & switch |
| `/team` | Team dashboard & collaboration |
| `/spawn` | Spawn parallel sub-agent |
| `/agents` | Unified agent activity & spawn status |
| `/auto <task>` | Autonomous agent mode |
| `/pipe <cmd>` | Shell output → AI (fix/watch subcommands) |
| `/verify` | Cross-provider verification settings |
| `/verify logs` | Browse verification history |
| `/safety` | Safety guard configuration |
| `/memory` | PAW.md + learned patterns + learning mode (auto\|ask\|off\|forget) |
| `/memory yes\|no` | Confirm/skip pending auto-skill creation (ask mode) |
| `/remember <note>` | Save note to memory |
| `/sessions` | List sessions + current ID |
| `/sessions <query>` | Search & summarize past sessions |
| `/export` | Export full context as markdown |
| `/export chat` | Export conversation only |
| `/compact [focus]` | AI-powered conversation compression |
| `/skills` | List all skills |
| `/hooks` | List configured hooks |
| `/ask <provider> <prompt>` | Query specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager |
| `/git` | Status + diff + log |
| `/init` | Generate CONTEXT.md |
| `/doctor` | Diagnostics |
| `/clear` | Reset conversation |
| `/exit` | Quit |

**Keyboard:** `↑↓` navigate · `Enter` select · `Tab` autocomplete · `Esc` back · `Ctrl+C` interrupt · `Ctrl+L` clear · `Ctrl+K` compact

---

## Files

| File | Purpose |
|------|---------|
| `~/.paw/credentials.json` | API keys (0600) |
| `~/.paw/sessions/*.json` | Session history + verification history |
| `~/.paw/team-scores.json` | Team performance scores |
| `~/.paw/PAW.md` | Global instructions |
| `~/.paw/memory/` | Auto-learned memory |
| `~/.paw/skills/*.md` | User-wide custom skills (incl. auto-generated `auto-*`) |
| `~/.paw/hooks/*.md` | User-wide hooks |
| `~/.paw/learned-tasks.json` | Cross-session task patterns with confidence scores |
| `~/.paw/learn-config.json` | Learning mode preference (auto/ask/off) |
| `PAW.md` | Project instructions |
| `PAW.local.md` | Personal project notes |
| `.paw/skills/*.md` | Project skills |
| `.paw/hooks/*.md` | Project hooks |
| `.paw/settings.json` | Project settings |
| `.mcp.json` | MCP server config |

---

## Contributing

```bash
git clone https://github.com/jhcdev/paw.git
cd paw
npm install
npm test              # 390 tests
npm run build         # TypeScript → dist/
npm link              # Install 'paw' command globally
```

---

## License

MIT — see [LICENSE](LICENSE).
