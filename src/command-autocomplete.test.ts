import { describe, expect, it } from "vitest";

import { applyAutocompleteSelection, shouldShowCommandSuggestions } from "./command-autocomplete.js";

describe("command autocomplete", () => {
  it("shows slash suggestions only while editing at the end of a slash token", () => {
    expect(shouldShowCommandSuggestions("/he", 3)).toBe(true);
    expect(shouldShowCommandSuggestions("/he", 1)).toBe(false);
    expect(shouldShowCommandSuggestions("/help me", 5)).toBe(false);
    expect(shouldShowCommandSuggestions("help", 4)).toBe(false);
  });

  it("moves the cursor to the end after applying an autocomplete selection", () => {
    expect(applyAutocompleteSelection("/help")).toEqual({
      input: "/help",
      cursorPos: 5,
    });
  });
});
