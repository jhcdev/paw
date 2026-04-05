/**
 * Cursor system for paw — grapheme-aware text navigation and editing.
 * Provides Emacs-style kill ring, MeasuredText, and an immutable Cursor class.
 */

// ── Kill Ring ────────────────────────────────────────────────────────────────

let killRing: string[] = [];
let lastKillDirection: "append" | "prepend" | null = null;

export function pushToKillRing(text: string, direction: "append" | "prepend"): void {
  if (killRing.length === 0 || lastKillDirection === null) {
    killRing.unshift(text);
  } else if (direction === "append") {
    killRing[0] = killRing[0] + text;
  } else {
    killRing[0] = text + killRing[0];
  }
  lastKillDirection = direction;
  // Cap ring size
  if (killRing.length > 60) killRing = killRing.slice(0, 60);
}

export function getLastKill(): string | undefined {
  return killRing[0];
}

export function resetKillAccumulation(): void {
  lastKillDirection = null;
}

// ── String width ─────────────────────────────────────────────────────────────

function charWidth(code: number): number {
  if (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals
    (code >= 0x3040 && code <= 0x33bf) || // Hiragana, Katakana, CJK
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0xa4cf) || // CJK Unified
    (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK Compat Forms
    (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
    (code >= 0x20000 && code <= 0x2fa1f) // CJK Extension B-F
  ) return 2;
  return 1;
}

function stringWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += charWidth(code);
  }
  return width;
}

// ── MeasuredText ─────────────────────────────────────────────────────────────

type WordBoundary = { start: number; end: number; isWordLike: boolean };

export class MeasuredText {
  readonly text: string;
  readonly columns: number;

  private _graphemes: string[] | null = null;
  private _graphemeOffsets: number[] | null = null;
  private _wordBoundaries: WordBoundary[] | null = null;

  // Cache for offset navigation: offset -> next/prev offset
  private _nextOffsetCache = new Map<number, number>();
  private _prevOffsetCache = new Map<number, number>();

  constructor(text: string, columns: number) {
    this.text = text.normalize("NFC");
    this.columns = columns;
  }

  private _buildGraphemes(): void {
    if (this._graphemes !== null) return;
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    const graphemes: string[] = [];
    const offsets: number[] = []; // byte offset of each grapheme start
    let offset = 0;
    for (const seg of segmenter.segment(this.text)) {
      graphemes.push(seg.segment);
      offsets.push(offset);
      offset += seg.segment.length;
    }
    this._graphemes = graphemes;
    this._graphemeOffsets = offsets;
  }

  nextOffset(offset: number): number {
    const cached = this._nextOffsetCache.get(offset);
    if (cached !== undefined) return cached;
    this._buildGraphemes();
    const offsets = this._graphemeOffsets!;
    const graphemes = this._graphemes!;
    // Find which grapheme starts at or after `offset`
    let result = this.text.length;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] === offset) {
        result = offset + graphemes[i].length;
        break;
      }
    }
    this._nextOffsetCache.set(offset, result);
    return result;
  }

  prevOffset(offset: number): number {
    const cached = this._prevOffsetCache.get(offset);
    if (cached !== undefined) return cached;
    this._buildGraphemes();
    const offsets = this._graphemeOffsets!;
    const graphemes = this._graphemes!;
    // Find grapheme that ends at `offset`
    let result = 0;
    for (let i = offsets.length - 1; i >= 0; i--) {
      const end = offsets[i] + graphemes[i].length;
      if (end === offset) {
        result = offsets[i];
        break;
      }
    }
    this._prevOffsetCache.set(offset, result);
    return result;
  }

  getWordBoundaries(): WordBoundary[] {
    if (this._wordBoundaries !== null) return this._wordBoundaries;
    const segmenter = new Intl.Segmenter("en", { granularity: "word" });
    const boundaries: WordBoundary[] = [];
    let offset = 0;
    for (const seg of segmenter.segment(this.text)) {
      boundaries.push({
        start: offset,
        end: offset + seg.segment.length,
        isWordLike: seg.isWordLike ?? false,
      });
      offset += seg.segment.length;
    }
    this._wordBoundaries = boundaries;
    return boundaries;
  }

  getPositionFromOffset(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(this.text.length, offset));
    const lines = this.text.split("\n");
    let remaining = clamped;
    for (let line = 0; line < lines.length; line++) {
      const lineLen = lines[line].length + (line < lines.length - 1 ? 1 : 0); // +1 for \n
      if (remaining <= lines[line].length || line === lines.length - 1) {
        return { line, column: remaining };
      }
      remaining -= lines[line].length + 1; // subtract chars + newline
    }
    return { line: 0, column: 0 };
  }

  getOffsetFromPosition({ line, column }: { line: number; column: number }): number {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let i = 0; i < Math.min(line, lines.length - 1); i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    const targetLine = lines[Math.min(line, lines.length - 1)] ?? "";
    return offset + Math.min(column, targetLine.length);
  }

  get lineCount(): number {
    if (this.text.length === 0) return 1;
    let count = 1;
    for (const ch of this.text) {
      if (ch === "\n") count++;
    }
    return count;
  }

  stringWidth(text: string): number {
    return stringWidth(text);
  }
}

// ── Cursor ────────────────────────────────────────────────────────────────────

export class Cursor {
  readonly measuredText: MeasuredText;
  readonly offset: number;

  constructor(measuredText: MeasuredText, offset: number) {
    this.measuredText = measuredText;
    this.offset = Math.max(0, Math.min(measuredText.text.length, offset));
  }

