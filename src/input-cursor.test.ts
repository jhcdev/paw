import { describe, it, expect } from "vitest";

/**
 * Test the cursor-based input logic used in cli.tsx.
 * We simulate the state updates (input string + cursorPos) without React.
 */

type InputState = { input: string; cursorPos: number };

function insertChar(state: InputState, ch: string): InputState {
  const chars = [...state.input];
  const pos = Math.min(chars.length, state.cursorPos);
  chars.splice(pos, 0, ch);
  return { input: chars.join(""), cursorPos: pos + 1 };
}

function backspace(state: InputState): InputState {
  const chars = [...state.input];
  const pos = Math.min(chars.length, state.cursorPos);
  if (pos <= 0) return state;
  chars.splice(pos - 1, 1);
  return { input: chars.join(""), cursorPos: pos - 1 };
}

function moveLeft(state: InputState): InputState {
  return { ...state, cursorPos: Math.max(0, state.cursorPos - 1) };
}

function moveRight(state: InputState): InputState {
  return { ...state, cursorPos: Math.min([...state.input].length, state.cursorPos + 1) };
}

function clear(): InputState {
  return { input: "", cursorPos: 0 };
}

function renderWithCursor(state: InputState): string {
  const chars = [...state.input];
  const before = chars.slice(0, state.cursorPos).join("");
  const after = chars.slice(state.cursorPos).join("");
  return `${before}█${after}`;
}

describe("input cursor — character insertion", () => {
  it("inserts at end (default behavior)", () => {
    let s: InputState = { input: "", cursorPos: 0 };
    s = insertChar(s, "h");
    s = insertChar(s, "i");
    expect(s.input).toBe("hi");
    expect(s.cursorPos).toBe(2);
  });

  it("inserts at beginning after moving cursor left", () => {
    let s: InputState = { input: "bc", cursorPos: 0 };
    s = insertChar(s, "a");
    expect(s.input).toBe("abc");
    expect(s.cursorPos).toBe(1);
  });

  it("inserts in the middle", () => {
    let s: InputState = { input: "ac", cursorPos: 1 };
    s = insertChar(s, "b");
    expect(s.input).toBe("abc");
    expect(s.cursorPos).toBe(2);
  });

  it("handles CJK character insertion", () => {
    let s: InputState = { input: "안녕", cursorPos: 1 };
    s = insertChar(s, "하");
    expect(s.input).toBe("안하녕");
    expect(s.cursorPos).toBe(2);
  });
});

describe("input cursor — backspace", () => {
  it("deletes character before cursor", () => {
    let s: InputState = { input: "abc", cursorPos: 3 };
    s = backspace(s);
    expect(s.input).toBe("ab");
    expect(s.cursorPos).toBe(2);
  });

  it("deletes in the middle", () => {
    let s: InputState = { input: "abc", cursorPos: 2 };
    s = backspace(s);
    expect(s.input).toBe("ac");
    expect(s.cursorPos).toBe(1);
  });

  it("does nothing at position 0", () => {
    let s: InputState = { input: "abc", cursorPos: 0 };
    s = backspace(s);
    expect(s.input).toBe("abc");
    expect(s.cursorPos).toBe(0);
  });

  it("handles empty input", () => {
    let s: InputState = { input: "", cursorPos: 0 };
    s = backspace(s);
    expect(s.input).toBe("");
    expect(s.cursorPos).toBe(0);
  });

  it("handles CJK backspace", () => {
    let s: InputState = { input: "안녕하세요", cursorPos: 3 };
    s = backspace(s);
    expect(s.input).toBe("안녕세요");
    expect(s.cursorPos).toBe(2);
  });
});

describe("input cursor — arrow movement", () => {
  it("moves left", () => {
    let s: InputState = { input: "abc", cursorPos: 3 };
    s = moveLeft(s);
    expect(s.cursorPos).toBe(2);
    s = moveLeft(s);
    expect(s.cursorPos).toBe(1);
  });

  it("does not go below 0", () => {
    let s: InputState = { input: "abc", cursorPos: 0 };
    s = moveLeft(s);
    expect(s.cursorPos).toBe(0);
  });

  it("moves right", () => {
    let s: InputState = { input: "abc", cursorPos: 0 };
    s = moveRight(s);
    expect(s.cursorPos).toBe(1);
    s = moveRight(s);
    expect(s.cursorPos).toBe(2);
  });

  it("does not go past input length", () => {
    let s: InputState = { input: "abc", cursorPos: 3 };
    s = moveRight(s);
    expect(s.cursorPos).toBe(3);
  });

  it("works with CJK characters", () => {
    let s: InputState = { input: "안녕", cursorPos: 2 };
    s = moveLeft(s);
    expect(s.cursorPos).toBe(1);
    s = moveRight(s);
    expect(s.cursorPos).toBe(2);
  });
});

describe("input cursor — clear", () => {
  it("resets input and cursor to 0", () => {
    const s = clear();
    expect(s.input).toBe("");
    expect(s.cursorPos).toBe(0);
  });
});

describe("input cursor — rendering", () => {
  it("renders cursor at end", () => {
    expect(renderWithCursor({ input: "hello", cursorPos: 5 })).toBe("hello█");
  });

  it("renders cursor at beginning", () => {
    expect(renderWithCursor({ input: "hello", cursorPos: 0 })).toBe("█hello");
  });

  it("renders cursor in middle", () => {
    expect(renderWithCursor({ input: "hello", cursorPos: 2 })).toBe("he█llo");
  });

  it("renders cursor in empty input", () => {
    expect(renderWithCursor({ input: "", cursorPos: 0 })).toBe("█");
  });

  it("renders cursor with CJK", () => {
    expect(renderWithCursor({ input: "안녕하세요", cursorPos: 2 })).toBe("안녕█하세요");
  });
});

describe("input cursor — full workflow", () => {
  it("type → move left → insert → result correct", () => {
    let s: InputState = { input: "", cursorPos: 0 };
    // Type "hllo"
    s = insertChar(s, "h");
    s = insertChar(s, "l");
    s = insertChar(s, "l");
    s = insertChar(s, "o");
    expect(s.input).toBe("hllo");

    // Move cursor to position 1 (after 'h')
    s = moveLeft(s); // pos 3
    s = moveLeft(s); // pos 2
    s = moveLeft(s); // pos 1

    // Insert 'e'
    s = insertChar(s, "e");
    expect(s.input).toBe("hello");
    expect(s.cursorPos).toBe(2);
  });

  it("type → move left → backspace → correct", () => {
    let s: InputState = { input: "", cursorPos: 0 };
    // Type "abcd"
    for (const c of "abcd") s = insertChar(s, c);
    expect(s.input).toBe("abcd");

    // Move to position 2
    s = moveLeft(s); // 3
    s = moveLeft(s); // 2

    // Backspace removes 'b'
    s = backspace(s);
    expect(s.input).toBe("acd");
    expect(s.cursorPos).toBe(1);
  });

  it("Korean input workflow", () => {
    let s: InputState = { input: "", cursorPos: 0 };
    s = insertChar(s, "안");
    s = insertChar(s, "녕");
    s = insertChar(s, "하");
    s = insertChar(s, "세");
    s = insertChar(s, "요");

    // Move to after 녕
    s = moveLeft(s); // 4
    s = moveLeft(s); // 3
    s = moveLeft(s); // 2

    // Insert at position 2
    s = insertChar(s, "!");
    expect(s.input).toBe("안녕!하세요");
    expect(s.cursorPos).toBe(3);
  });
});
