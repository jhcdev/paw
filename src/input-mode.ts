export function isInlineTextEntryMode(mcpMode: string, settingsPanel: string): boolean {
  return settingsPanel === "add-key" || mcpMode === "add-name" || mcpMode === "add-cmd" || mcpMode === "add-args";
}

export function canSubmitComposerInput(params: {
  mcpMode: string;
  modelPanel: string;
  settingsPanel: string;
  teamPanel: string;
  verifyPanel: string;
  verifyLogView: boolean;
  spawnPanel: string;
}): boolean {
  const { mcpMode, modelPanel, settingsPanel, teamPanel, verifyPanel, verifyLogView, spawnPanel } = params;
  const inlineTextEntryActive = isInlineTextEntryMode(mcpMode, settingsPanel);
  const mcpAllowsSubmit = mcpMode === "off" || mcpMode === "add-name" || mcpMode === "add-cmd" || mcpMode === "add-args";
  const settingsAllowSubmit = settingsPanel === "off" || settingsPanel === "add-key";

  return inlineTextEntryActive || (mcpAllowsSubmit && settingsAllowSubmit)
    ? mcpAllowsSubmit
      && modelPanel === "off"
      && settingsAllowSubmit
      && teamPanel === "off"
      && verifyPanel === "off"
      && !verifyLogView
      && spawnPanel === "off"
    : false;
}