  static fromText(text: string, columns: number, offset: number): Cursor {
    return new Cursor(new MeasuredText(text, columns), offset);
  }

  get text(): string {
    return this.measuredText.text;
  }

  isAtStart(): boolean {
    return this.offset === 0;
  }

  isAtEnd(): boolean {
    return this.offset === this.text.length;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  left(): Cursor {
    if (this.isAtStart()) return this;
    return new Cursor(this.measuredText, this.measuredText.prevOffset(this.offset));
  }

  right(): Cursor {
    if (this.isAtEnd()) return this;
    return new Cursor(this.measuredText, this.measuredText.nextOffset(this.offset));
  }

  up(): Cursor {
    const { line, column } = this.getPosition();
    if (line === 0) return this;
    const newOffset = this.measuredText.getOffsetFromPosition({ line: line - 1, column });
    return new Cursor(this.measuredText, newOffset);
  }

  down(): Cursor {
    const { line, column } = this.getPosition();
    if (line >= this.measuredText.lineCount - 1) return this;
    const newOffset = this.measuredText.getOffsetFromPosition({ line: line + 1, column });
    return new Cursor(this.measuredText, newOffset);
  }

  startOfLine(): Cursor {
    const { line } = this.getPosition();
    const newOffset = this.measuredText.getOffsetFromPosition({ line, column: 0 });
    return new Cursor(this.measuredText, newOffset);
  }

  endOfLine(): Cursor {
    const { line } = this.getPosition();
    const lines = this.text.split("\n");
    const lineText = lines[line] ?? "";
    const newOffset = this.measuredText.getOffsetFromPosition({ line, column: lineText.length });
    return new Cursor(this.measuredText, newOffset);
  }

  nextWord(): Cursor {
    const boundaries = this.measuredText.getWordBoundaries();
    // Find first word-like boundary that starts after current offset
    for (const b of boundaries) {
      if (b.isWordLike && b.start > this.offset) {
        return new Cursor(this.measuredText, b.end);
      }
      if (b.isWordLike && b.start <= this.offset && b.end > this.offset) {
        return new Cursor(this.measuredText, b.end);
      }
    }
    return new Cursor(this.measuredText, this.text.length);
  }

  prevWord(): Cursor {
    const boundaries = this.measuredText.getWordBoundaries();
    // Find last word-like boundary that ends before current offset
    let best: WordBoundary | null = null;
    for (const b of boundaries) {
      if (b.isWordLike && b.end < this.offset) {
        best = b;
      }
      if (b.isWordLike && b.start < this.offset && b.end >= this.offset) {
        return new Cursor(this.measuredText, b.start);
      }
    }
    if (best) return new Cursor(this.measuredText, best.start);
    return new Cursor(this.measuredText, 0);
  }

  // ── Text modification ───────────────────────────────────────────────────────

  insert(text: string): Cursor {
    const newText = this.text.slice(0, this.offset) + text + this.text.slice(this.offset);
    const newOffset = this.offset + text.length;
    return new Cursor(new MeasuredText(newText, this.measuredText.columns), newOffset);
  }

  backspace(): Cursor {
    if (this.isAtStart()) return this;
    const prevOff = this.measuredText.prevOffset(this.offset);
    const newText = this.text.slice(0, prevOff) + this.text.slice(this.offset);
    return new Cursor(new MeasuredText(newText, this.measuredText.columns), prevOff);
  }

  del(): Cursor {
    if (this.isAtEnd()) return this;
    const nextOff = this.measuredText.nextOffset(this.offset);
    const newText = this.text.slice(0, this.offset) + this.text.slice(nextOff);
    return new Cursor(new MeasuredText(newText, this.measuredText.columns), this.offset);
  }

  deleteToLineStart(): { cursor: Cursor; killed: string } {
    const lineStart = this.startOfLine().offset;
    if (lineStart === this.offset) return { cursor: this, killed: "" };
    const killed = this.text.slice(lineStart, this.offset);
    const newText = this.text.slice(0, lineStart) + this.text.slice(this.offset);
    return {
      cursor: new Cursor(new MeasuredText(newText, this.measuredText.columns), lineStart),
      killed,
    };
  }

  deleteToLineEnd(): { cursor: Cursor; killed: string } {
    const lineEnd = this.endOfLine().offset;
    if (lineEnd === this.offset) return { cursor: this, killed: "" };
    const killed = this.text.slice(this.offset, lineEnd);
    const newText = this.text.slice(0, this.offset) + this.text.slice(lineEnd);
    return {
      cursor: new Cursor(new MeasuredText(newText, this.measuredText.columns), this.offset),
      killed,
    };
  }

  deleteWordBefore(): { cursor: Cursor; killed: string } {
    const wordStart = this.prevWord().offset;
    if (wordStart === this.offset) return { cursor: this, killed: "" };
    const killed = this.text.slice(wordStart, this.offset);
    const newText = this.text.slice(0, wordStart) + this.text.slice(this.offset);
    return {
      cursor: new Cursor(new MeasuredText(newText, this.measuredText.columns), wordStart),
      killed,
    };
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  render(cursorChar: string): string {
    return this.text.slice(0, this.offset) + cursorChar + this.text.slice(this.offset);
  }

  // ── Position helper ─────────────────────────────────────────────────────────

  getPosition(): { line: number; column: number } {
    return this.measuredText.getPositionFromOffset(this.offset);
  }
}
