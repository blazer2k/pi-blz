import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "./usage";

export type BorderFn = (text: string) => string;

export type ScrollIndicators = {
  hiddenAbove: boolean;
  hiddenBelow: boolean;
  contentLineCount: number;
};

export type FooterTheme = {
  fg(color: string, text: string): string;
};

export interface EditorFrameData {
  cwd: string;
  modelId: string;
  thinkingLevel: string | null;
  pct: string;
  pctValue: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  showCacheTokens: boolean;
  showCost: boolean;
}

export function getRightBorderGlyph(
  row: number,
  scroll: ScrollIndicators | null,
): "│" | "▲" | "▼" {
  if (scroll?.hiddenAbove && row === 0) return "▲";
  if (scroll?.hiddenBelow && row === scroll.contentLineCount - 1) return "▼";
  return "│";
}

function buildTopLine(width: number, cwd: string, border: BorderFn): string {
  const cwdBudget = Math.max(1, width - 5);
  const cwdDisplay = truncateToWidth(cwd, cwdBudget, "...");
  const topRight = ` ${border(cwdDisplay)} `;
  const topGap = Math.max(1, width - 3 - visibleWidth(topRight));
  return `${border("╭")}${border("─".repeat(topGap))}${topRight}${border("─╮")}`;
}

function getUsageParts(data: EditorFrameData, theme: FooterTheme): string[] {
  const parts: string[] = [];

  if (data.inputTokens > 0) {
    parts.push(theme.fg("accent", `↑${formatTokens(data.inputTokens)}`));
  }
  if (data.outputTokens > 0) {
    parts.push(theme.fg("accent", `↓${formatTokens(data.outputTokens)}`));
  }
  if (data.showCacheTokens && data.cacheReadTokens > 0) {
    parts.push(theme.fg("accent", `R${formatTokens(data.cacheReadTokens)}`));
  }
  if (data.showCacheTokens && data.cacheWriteTokens > 0) {
    parts.push(theme.fg("accent", `W${formatTokens(data.cacheWriteTokens)}`));
  }
  if (data.showCost && data.totalCost > 0) {
    parts.push(theme.fg("accent", `$${data.totalCost.toFixed(2)}`));
  }

  return parts;
}

function colorContextUsage(data: EditorFrameData, theme: FooterTheme): string {
  if (data.pctValue !== null && data.pctValue > 90) {
    return theme.fg("error", data.pct);
  }
  if (data.pctValue !== null && data.pctValue > 70) {
    return theme.fg("warning", data.pct);
  }
  return theme.fg("text", data.pct);
}

function buildBottomLine(
  width: number,
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
): string {
  const modelParts = [theme.fg("text", data.modelId)];
  if (data.thinkingLevel) {
    modelParts.push(theme.fg("text", `(${data.thinkingLevel})`));
  }

  let bottomLeft = ` ${modelParts.join(" ")} `;
  const usageParts = getUsageParts(data, theme);
  usageParts.push(colorContextUsage(data, theme));
  let bottomRight = ` ${usageParts.join(" ")} `;

  let leftWidth = visibleWidth(bottomLeft);
  let rightWidth = visibleWidth(bottomRight);
  const available = Math.max(1, width - 5);

  if (leftWidth + rightWidth > available) {
    const rightBudget = Math.min(
      rightWidth,
      Math.max(1, Math.floor(available / 2)),
    );
    const leftBudget = Math.max(1, available - rightBudget);
    bottomLeft = truncateToWidth(
      bottomLeft,
      leftBudget,
      theme.fg("text", "..."),
    );
    bottomRight = truncateToWidth(
      bottomRight,
      Math.max(1, available - visibleWidth(bottomLeft)),
      theme.fg("text", "..."),
    );
    leftWidth = visibleWidth(bottomLeft);
    rightWidth = visibleWidth(bottomRight);
  }

  const gapWidth = Math.max(1, width - 4 - leftWidth - rightWidth);
  return `${border("╰─")}${bottomLeft}${border("─".repeat(gapWidth))}${bottomRight}${border("─╯")}`;
}

function removeSeparatorLine(
  lines: string[],
  innerWidth: number,
): ScrollIndicators | null {
  const hiddenAbove = lines[0]?.includes("↑") ?? false;
  const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

  for (let index = lines.length - 1; index > 0; index--) {
    const stripped = plain(lines[index]!);
    const isSeparator =
      stripped.startsWith("─") &&
      [...stripped].filter((character) => character === "─").length >=
        innerWidth / 2;
    if (!isSeparator) continue;

    const scroll = {
      hiddenAbove,
      hiddenBelow: lines[index]!.includes("↓"),
      contentLineCount: index - 1,
    };
    lines.splice(index, 1);
    return scroll.hiddenAbove || scroll.hiddenBelow ? scroll : null;
  }

  return null;
}

function frameInterior(
  lines: string[],
  width: number,
  innerWidth: number,
  border: BorderFn,
  scroll: ScrollIndicators | null,
): void {
  if (width < 3) return;

  const leftBorder = border("│");
  for (let index = 1; index < lines.length - 1; index++) {
    const line = lines[index]!;
    const padding = Math.max(0, innerWidth - visibleWidth(line));
    const rightBorder = border(getRightBorderGlyph(index - 1, scroll));
    lines[index] = `${leftBorder}${line}${" ".repeat(padding)}${rightBorder}`;
  }
}

export function frameEditorLines(
  nativeLines: readonly string[],
  width: number,
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
): string[] {
  const lines = [...nativeLines];
  if (lines.length < 2) return lines;

  const innerWidth = Math.max(1, width - 2);
  const scroll = removeSeparatorLine(lines, innerWidth);
  lines[0] = buildTopLine(width, data.cwd, border);
  lines.push(buildBottomLine(width, data, theme, border));
  frameInterior(lines, width, innerWidth, border, scroll);

  return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

// Mirrors Pi's native footer sanitation and keeps each status on one TUI row.
export function formatStatusLine(
  statuses: ReadonlyMap<string, string>,
  width: number,
  theme: FooterTheme,
): string[] {
  if (statuses.size === 0) return [];
  const parts = [...statuses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, text]) =>
      text
        .replace(/[\r\n\t]/g, " ")
        .replace(/ +/g, " ")
        .trim(),
    )
    .filter((text) => text !== "");
  if (parts.length === 0) return [];
  return ["", truncateToWidth(parts.join(" "), width, theme.fg("dim", "..."))];
}
