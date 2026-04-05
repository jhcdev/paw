# Paw 🐱

```
  /\_/\   Paw
 ( o.o )  Too lazy to pick one AI. So I use them all.
  > ^ <
```

**The multi-provider AI coding agent for the terminal.** Use Anthropic, OpenAI Codex, and Ollama simultaneously — with automatic fallback, parallel sub-agents, cross-provider verification, and built-in safety. Not tied to one model, not tied to one provider. Switch with `/model` — no code changes, no lock-in.

<table>
<tr><td><b>Multi-provider, zero lock-in</b></td><td>Anthropic (Claude), Codex (ChatGPT subscription), and Ollama (local/free) — all active at once. Rate limit on Claude? Auto-switches to Codex. Need free local inference? Ollama is always there. No manual intervention.</td></tr>
<tr><td><b>Parallel sub-agents</b></td><td>Spawn independent agents that work in background while you keep chatting. Each spawned agent inherits your current model and session context. Round-robin across providers or pin to a specific one.</td></tr>
<tr><td><b>Cross-provider verification</b></td><td>AI writes code → a <i>different</i> AI reviews it automatically. Catches N+1 queries, race conditions, injection vulnerabilities, and logic errors that single-model tools miss.</td></tr>
<tr><td><b>Agent safety</b></td><td>Every tool call is risk-classified in real-time. Destructive commands (rm -rf, mkfs, curl|sh) are blocked before they execute. High-risk operations auto-checkpoint via git stash.</td></tr>
<tr><td><b>Cross-session memory</b></td><td>PAW.md hierarchy — global instructions, project instructions, personal notes, and auto-learned context. Memory injected on session start, survives compaction, persists across sessions.</td></tr>
<tr><td><b>Skills + Hooks</b></td><td>7 built-in slash commands + unlimited custom skills with $ARGUMENTS, !`command` injection, and SKILL.md directories. 10 lifecycle hook events with regex matchers, JSON stdin, and exit-code blocking.</td></tr>
<tr><td><b>AI-powered compaction</b></td><td>Conversation too long? Auto-compact summarizes old turns via AI, keeps recent messages intact, re-injects PAW.md. Manual <code>/compact [focus]</code> for targeted compression.</td></tr>
<tr><td><b>Smart Router</b></td><td>Just type naturally — Paw auto-detects the best mode from your message. Works in English, Korean, Japanese, and Chinese. Shell commands → /pipe, implementation tasks → /auto, code review → /review skill.</td></tr>
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

Works on Linux, macOS, and WSL2. Requires Node.js 22+ and at least one provider (Anthropic API key, Codex CLI, or Ollama).

After installation:

```bash
paw                                    # Auto-detect providers and start
paw "explain this project"             # Direct prompt
paw --continue                         # Resume last session
paw --provider codex                   # Force specific provider
```

---

## Getting Started

```bash
paw                          # Interactive REPL — start coding
paw --provider ollama        # Force a specific provider
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

```bash
# Anthropic — set in .env or configure via /settings
ANTHROPIC_API_KEY=sk-ant-api03-...

# Codex — install CLI and login
npm install -g @openai/codex && codex login

# Ollama — pull a model and go
ollama pull qwen3
```

**Coming soon:** Gemini, Groq, OpenRouter.

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

Roles auto-assigned by efficiency scores. Adapts from real usage after 3+ runs. Review → rework loop (MAJOR → recode → re-review, max 3x).

### `/auto` — Autonomous Agent

Self-driving agent: analyze → plan → execute → verify → fix, until done.

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

Spawn independent agents that work in parallel — even while the main AI is thinking.

```
you  explain the architecture        ← main AI starts working
you  /spawn add tests for auth       ← runs immediately in background
you  /spawn update README            ← another agent, same or different provider
you  /tasks                          ← check progress anytime
```

- Uses your current `/model` selection (follows changes automatically)
- Receives session context (last 10 entries) — understands what you're working on
- Completed results auto-injected into your next turn
- Interactive panel (`/spawn`) or inline (`/spawn codex/gpt-5.4 fix lint`)

### `/pipe` — Shell Output → AI

```
/pipe npm test              → AI analyzes test failures
/pipe fix npm run build     → AI fixes errors, re-runs until clean (max 5)
/pipe watch npm start       → AI monitors startup output
```

### Smart Router

Just type naturally — Paw picks the best mode:

| You type | Routed to |
|----------|-----------|
| `npm test` | `/pipe` |
| `implement JWT auth` | `/auto` |
| `review this code` | `/review` skill |
| `이 코드 리뷰해줘` | `/review` skill |
| `모든 에러 수정해줘` | `/auto` |

Supports: English, Korean, Japanese, Chinese.

---

## Trust & Safety

### `/verify` — Cross-Provider Verification

AI generates code → a different AI reviews it. Choose reviewer via ↑↓ panel.

```
---
Verification (by codex/gpt-5.4):
  Confidence: 85/100
  warning: src/auth.ts — Potential SQL injection
  info: src/routes.ts — Consider rate limiting
