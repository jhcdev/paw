import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { toolDefinitions, toolHandlers } from "../tools.js";
import type { AgentTurnResult, LlmProvider, ToolDefinition, ToolHandler } from "../types.js";

const SYSTEM_PROMPT = `You are Cat's Claw, a terminal coding assistant.\nWork step by step, prefer inspecting files before editing, and use tools when needed.\nKeep tool inputs minimal and precise.\nAssume the workspace root is the allowed boundary.`;

type GeminiContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GeminiProvider implements LlmProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly cwd: string;
  private readonly contents: GeminiContent[] = [];
  private extraTools: ToolDefinition[] = [];
  private extraHandlers: Record<string, ToolHandler> = {};

  constructor(args: { apiKey: string; model: string; cwd: string }) {
    this.client = new GoogleGenAI({ apiKey: args.apiKey });
    this.model = args.model;
    this.cwd = args.cwd;
  }

  addExternalTools(defs: ToolDefinition[], handlers: Record<string, ToolHandler>): void {
    this.extraTools.push(...defs);
    Object.assign(this.extraHandlers, handlers);
  }

  clear(): void {
    this.contents.length = 0;
  }

  async runTurn(prompt: string): Promise<AgentTurnResult> {
    this.contents.push({ role: "user", parts: [{ text: prompt }] });
    let assistantText = "";
    const allTools = [...toolDefinitions, ...this.extraTools];
    const allHandlers = { ...toolHandlers, ...this.extraHandlers };

    for (let i = 0; i < 10; i++) {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: this.contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [
            {
              functionDeclarations: allTools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.input_schema,
              })),
            },
          ],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
          },
        },
      });

      const candidate = response.candidates?.[0];
      const parts = (candidate?.content?.parts ?? []) as Array<Record<string, unknown>>;
      this.contents.push({ role: "model", parts });

      const textParts = parts
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter((t) => t.length > 0);
      if (textParts.length > 0) assistantText = textParts.join("\n");

      const functionCalls = parts
        .map((p) => p.functionCall)
        .filter((c): c is { id?: string; name?: string; args?: unknown } => typeof c === "object" && c !== null);

      if (functionCalls.length === 0) return { text: assistantText || response.text || "" };

      const functionResponses: Array<Record<string, unknown>> = [];
      for (const fc of functionCalls) {
        const name = typeof fc.name === "string" ? fc.name : "";
        const callId = typeof fc.id === "string" ? fc.id : name;
        const handler = allHandlers[name];

        if (!handler) {
          functionResponses.push({ functionResponse: { name, id: callId, response: { error: `Unknown tool: ${name}` } } });
          continue;
        }
        try {
          const input = isRecord(fc.args) ? fc.args : {};
          const result = await handler(input, this.cwd);
          functionResponses.push({ functionResponse: { name, id: callId, response: { content: result.content, isError: result.isError ?? false } } });
        } catch (error) {
          functionResponses.push({ functionResponse: { name, id: callId, response: { error: error instanceof Error ? error.message : String(error) } } });
        }
      }

      this.contents.push({ role: "user", parts: functionResponses });
    }

    return { text: assistantText || "Stopped after reaching the tool iteration limit." };
  }
}
