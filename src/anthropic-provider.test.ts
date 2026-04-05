import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./providers/anthropic.js";

const { createMock, streamMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: createMock,
      stream: streamMock,
    };
  },
}));

describe("AnthropicProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
    streamMock.mockReset();
  });

  it("forwards hook additionalContext back to the next tool follow-up message", async () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      model: "claude-sonnet-4-20250514",
      cwd: "/tmp",
    });

    const handler = vi.fn(async () => ({ content: "tool ok" }));
    provider.addExternalTools([
      {
        name: "mock_tool",
        description: "Mock tool for tests",
        input_schema: {
          type: "object",
          properties: {},
        },
      },
    ], { mock_tool: handler });

    provider.setToolHooks({
      preTool: async () => ({ blocked: false, additionalContext: "pre hook context" }),
      postTool: async () => ({ additionalContext: "post hook context" }),
    });

    createMock
      .mockResolvedValueOnce({
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: "tool_use", id: "toolu_1", name: "mock_tool", input: {} },
        ],
      })
      .mockResolvedValueOnce({
        usage: { input_tokens: 4, output_tokens: 3 },
        content: [
          { type: "text", text: "done" },
        ],
      });

    const result = await provider.runTurn("hello");

    expect(result.text).toBe("done");
    expect(result.usage).toEqual({ inputTokens: 14, outputTokens: 8 });
    expect(handler).toHaveBeenCalledOnce();

    const secondRequest = createMock.mock.calls[1]?.[0];
    expect(secondRequest).toBeDefined();

    const followUpMessage = secondRequest.messages[2];
    expect(followUpMessage).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "tool ok" },
        { type: "text", text: "pre hook context" },
        { type: "text", text: "post hook context" },
      ],
    });
  });
});
