import type { SessionSearchMatch, SessionSummary } from "./session.js";

export function formatRecentSessionsForRecall(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return "No saved sessions yet.";
  }

  return [
    "Recent sessions:",
    ...sessions.map((session, index) => `${index + 1}. ${session.id} — ${session.provider}/${session.model} — ${session.turns} turns — ${session.preview}`),
    "",
    "Use /recall <query> to search specific past work.",
  ].join("\n");
}

export function formatSessionSearchResults(matches: SessionSearchMatch[]): string {
  return matches.map((match, index) => {
    const snippets = match.matchedSnippets
      .map((snippet) => `  - ${snippet.role}: ${snippet.text}`)
      .join("\n");
    return [
      `${index + 1}. ${match.id} — ${match.provider}/${match.model}`,
      `   Updated: ${match.updatedAt}`,
      `   Turns: ${match.turns}`,
      `   Preview: ${match.preview}`,
      snippets,
    ].join("\n");
  }).join("\n\n");
}

export function buildRecallSummaryPrompt(query: string, matches: SessionSearchMatch[]): string {
  const formatted = matches.map((match, index) => {
    const snippets = match.matchedSnippets
      .map((snippet) => `- ${snippet.role}: ${snippet.text}`)
      .join("\n");
    return [
      `Session ${index + 1}: ${match.id}`,
      `Provider/Model: ${match.provider}/${match.model}`,
      `Updated: ${match.updatedAt}`,
      `Turns: ${match.turns}`,
      `Preview: ${match.preview}`,
      `Matched excerpts:\n${snippets}`,
    ].join("\n");
  }).join("\n\n---\n\n");

  return [
    "You are helping recall relevant past conversations from prior Paw sessions.",
    `Focus query: ${query}`,
    "Summarize only what is relevant to the query.",
    "For each useful session, include: what was being done, the important outcome, and any concrete files/commands/details worth reusing.",
    "If nothing in a session is truly useful, omit it.",
    "Keep the answer concise and structured.",
    "",
    formatted,
  ].join("\n");
}
