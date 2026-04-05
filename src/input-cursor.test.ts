import { describe, it, expect } from "vitest";
import { countLinesBelowInput, measureImeColumn } from "./ime-cursor.js";

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

describe("IME cursor positioning", () => {
  it("measures ASCII text from the prompt start", () => {
    expect(measureImeColumn("abc")).toBe(10);
  });

  it("counts wide characters as two columns", () => {
    expect(measureImeColumn("안a")).toBe(10);
  });

  it("counts the default footer when nothing extra is shown", () => {
    expect(countLinesBelowInput({ baseLinesBelowInput: 2 })).toBe(2);
  });

  it("includes the activity selector footer", () => {
    expect(countLinesBelowInput({
      baseLinesBelowInput: 2,
      activitySelectorCount: 3,
      isViewingActivitySelector: true,
    })).toBe(6);
  });

  it("includes activity detail footer rows", () => {
    expect(countLinesBelowInput({
      baseLinesBelowInput: 2,
      activityLogCount: 5,
      isViewingActivityDetail: true,
    })).toBe(10);
  });
});

// ── Cursor class tests ────────────────────────────────────────────────────────

import { Cursor, pushToKillRing, getLastKill, resetKillAccumulation } from "./cursor.js";

describe("Cursor — basic left/right", () => {
  it("moves right through ASCII", () => {
    const c = Cursor.fromText("abc", 80, 0);
    expect(c.right().offset).toBe(1);
    expect(c.right().right().offset).toBe(2);
  });

  it("moves left through ASCII", () => {
    const c = Cursor.fromText("abc", 80, 3);
    expect(c.left().offset).toBe(2);
    expect(c.left().left().offset).toBe(1);
  });

  it("does not go below 0", () => {
    const c = Cursor.fromText("abc", 80, 0);
    expect(c.left().offset).toBe(0);
  });

  it("does not go past end", () => {
    const c = Cursor.fromText("abc", 80, 3);
    expect(c.right().offset).toBe(3);
  });

  it("isAtStart / isAtEnd", () => {
    const c = Cursor.fromText("hi", 80, 0);
    expect(c.isAtStart()).toBe(true);
    expect(c.isAtEnd()).toBe(false);
    expect(c.right().right().isAtEnd()).toBe(true);
  });
});

describe("Cursor — CJK and emoji grapheme navigation", () => {
  it("moves through Korean characters one grapheme at a time", () => {
    const c = Cursor.fromText("안녕", 80, 0);
    const c1 = c.right();
    // JS strings are UTF-16; Korean chars have string length 1
    expect(c1.offset).toBe(1);
    expect(c1.right().offset).toBe(2);
  });

  it("backspace on Korean removes one grapheme", () => {
    const c = Cursor.fromText("안녕하", 80, 3);
    const c2 = c.backspace();
    expect(c2.text).toBe("안녕");
    expect(c2.offset).toBe(2);
  });

  it("handles emoji as single grapheme", () => {
    // 👋 is U+1F44B, represented as surrogate pair in JS (length 2)
    const wave = "👋";
    const c = Cursor.fromText(wave + "hi", 80, 0);
    const c1 = c.right();
    expect(c1.offset).toBe(wave.length); // 2 for surrogate pair
    expect(c1.text.slice(0, c1.offset)).toBe(wave);
  });
});

describe("Cursor — insert / backspace / del", () => {
  it("inserts at beginning", () => {
    const c = Cursor.fromText("bc", 80, 0).insert("a");
    expect(c.text).toBe("abc");
    expect(c.offset).toBe(1);
  });

  it("inserts in middle", () => {
    const c = Cursor.fromText("ac", 80, 1).insert("b");
    expect(c.text).toBe("abc");
    expect(c.offset).toBe(2);
  });

  it("inserts at end", () => {
    const c = Cursor.fromText("ab", 80, 2).insert("c");
    expect(c.text).toBe("abc");
    expect(c.offset).toBe(3);
  });

  it("del removes character after cursor", () => {
    const c = Cursor.fromText("abc", 80, 1).del();
    expect(c.text).toBe("ac");
    expect(c.offset).toBe(1);
  });

  it("del at end does nothing", () => {
    const c = Cursor.fromText("abc", 80, 3).del();
    expect(c.text).toBe("abc");
    expect(c.offset).toBe(3);
  });

  it("backspace at start does nothing", () => {
    const c = Cursor.fromText("abc", 80, 0).backspace();
    expect(c.text).toBe("abc");
    expect(c.offset).toBe(0);
  });
});

