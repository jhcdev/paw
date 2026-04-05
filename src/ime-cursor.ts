export function measureImeColumn(textBeforeCursor: string): number {
  let col = 5; // border(1) + paddingX(1) + " > "(3)
  for (const ch of textBeforeCursor) {
    col += ch.codePointAt(0)! > 0x7f ? 2 : 1;
  }
  return col + 1; // 1-based column
}

export function getBaseLinesBelowInput(): number {
  // Optional manual override for terminal-specific tuning.
  const raw = process.env.PAW_IME_BASE_LINES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 2;
}

type CursorFooterOptions = {
  baseLinesBelowInput?: number;
  activitySelectorCount?: number;
  activityLogCount?: number;
  runningActivityCount?: number;
  isViewingActivitySelector?: boolean;
  isViewingActivityDetail?: boolean;
};

export function countLinesBelowInput({
  baseLinesBelowInput = getBaseLinesBelowInput(),
  activitySelectorCount = 0,
  activityLogCount = 0,
  runningActivityCount = 0,
  isViewingActivitySelector = false,
  isViewingActivityDetail = false,
}: CursorFooterOptions): number {
  let linesBelow = baseLinesBelowInput; // input border-bottom + status area baseline

  if (isViewingActivitySelector) {
    return linesBelow + activitySelectorCount + 1; // items + hint
  }

  if (isViewingActivityDetail) {
    return linesBelow + activityLogCount + 3; // border + title + logs + hint
  }

  if (runningActivityCount > 0) {
    return linesBelow + runningActivityCount + 1; // items + hint
  }

  return linesBelow;
}
