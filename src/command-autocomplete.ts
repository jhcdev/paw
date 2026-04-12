export function shouldShowCommandSuggestions(input: string, cursorPos: number): boolean {
  return input.startsWith("/") && !input.includes(" ") && cursorPos === [...input].length;
}

export function applyAutocompleteSelection(selected: string): { input: string; cursorPos: number } {
  return {
    input: selected,
    cursorPos: [...selected].length,
  };
}
