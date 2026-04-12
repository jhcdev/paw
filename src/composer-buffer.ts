export type ComposerBuffer = {
  text: string;
  cursorPos: number;
};

export function createComposerBuffer(text: string, cursorPos: number = [...text].length): ComposerBuffer {
  const length = [...text].length;
  return {
    text,
    cursorPos: Math.max(0, Math.min(cursorPos, length)),
  };
}

export function clearComposerBuffer(): ComposerBuffer {
  return { text: "", cursorPos: 0 };
}