---
```

### `/safety` — Risk Classification

| Level | Examples | Action |
|-------|---------|--------|
| **Low** | `read_file`, `search_text`, `glob` | Execute immediately |
| **Medium** | `write_file`, `edit_file`, `npm run build` | Execute immediately |
| **High** | `rm`, `git reset`, `terraform destroy` | Blocked + git checkpoint |
| **Critical** | `rm -rf /`, `mkfs`, `curl\|sh` | Permanently blocked |

25+ dangerous patterns blocked. Symlink traversal protection. SSRF blocked. Shell injection prevented. MCP env allowlist.

---

## Memory

Cross-session memory via `PAW.md` hierarchy:

| File | Scope | Shared |
|------|-------|--------|
| `~/.paw/PAW.md` | All projects | No |
| `./PAW.md` or `.paw/PAW.md` | This project | Yes (commit to repo) |
| `./PAW.local.md` | This project, personal | No (git-ignored) |
| `~/.paw/memory/` | Auto-learned context | No (auto-managed) |

Memory injected into first prompt of each session. Survives `/compact`.

```
/memory             → view loaded sources
/remember <note>    → save note across sessions
/compact [focus]    → AI-powered conversation compression
/export             → export full context as markdown
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

**Directory-based** — `.paw/skills/analyze/SKILL.md` with supporting files and scripts.

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

Exit 0 = proceed (stdout → AI context). Exit 2 = block (stderr → AI feedback). Env: `PAW_EVENT`, `PAW_CWD`, `PAW_TOOL_NAME`.

---

## Tools & MCP

### 8 Built-in Tools

`list_files` · `read_file` · `write_file` · `edit_file` · `search_text` · `run_shell` · `glob` · `web_fetch`

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
| `/settings` | Provider management (↑↓) |
| `/model` | Model catalog & switch (↑↓) |
| `/team` | Team dashboard (↑↓) |
| `/spawn` | Spawn parallel sub-agent (↑↓) |
| `/tasks` | Spawned agent status/results |
| `/auto <task>` | Autonomous agent mode |
| `/pipe <cmd>` | Shell output → AI |
| `/verify` | Cross-provider verification (↑↓) |
| `/safety` | Safety guards |
| `/memory` | View loaded memory |
| `/remember <note>` | Save note across sessions |
| `/export` | Export full context as markdown |
| `/compact [focus]` | AI-powered conversation compression |
| `/skills` | List all skills |
| `/hooks` | List configured hooks |
| `/ask <provider> <prompt>` | Query specific provider |
| `/tools` | Built-in + MCP tools |
| `/mcp` | MCP server manager (↑↓) |
| `/git` | Status + diff + log |
| `/sessions` | List past sessions |
| `/history` | Export chat to markdown |
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
| `~/.paw/sessions/*.json` | Session history |
| `~/.paw/team-scores.json` | Team performance scores |
| `~/.paw/PAW.md` | Global instructions |
| `~/.paw/memory/` | Auto-learned memory |
| `~/.paw/skills/*.md` | User-wide custom skills |
| `~/.paw/hooks/*.md` | User-wide hooks |
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
npm test              # 263 tests
npm run build         # TypeScript → dist/
npm link              # Install 'paw' command globally
```

---

## License

MIT — see [LICENSE](LICENSE).
