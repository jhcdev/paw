# Cat's Claw 🐱

Scratch your code into shape.

## Supported Providers

| Provider | Key Required | Notes |
|----------|-------------|-------|
| Anthropic | `ANTHROPIC_API_KEY` | Direct Claude API |
| OpenAI | `OPENAI_API_KEY` | GPT models |
| Gemini | `GEMINI_API_KEY` | Google Gemini API |
| Groq | `GROQ_API_KEY` | Fast inference |
| OpenRouter | `OPENROUTER_API_KEY` | Multi-model hub |
| Ollama | (none) | Local models |

## Requirements

- Node.js 22+
- npm

## Installation

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
```

## Usage

Interactive REPL:

```bash
npm start
```

One-shot prompt:

```bash
npm start -- "summarize this project"
```

With provider/model override:

```bash
npm start -- --provider gemini --model gemini-2.5-pro
npm start -- --provider openai --model gpt-5-mini
npm start -- --provider ollama --model qwen3
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories |
| `read_file` | Read a text file |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace a unique string in a file |
| `search_text` | Search for patterns with ripgrep/grep |
| `run_shell` | Execute shell commands |

## REPL Commands

- `/help` — show commands
- `/tools` — list available tools
- `/clear` — reset conversation
- `/exit` or `Esc` — quit

## Environment Variables

See `.env.example` for all supported variables.

## License

MIT
