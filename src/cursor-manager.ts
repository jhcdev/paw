/**
 * CursorManager — keeps the terminal cursor at the input field
 * so Korean/CJK IME composition renders at the correct position.
 *
 * Strategy:
 * - Between renders: cursor stays at the IME input position.
 * - When Ink writes (render start): move cursor down to Ink's expected
 *   position so eraseLines works correctly.
 * - When Ink finishes (SHOW_CURSOR): move cursor back up to IME position.
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

  private canMoveToInput(): boolean {
    return this.linesUp > 0 && this.col > 0;
  }

  private getOffset(): number {
    return this.linesUp + getRowOffset();
  }

  /** Move cursor from IME position back DOWN to where Ink expects it. */
  private cursorToInk(writer: typeof process.stdout.write): void {
    if (!this.atImePosition) return;
    const offset = this.getOffset();
    writer(`\x1B[${offset}B`);
    this.atImePosition = false;
  }

  /** Move cursor from Ink's bottom position UP to the IME input position. */
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
        // Before Ink writes its render content, move cursor back down
        // so Ink's relative cursor movements (eraseLines) work correctly.
        if (self.atImePosition) {
          self.cursorToInk(original);
        }

        const result = original(chunk, ...rest);

        // After Ink finishes rendering (emits SHOW_CURSOR),
        // move cursor back up to the IME input position.
        if (self.detectShowCursor(stream, chunk)) {
          self.cursorToIme(original);
        }
        return result;
      } as T;
    };

    process.stdout.write = patchWrite(originalStdout, "stdout");
    process.stderr.write = patchWrite(originalStderr, "stderr");
    originalStdout(HIDE_CURSOR);
  }

  /**
   * Update cursor position for IME composition.
   * @param linesUp — lines up from end of Ink output to the input content line
   * @param column — 1-based column position within the input line
   */
  setCursorPosition(linesUp: number, column: number): void {
    const writer = this.originalStdoutWrite;
    if (!writer) return;

    // Move back down from old position before updating
    if (this.atImePosition) {
      this.cursorToInk(writer);
    }

    this.linesUp = linesUp;
    this.col = column;

    // Move to new IME position
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
