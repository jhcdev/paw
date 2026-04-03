import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import pc from "picocolors";
import type { ProviderName } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".cats-claw");
const CONFIG_FILE = path.join(CONFIG_DIR, "credentials.json");

type StoredCredentials = Partial<Record<ProviderName, { apiKey: string; model?: string }>>;

async function loadCredentials(): Promise<StoredCredentials> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return {};
  }
}

async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

const PROVIDERS: { name: ProviderName; label: string; emoji: string; description: string; defaultModel: string; needsKey: boolean }[] = [
  { name: "anthropic", label: "Anthropic", emoji: "~", description: "Claude models", defaultModel: "claude-sonnet-4-20250514", needsKey: true },
  { name: "openai", label: "OpenAI", emoji: "~", description: "GPT models", defaultModel: "gpt-5-mini", needsKey: true },
  { name: "gemini", label: "Gemini", emoji: "~", description: "Google Gemini (strong long-context)", defaultModel: "gemini-2.5-flash", needsKey: true },
  { name: "groq", label: "Groq", emoji: "~", description: "Fast inference, open models", defaultModel: "openai/gpt-oss-20b", needsKey: true },
  { name: "openrouter", label: "OpenRouter", emoji: "~", description: "Multi-model hub, max flexibility", defaultModel: "anthropic/claude-sonnet-4", needsKey: true },
  { name: "ollama", label: "Ollama", emoji: "~", description: "Local models, no key needed", defaultModel: "qwen3", needsKey: false },
];

function createRl(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function catBox(lines: string[]): string {
  const maxLen = Math.max(...lines.map((l) => l.length));
  const top = `  ╭${"─".repeat(maxLen + 2)}╮`;
  const bot = `  ╰${"─".repeat(maxLen + 2)}╯`;
  const body = lines.map((l) => `  │ ${l.padEnd(maxLen)} │`).join("\n");
  return `${top}\n${body}\n${bot}`;
}

export async function interactiveLogin(overrides?: {
  provider?: ProviderName;
  model?: string;
}): Promise<{ provider: ProviderName; apiKey: string; model: string; baseUrl?: string }> {
  const rl = createRl();
  const creds = await loadCredentials();

  let provider: ProviderName;

  if (overrides?.provider) {
    provider = overrides.provider;
  } else {
    const banner = [
      "  /\\_/\\",
      " ( o.o )  Cat's Claw",
      "  > ^ <   Scratch your code into shape~",
    ];
    process.stdout.write(`\n${pc.red(banner.join("\n"))}\n\n`);

    const providerLines = PROVIDERS.map((p, i) => {
      const num = pc.bold(pc.red(String(i + 1)));
      const label = pc.bold(p.label);
      const saved = creds[p.name] ? pc.green(" (saved)") : "";
      return `  ${num}. ${p.emoji} ${label}${saved} — ${pc.gray(p.description)}`;
    });
    process.stdout.write(`  Pick a brain for this cat:\n\n`);
    providerLines.forEach((l) => process.stdout.write(`${l}\n`));
    process.stdout.write("\n");

    const choice = await rl.question(`  ${pc.red("=^.^=")} ${pc.bold("Choose (1-" + PROVIDERS.length + "):")} `);
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= PROVIDERS.length) {
      rl.close();
      throw new Error("Hiss! Invalid choice.");
    }
    provider = PROVIDERS[idx]!.name;
    process.stdout.write(`\n  ${pc.green("~")} ${pc.bold(PROVIDERS[idx]!.label)} selected! Purrrr~\n\n`);
  }

  const providerInfo = PROVIDERS.find((p) => p.name === provider)!;
  let apiKey = "";

  if (providerInfo.needsKey) {
    const saved = creds[provider];

    if (!apiKey && saved?.apiKey) {
      const masked = "***..." + saved.apiKey.slice(-4);
      const reuse = await rl.question(`  ${pc.red("=^.^=")} Use saved key (${pc.gray(masked)})? [Y/n]: `);
      if (!reuse || reuse.toLowerCase() !== "n") {
        apiKey = saved.apiKey;
        process.stdout.write(`  ${pc.green("~")} Using saved key~ meow\n`);
      }
    }

    if (!apiKey) {
      apiKey = await rl.question(`  ${pc.red("=^.^=")} ${providerInfo.label} API key: `);
      apiKey = apiKey.trim();
      if (!apiKey) {
        rl.close();
        throw new Error(`Hiss! ${providerInfo.label} API key is required.`);
      }

      const doSave = await rl.question(`  ${pc.red("=^.^=")} Save key for next time? [Y/n]: `);
      if (!doSave || doSave.toLowerCase() !== "n") {
        creds[provider] = { apiKey, model: providerInfo.defaultModel };
        await saveCredentials(creds);
        process.stdout.write(`  ${pc.green("~")} Saved! ${pc.gray(CONFIG_FILE)}\n`);
      }
    }
  }

  let model = overrides?.model ?? "";
  if (!model) {
    const savedModel = creds[provider]?.model ?? providerInfo.defaultModel;
    const modelInput = await rl.question(`  ${pc.red("=^.^=")} Model [${pc.gray(savedModel)}]: `);
    model = modelInput.trim() || savedModel;

    if (creds[provider]) {
      creds[provider]!.model = model;
      await saveCredentials(creds);
    }
  }

  rl.close();

  const baseUrl = resolveBaseUrl(provider);

  const summary = catBox([
    `Provider: ${providerInfo.label}`,
    `Model:    ${model}`,
    `Config:   ~/.cats-claw/`,
  ]);
  process.stdout.write(`\n${pc.red(summary)}\n`);
  process.stdout.write(`\n  ${pc.red("=^.^=")} ${pc.bold("Let's go!")} meow~\n\n`);

  return { provider, apiKey, model, baseUrl };
}

export async function logout(provider?: ProviderName): Promise<void> {
  const creds = await loadCredentials();
  if (provider) {
    delete creds[provider];
    process.stdout.write(`  =^.^= Forgot ${provider} credentials~ bye bye\n`);
  } else {
    for (const key of Object.keys(creds)) delete creds[key as ProviderName];
    process.stdout.write("  =^.^= Forgot everything~ fresh start!\n");
  }
  await saveCredentials(creds);
}

export async function listSavedProviders(): Promise<void> {
  const creds = await loadCredentials();
  const saved = Object.keys(creds).filter((k) => creds[k as ProviderName]?.apiKey);
  if (saved.length === 0) {
    process.stdout.write("  =^.^= No saved credentials. I remember nothing~\n");
    return;
  }
  process.stdout.write(`  =^.^= Saved credentials:\n\n`);
  for (const p of saved) {
    const key = creds[p as ProviderName]!.apiKey;
    const masked = "***..." + key.slice(-4);
    const model = creds[p as ProviderName]!.model ?? "(default)";
    process.stdout.write(`    ${pc.red("~")} ${pc.bold(p)}: ${pc.gray(masked)} | model: ${model}\n`);
  }
  process.stdout.write("\n");
}

function resolveBaseUrl(provider: ProviderName): string | undefined {
  switch (provider) {
    case "groq": return "https://api.groq.com/openai/v1";
    case "openrouter": return process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
    case "ollama": return process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
    default: return undefined;
  }
}
