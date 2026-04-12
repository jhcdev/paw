import { describe, expect, it } from "vitest";

import { clearComposerBuffer, createComposerBuffer } from "./composer-buffer.js";

describe("composer buffer", () => {
  it("places the cursor at the end by default", () => {
    expect(createComposerBuffer("/help")).toEqual({ text: "/help", cursorPos: 5 });
  });

  it("clamps the cursor within the current text length", () => {
    expect(createComposerBuffer("안녕", 99)).toEqual({ text: "안녕", cursorPos: 2 });
    expect(createComposerBuffer("abc", -3)).toEqual({ text: "abc", cursorPos: 0 });
  });

  it("clears the buffer completely", () => {
    expect(clearComposerBuffer()).toEqual({ text: "", cursorPos: 0 });
  });
});
