/**
 * Conversation Compaction — summarizes old messages to free context space.
 *
 * Strategy:
 * 1. Keep recent messages intact (last N turns)
 * 2. Summarize older messages into a compact summary
 * 3. Replace old messages with summary block
 * 4. Re-inject PAW.md after compaction
 *
 * Preservation priority:
 * - Always keep: system prompt, PAW.md, recent messages
 * - Summarize: older conversation turns
 * - Drop first: old tool outputs (verbose)
 */

export type CompactionMessage = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type CompactionResult = {
  summary: string;
  droppedCount: number;
  keptCount: number;
};

// Trigger when messages exceed this count
const AUTO_COMPACT_THRESHOLD = 30;
// Keep this many recent messages intact
const KEEP_RECENT = 8;

/**
 * Check if compaction should trigger.
 */
export function shouldCompact(messageCount: number, threshold = AUTO_COMPACT_THRESHOLD): boolean {
  return messageCount > threshold;
}

/**
 * Build a compaction prompt from old messages.
 * Returns the prompt to send to AI for summarization.
 */
export function buildCompactionPrompt(
  messages: CompactionMessage[],
  keepRecent = KEEP_RECENT,
  focus?: string,
): { prompt: string; toSummarize: CompactionMessage[]; toKeep: CompactionMessage[] } {
  if (messages.length <= keepRecent) {
    return { prompt: "", toSummarize: [], toKeep: messages };
  }

  const toSummarize = messages.slice(0, messages.length - keepRecent);
  const toKeep = messages.slice(messages.length - keepRecent);

  // Build conversation text for summarization
  const conversationText = toSummarize.map((m) => {
    const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    // Truncate verbose tool outputs
    const text = m.text.length > 500 ? m.text.slice(0, 500) + "..." : m.text;
    return `${prefix}: ${text}`;
  }).join("\n\n");

  const focusLine = focus ? `\nFocus especially on: ${focus}` : "";

  const prompt = `Summarize this conversation concisely. Preserve:
- Key decisions and their reasoning
- File paths and code changes made
- Important context the user provided
- Current task state and what's been accomplished
- Any errors encountered and how they were resolved

Drop: greetings, confirmations, verbose tool outputs, repeated information.${focusLine}

Conversation to summarize:
${conversationText}

Respond with ONLY the summary, no preamble.`;

  return { prompt, toSummarize, toKeep };
}

/**
 * Build compacted messages: summary + recent messages.
 */
export function buildCompactedMessages(
  summary: string,
  keptMessages: CompactionMessage[],
  memoryContext?: string,
): CompactionMessage[] {
  const result: CompactionMessage[] = [];

  // 1. Summary of older conversation
  result.push({
    role: "system",
    text: `[Conversation Summary]\n${summary}`,
  });

  // 2. Re-inject memory/PAW.md if available
  if (memoryContext) {
    result.push({
      role: "system",
      text: `[Context]\n${memoryContext}`,
    });
  }

  // 3. Recent messages (kept intact)
  result.push(...keptMessages);

  return result;
}

/**
 * Compact Codex history (text-based, no tool messages).
 */
export function compactCodexHistory(
  history: { role: "user" | "assistant"; text: string }[],
  summary: string,
  keepRecent = KEEP_RECENT,
): { role: "user" | "assistant"; text: string }[] {
  if (history.length <= keepRecent) return history;

  const kept = history.slice(history.length - keepRecent);
  return [
    { role: "assistant", text: `[Previous conversation summary]\n${summary}` },
    ...kept,
  ];
}

/**
 * Estimate rough "token count" from text (4 chars ≈ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in a message array.
 */
export function estimateMessagesTokens(messages: CompactionMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.text), 0);
}
