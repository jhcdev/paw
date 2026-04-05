/**
 * CursorManager — keeps the terminal cursor at the input field
 * so Korean/CJK IME composition renders at the correct position.
 *
 * Strategy:
 * - Between renders: cursor stays at the IME input position.
 * - When Ink writes (render start): move cursor down to Ink's expected
 *   position so eraseLines works correctly.
 * - When Ink finishes (SHOW_CURSOR): move cursor back up to IME position.
 * - Track whether Ink's output ends with \n (cursor on new blank line)
 *   to dynamically adjust the up-offset.
 */

const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";

function chunkToString(chunk: string | Uint8Array): string {
  if (typeof chunk === "string") return chunk;
  return Buffer.from(chunk).toString("utf8");
}

function getRowOffset(): number {
  const raw = process.env.PAW_IME_ROW_OFFSET;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** Strip ANSI escape sequences to find the last printable character. */
function lastPrintableChar(text: string): string {
  // Remove all ANSI escape sequences: ESC[ ... final_byte  and  ESC (non-[) char
  const stripped = text.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B[^[]/g, "");
  return stripped.length > 0 ? stripped[stripped.length - 1] : "";
}

export class CursorManager {
  private originalStdoutWrite: typeof process.stdout.write | null = null;
  private originalStderrWrite: typeof process.stderr.write | null = null;
  private installed = false;
  private linesUp = 0;
  private col = 0;
  private positionVersion = 0;
  private stdoutTail = "";
  private stderrTail = "";
  /** true when cursor is currently at the IME position (moved up) */
  private atImePosition = false;
  /** Last printable character written in the current render cycle */
  private lastPrintable = "";
  /** Whether Ink's cursor sits on a trailing blank line after render */
  private hasTrailingLine = true;

  private canMoveToInput(): boolean {
    return this.linesUp > 0 && this.col > 0;
  }

  private getOffset(): number {
    const base = this.linesUp + getRowOffset();
    return this.hasTrailingLine ? base + 1 : base;
  }

  private cursorToInk(writer: typeof process.stdout.write): void {
    if (!this.atImePosition) return;
    const offset = this.getOffset();
    writer(`\x1B[${offset}B`);
    this.atImePosition = false;
  }

  private cursorToIme(writer: typeof process.stdout.write): void {
    if (this.atImePosition || !this.canMoveToInput()) return;
    const offset = this.getOffset();
    writer(`\x1B[${offset}A\x1B[${this.col}G`);
    this.atImePosition = true;
  }

  private detectShowCursor(
    stream: "stdout" | "stderr",
    chunk: string | Uint8Array,
  ): boolean {
    const text = chunkToString(chunk);
    const prevTail = stream === "stdout" ? this.stdoutTail : this.stderrTail;
    const combined = prevTail + text;
    const found = combined.includes(SHOW_CURSOR);
    const nextTail = combined.slice(-(SHOW_CURSOR.length - 1));
    if (stream === "stdout") this.stdoutTail = nextTail;
    else this.stderrTail = nextTail;
    return found;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    const originalStdout = process.stdout.write.bind(process.stdout);
    const originalStderr = process.stderr.write.bind(process.stderr);
    this.originalStdoutWrite = originalStdout;
    this.originalStderrWrite = originalStderr;

    const self = this;
    const patchWrite = <T extends typeof process.stdout.write>(
      original: T,
      stream: "stdout" | "stderr",
    ): T => {
      return function (
        chunk: string | Uint8Array,
        ...rest: any[]
      ): boolean {
        if (self.atImePosition) {
          self.cursorToInk(original);
        }

        const result = original(chunk, ...rest);

        // Track last printable character for trailing-newline detection
        const text = chunkToString(chunk);
        const lpc = lastPrintableChar(text);
        if (lpc) self.lastPrintable = lpc;

        if (self.detectShowCursor(stream, chunk)) {
          // If Ink's last printable character was \n, cursor is on a blank line
          self.hasTrailingLine = self.lastPrintable === "\n";
          self.lastPrintable = "";
          self.cursorToIme(original);
        }
        return result;
      } as T;
    };

    process.stdout.write = patchWrite(originalStdout, "stdout");
    process.stderr.write = patchWrite(originalStderr, "stderr");
    originalStdout(HIDE_CURSOR);
  }

  setCursorPosition(linesUp: number, column: number): void {
    const writer = this.originalStdoutWrite;
    if (!writer) return;

    if (this.atImePosition) {
      this.cursorToInk(writer);
    }

    this.linesUp = linesUp;
    this.col = column;

    this.cursorToIme(writer);
  }

  uninstall(): void {
    if (!this.installed || !this.originalStdoutWrite || !this.originalStderrWrite) return;
    if (this.atImePosition) {
      this.cursorToInk(this.originalStdoutWrite);
    }
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
    this.originalStdoutWrite(SHOW_CURSOR);
    this.stdoutTail = "";
    this.stderrTail = "";
    this.atImePosition = false;
    this.installed = false;
  }
}

export const cursorManager = new CursorManager();
