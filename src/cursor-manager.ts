/**
 * CursorManager — hides the terminal's native cursor to prevent
 * rendering conflicts with Ink's output management.
 *
 * The input position is shown via the rendered █ block cursor in the UI.
 * Keeping the native cursor hidden avoids Ink eraseLines miscalculations
 * that previously caused duplicate/ghost rendering artifacts.
 */

const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";

function chunkToString(chunk: string | Uint8Array): string {
  if (typeof chunk === "string") return chunk;
  return Buffer.from(chunk).toString("utf8");
}

export class CursorManager {
  private originalStdoutWrite: typeof process.stdout.write | null = null;
  private originalStderrWrite: typeof process.stderr.write | null = null;
  private installed = false;
  private stdoutTail = "";
  private stderrTail = "";

  private sawShowCursor(
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
        const result = original(chunk, ...rest);
        // Suppress any SHOW_CURSOR that Ink emits — keep cursor hidden
        if (self.sawShowCursor(stream, chunk)) {
          original(HIDE_CURSOR);
        }
        return result;
      } as T;
    };

    process.stdout.write = patchWrite(originalStdout, "stdout");
    process.stderr.write = patchWrite(originalStderr, "stderr");
    originalStdout(HIDE_CURSOR);
  }

  /** No-op — cursor stays hidden, position irrelevant. */
  setCursorPosition(_linesUp: number, _column: number): void {}

  uninstall(): void {
    if (!this.installed || !this.originalStdoutWrite || !this.originalStderrWrite) return;
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
    this.originalStdoutWrite(SHOW_CURSOR);
    this.stdoutTail = "";
    this.stderrTail = "";
    this.installed = false;
  }
}

export const cursorManager = new CursorManager();