describe("Cursor — deleteToLineStart / deleteToLineEnd", () => {
  it("deleteToLineEnd kills from cursor to end", () => {
    const c = Cursor.fromText("hello world", 80, 5);
    const { cursor: c2, killed } = c.deleteToLineEnd();
    expect(c2.text).toBe("hello");
    expect(c2.offset).toBe(5);
    expect(killed).toBe(" world");
  });

  it("deleteToLineStart kills from start to cursor", () => {
    const c = Cursor.fromText("hello world", 80, 5);
    const { cursor: c2, killed } = c.deleteToLineStart();
    expect(c2.text).toBe(" world");
    expect(c2.offset).toBe(0);
    expect(killed).toBe("hello");
  });

  it("deleteToLineEnd at end returns empty killed", () => {
    const c = Cursor.fromText("hello", 80, 5);
    const { killed } = c.deleteToLineEnd();
    expect(killed).toBe("");
  });

  it("deleteToLineStart at start returns empty killed", () => {
    const c = Cursor.fromText("hello", 80, 0);
    const { killed } = c.deleteToLineStart();
    expect(killed).toBe("");
  });

  it("works with multi-line text — only kills current line portion", () => {
    const c = Cursor.fromText("foo\nbar\nbaz", 80, 6); // offset 6 = 'b' in 'bar'
    const { cursor: c2, killed } = c.deleteToLineEnd();
    expect(killed).toBe("r");
    expect(c2.text).toBe("foo\nba\nbaz");
  });
});

describe("Cursor — deleteWordBefore", () => {
  it("deletes word before cursor", () => {
    const c = Cursor.fromText("hello world", 80, 11);
    const { cursor: c2, killed } = c.deleteWordBefore();
    expect(killed).toBe("world");
    expect(c2.text).toBe("hello ");
  });

  it("deletes word in middle", () => {
    const c = Cursor.fromText("foo bar baz", 80, 7);
    const { cursor: c2, killed } = c.deleteWordBefore();
    expect(killed).toBe("bar");
    expect(c2.text).toBe("foo  baz");
  });

  it("does nothing at start", () => {
    const c = Cursor.fromText("hello", 80, 0);
    const { killed } = c.deleteWordBefore();
    expect(killed).toBe("");
  });
});

describe("Cursor — startOfLine / endOfLine", () => {
  it("moves to start of line", () => {
    const c = Cursor.fromText("hello", 80, 3);
    expect(c.startOfLine().offset).toBe(0);
  });

  it("moves to end of line", () => {
    const c = Cursor.fromText("hello", 80, 2);
    expect(c.endOfLine().offset).toBe(5);
  });

  it("works on second line of multi-line text", () => {
    const c = Cursor.fromText("foo\nbar", 80, 5); // offset 5 = 'a' in 'bar'
    expect(c.startOfLine().offset).toBe(4); // start of 'bar'
    expect(c.endOfLine().offset).toBe(7); // end of 'bar'
  });
});

describe("Cursor — render", () => {
  it("renders cursor at position", () => {
    const c = Cursor.fromText("hello", 80, 2);
    expect(c.render("█")).toBe("he█llo");
  });

  it("renders at start", () => {
    const c = Cursor.fromText("hello", 80, 0);
    expect(c.render("█")).toBe("█hello");
  });

  it("renders at end", () => {
    const c = Cursor.fromText("hello", 80, 5);
    expect(c.render("█")).toBe("hello█");
  });
});

describe("Cursor — word navigation", () => {
  it("nextWord moves to end of next word", () => {
    const c = Cursor.fromText("hello world", 80, 0);
    expect(c.nextWord().offset).toBe(5);
  });

  it("prevWord moves to start of previous word", () => {
    const c = Cursor.fromText("hello world", 80, 11);
    expect(c.prevWord().offset).toBe(6);
  });
});

describe("kill ring", () => {
  it("stores and retrieves killed text", () => {
    resetKillAccumulation();
    pushToKillRing("hello", "append");
    expect(getLastKill()).toBe("hello");
  });

  it("appends consecutive kills in append direction", () => {
    resetKillAccumulation();
    pushToKillRing("foo", "append");
    pushToKillRing(" bar", "append");
    expect(getLastKill()).toBe("foo bar");
  });

  it("prepends in prepend direction", () => {
    resetKillAccumulation();
    pushToKillRing("world", "prepend");
    pushToKillRing("hello ", "prepend");
    expect(getLastKill()).toBe("hello world");
  });

  it("resets accumulation breaks chain", () => {
    resetKillAccumulation();
    pushToKillRing("first", "append");
    resetKillAccumulation();
    pushToKillRing("second", "append");
    expect(getLastKill()).toBe("second");
  });
});
