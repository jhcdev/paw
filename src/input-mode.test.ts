import { describe, expect, it } from "vitest";

import { canSubmitComposerInput, isInlineTextEntryMode } from "./input-mode.js";

describe("input mode helpers", () => {
  it("recognizes inline text-entry panels that should keep keyboard typing enabled", () => {
    expect(isInlineTextEntryMode("off", "add-key")).toBe(true);
    expect(isInlineTextEntryMode("add-name", "off")).toBe(true);
    expect(isInlineTextEntryMode("add-cmd", "off")).toBe(true);
    expect(isInlineTextEntryMode("add-args", "off")).toBe(true);
    expect(isInlineTextEntryMode("list", "off")).toBe(false);
  });

  it("allows Enter submission for inline text-entry panels", () => {
    expect(canSubmitComposerInput({
      mcpMode: "add-name",
      modelPanel: "off",
      settingsPanel: "off",
      teamPanel: "off",
      verifyPanel: "off",
      verifyLogView: false,
      spawnPanel: "off",
    })).toBe(true);

    expect(canSubmitComposerInput({
      mcpMode: "off",
      modelPanel: "off",
      settingsPanel: "add-key",
      teamPanel: "off",
      verifyPanel: "off",
      verifyLogView: false,
      spawnPanel: "off",
    })).toBe(true);
  });

  it("blocks Enter submission while non-text panels are active", () => {
    expect(canSubmitComposerInput({
      mcpMode: "list",
      modelPanel: "off",
      settingsPanel: "off",
      teamPanel: "off",
      verifyPanel: "off",
      verifyLogView: false,
      spawnPanel: "off",
    })).toBe(false);

    expect(canSubmitComposerInput({
      mcpMode: "off",
      modelPanel: "providers",
      settingsPanel: "off",
      teamPanel: "off",
      verifyPanel: "off",
      verifyLogView: false,
      spawnPanel: "off",
    })).toBe(false);
  });
});
