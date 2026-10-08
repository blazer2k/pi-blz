import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  adaptNativeEditorLayout,
  type ScrollIndicators,
} from "./native-layout";
import { formatTokens } from "./usage";

export type { ScrollIndicators } from "./native-layout";

export type BorderFn = (text: string) => string;
export type EditorStatusIndicator = NonNullable<
  Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]
>;

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

function buildTopLine(
  width: number,
  cwd: string,
  border: BorderFn,
  rounded: boolean,
  indicator?: EditorStatusIndicator,
): string {
  if (indicator) {
    if (width < 8) return indicator.renderSpinnerInBorder(Math.max(0, width));
    const available = width - 6;
    let status = indicator.renderInBorder(available);
    if (visibleWidth(status) + 2 > available)
      status = indicator.renderSpinnerInBorder(available);
    if (status) {
      const cwdDisplay = truncateToWidth(
        cwd,
        Math.max(0, available - visibleWidth(status) - 3),
        "...",
      );
      const left = border(rounded ? "╭─ " : "── ") + status + border(" ");
      const right = border(
        ` ${cwdDisplay ? cwdDisplay + " " : ""}${rounded ? "─╮" : "──"}`,
      );
      const gap = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
      return left + border("─".repeat(gap)) + right;
    }
  }
  const cwdBudget = Math.max(1, width - 5);
  const cwdDisplay = truncateToWidth(cwd, cwdBudget, "...");
  const topRight = ` ${border(cwdDisplay)} `;
  const topGap = Math.max(1, width - 3 - visibleWidth(topRight));
  return `${border(rounded ? "╭" : "─")}${border("─".repeat(topGap))}${topRight}${border(rounded ? "─╮" : "──")}`;
}

function getUsageParts(data: EditorFrameData, border: BorderFn): string[] {
  const parts: string[] = [];

  if (data.inputTokens > 0) {
    parts.push(border(`↑${formatTokens(data.inputTokens)}`));
  }
  if (data.outputTokens > 0) {
    parts.push(border(`↓${formatTokens(data.outputTokens)}`));
  }
  if (data.showCacheTokens && data.cacheReadTokens > 0) {
    parts.push(border(`R${formatTokens(data.cacheReadTokens)}`));
  }
  if (data.showCacheTokens && data.cacheWriteTokens > 0) {
    parts.push(border(`W${formatTokens(data.cacheWriteTokens)}`));
  }
  if (data.showCost && data.totalCost > 0) {
    parts.push(border(`$${data.totalCost.toFixed(2)}`));
  }

  return parts;
}

function colorContextUsage(
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
): string {
  if (data.pctValue !== null && data.pctValue > 90) {
    return theme.fg("error", data.pct);
  }
  if (data.pctValue !== null && data.pctValue > 70) {
    return theme.fg("warning", data.pct);
  }
  return border(data.pct);
}

function getBottomParts(
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
): { left: string; right: string } {
  const modelParts = [border(data.modelId)];
  if (data.thinkingLevel) {
    modelParts.push(border(`(${data.thinkingLevel})`));
  }

  const usageParts = getUsageParts(data, border);
  usageParts.push(colorContextUsage(data, theme, border));
  return {
    left: ` ${modelParts.join(" ")} `,
    right: ` ${usageParts.join(" ")} `,
  };
}

function buildBottomLine(
  width: number,
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
  rounded: boolean,
): string {
  const parts = getBottomParts(data, theme, border);
  let bottomLeft = parts.left;
  let bottomRight = parts.right;
  let leftWidth = visibleWidth(bottomLeft);
  let rightWidth = visibleWidth(bottomRight);
  const available = Math.max(1, width - 5);

  if (leftWidth + rightWidth > available) {
    const rightBudget = Math.min(
      rightWidth,
      Math.max(1, Math.floor(available / 2)),
    );
    const leftBudget = Math.max(1, available - rightBudget);
    bottomLeft = truncateToWidth(bottomLeft, leftBudget, border("..."));
    bottomRight = truncateToWidth(
      bottomRight,
      Math.max(1, available - visibleWidth(bottomLeft)),
      border("..."),
    );
    leftWidth = visibleWidth(bottomLeft);
    rightWidth = visibleWidth(bottomRight);
  }

  const gapWidth = Math.max(1, width - 4 - leftWidth - rightWidth);
  return `${border(rounded ? "╰─" : "──")}${bottomLeft}${border("─".repeat(gapWidth))}${bottomRight}${border(rounded ? "─╯" : "──")}`;
}

function buildScrollLine(
  width: number,
  left: string,
  right: string,
  direction: "↑" | "↓",
  count: number,
  border: BorderFn,
): string {
  if (width <= 0) return "";
  let notice = ` ${direction} ${count} more `;
  if (visibleWidth(notice) + 2 > width) notice = ` ${direction} ${count} `;
  if (visibleWidth(notice) > width) notice = direction;
  const noticeWidth = visibleWidth(notice);
  const start = Math.floor((width - noticeWidth) / 2);
  const leftBlock = truncateToWidth(
    left ? border("──") + left : "",
    Math.max(0, start - 1),
    border("..."),
  );
  const rightBlock = truncateToWidth(
    right ? right + border("──") : "",
    Math.max(0, width - start - noticeWidth - 1),
    border("..."),
  );
  return (
    leftBlock +
    border("─".repeat(start - visibleWidth(leftBlock))) +
    border(notice) +
    border("─".repeat(width - start - noticeWidth - visibleWidth(rightBlock))) +
    rightBlock
  );
}

export function buildCompactTopLine(
  width: number,
  cwd: string,
  border: BorderFn,
  hiddenLineCount: number,
  indicator?: EditorStatusIndicator,
): string {
  let status = "";
  if (indicator && hiddenLineCount > 0) {
    const noticeWidth = visibleWidth(` ↑ ${hiddenLineCount} more `);
    const statusBudget = Math.max(0, Math.floor((width - noticeWidth) / 2) - 4);
    if (statusBudget === 0)
      return truncateToWidth(
        buildTopLine(width, cwd, border, false, indicator),
        Math.max(0, width),
        "",
      );
    status = indicator.renderInBorder(Math.max(0, width));
    if (visibleWidth(status) > statusBudget)
      status = indicator.renderSpinnerInBorder(statusBudget);
  }
  const line =
    hiddenLineCount > 0
      ? buildScrollLine(
          width,
          status ? ` ${status} ` : "",
          ` ${border(cwd)} `,
          "↑",
          hiddenLineCount,
          border,
        )
      : buildTopLine(width, cwd, border, false, indicator);
  return truncateToWidth(line, Math.max(0, width), "");
}

export function buildCompactBottomLine(
  width: number,
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
  hiddenLineCount: number,
): string {
  if (hiddenLineCount > 0) {
    const { left, right } = getBottomParts(data, theme, border);
    return buildScrollLine(width, left, right, "↓", hiddenLineCount, border);
  }
  return truncateToWidth(
    buildBottomLine(width, data, theme, border, false),
    Math.max(0, width),
    "",
  );
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
  indicator?: EditorStatusIndicator,
): string[] {
  if (nativeLines.length < 2) return [...nativeLines];

  const nativeLayout = adaptNativeEditorLayout(nativeLines);
  if (!nativeLayout.compatible) {
    return nativeLayout.lines.map((line) =>
      truncateToWidth(line, Math.max(0, width), ""),
    );
  }

  const { lines, scroll } = nativeLayout;
  const innerWidth = Math.max(1, width - 2);
  lines[0] = buildTopLine(width, data.cwd, border, true, indicator);
  lines.push(buildBottomLine(width, data, theme, border, true));
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
