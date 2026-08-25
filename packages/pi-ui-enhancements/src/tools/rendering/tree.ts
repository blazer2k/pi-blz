import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  sliceByColumn,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  getBlinkIndicator,
  getMaxCallWidth,
  getStatusColor,
  getStatusSymbol,
  isBlinkOn,
  updateBlinkTimer,
} from "./state";
import { safeTruncateToWidth, stripAnsi } from "./text";
import type { BaseRenderState } from "./types";

export function formatOmissionRow(
  hiddenCount: number,
  noun: { singular: string; plural: string },
  theme: Theme,
): string {
  const label = `${hiddenCount} hidden ${
    hiddenCount === 1 ? noun.singular : noun.plural
  }`;
  return theme.fg("dim", "│  ⋮  " + theme.italic(label));
}

export function formatTreeLine(
  line: string,
  options: {
    theme: Theme;
    prefix: "│  " | "├─ " | "╰─ ";
    width: number;
    mode: "truncate" | "preserve";
    color?: "toolOutput" | "error" | "muted";
  },
): { text: string; truncated: boolean } {
  const { theme, prefix, width, mode, color } = options;
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const truncated = mode === "truncate" && visibleWidth(line) > contentWidth;
  const renderedLine = truncated
    ? truncateToWidth(line, contentWidth, theme.fg(color ?? "muted", "..."))
    : line;
  const styledLine =
    color === undefined ? renderedLine : theme.fg(color, renderedLine);

  return {
    text: theme.fg("dim", prefix) + styledLine,
    truncated,
  };
}

export function setExpandableCallText(
  text: Text,
  state: BaseRenderState,
  options: {
    expanded: boolean;
    collapsedText: string;
    fullText: string;
    compactIsLossy?: boolean;
    ellipsis: string;
  },
): void {
  const maxWidth = getMaxCallWidth();
  state.callExpandable =
    options.compactIsLossy === true ||
    options.fullText.includes("\n") ||
    visibleWidth(options.fullText) > maxWidth;
  text.setText(
    options.expanded
      ? options.fullText
      : safeTruncateToWidth(options.collapsedText, maxWidth, options.ellipsis),
  );
}

export function getCallRenderParts(
  state: BaseRenderState,
  theme: Theme,
  toolContext: {
    executionStarted?: boolean;
    isPartial?: boolean;
    invalidate: () => void;
  },
  renderOptions?: {
    paddingX?: number;
    animate?: boolean;
    staticActive?: boolean;
  },
): { text: Text; prefix: string; isDone: boolean } {
  const text = new TreeText(
    renderOptions?.paddingX ?? 1,
    theme.fg("dim", "│  "),
  );

  const isDone =
    state.hasResult ||
    (!toolContext.executionStarted && !toolContext.isPartial);
  const staticActive = renderOptions?.staticActive === true && !isDone;
  const animate = (renderOptions?.animate ?? true) && !staticActive;
  const blinkOn = animate ? isBlinkOn() : false;
  state.blinkOn = blinkOn;

  updateBlinkTimer(state, animate && !isDone, toolContext.invalidate);

  const color = staticActive ? "accent" : getStatusColor(isDone, blinkOn);
  const symbol = staticActive
    ? getBlinkIndicator().unfilled
    : getStatusSymbol(isDone, blinkOn);
  const prefix = theme.fg(color, `${symbol} `);

  return { text, prefix, isDone };
}

function wrapTreeText(
  text: string,
  width: number,
  callContinuationPrefix?: string,
): string {
  if (!text || width <= 3) return text;

  return text
    .split("\n")
    .flatMap((line, sourceLineIndex) => {
      const lineWidth = visibleWidth(line);
      const prefix = sliceByColumn(line, 0, 3);
      const visiblePrefix = stripAnsi(prefix);
      const hasTreePrefix = /^[│├╰┊][─ ] /u.test(visiblePrefix);

      if (!hasTreePrefix && callContinuationPrefix) {
        const chunks = wrapTextWithAnsi(line, Math.max(1, width - 3));
        return chunks.map((chunk, chunkIndex) =>
          sourceLineIndex === 0 && chunkIndex === 0
            ? chunk
            : callContinuationPrefix + chunk,
        );
      }

      if (lineWidth <= width) return [line];
      if (!hasTreePrefix) return wrapTextWithAnsi(line, width);

      const content = sliceByColumn(line, 3, lineWidth - 3);
      const chunks = wrapTextWithAnsi(content, Math.max(1, width - 3));
      const continuationPrefix = prefix
        .replace("├─ ", "│  ")
        .replace("╰─ ", "│  ");

      return chunks.map((chunk, index) => {
        const isLastChunk = index === chunks.length - 1;
        const chunkPrefix =
          visiblePrefix === "╰─ "
            ? isLastChunk
              ? prefix
              : continuationPrefix
            : index === 0
              ? prefix
              : continuationPrefix;
        return chunkPrefix + chunk;
      });
    })
    .join("\n");
}

class TreeText extends Text {
  private sourceText = "";
  private renderedSource?: string;
  private renderedWidth?: number;

  constructor(
    private readonly horizontalPadding: number,
    private readonly callContinuationPrefix?: string,
  ) {
    super("", horizontalPadding, 0);
  }

  override setText(text: string): void {
    if (text === this.sourceText) return;
    this.sourceText = text;
    this.renderedSource = undefined;
    this.renderedWidth = undefined;
  }

  override render(width: number): string[] {
    if (
      this.renderedSource !== this.sourceText ||
      this.renderedWidth !== width
    ) {
      super.setText(
        wrapTreeText(
          this.sourceText,
          Math.max(1, width - this.horizontalPadding * 2),
          this.callContinuationPrefix,
        ),
      );
      this.renderedSource = this.sourceText;
      this.renderedWidth = width;
    }
    return super.render(width);
  }
}

export function getResultText(
  state: BaseRenderState,
  options: ToolRenderResultOptions,
  lastComponent: unknown,
  renderOptions?: { paddingX?: number },
): Text {
  const paddingX = renderOptions?.paddingX ?? 1;
  const previousText =
    lastComponent instanceof TreeText ? lastComponent : undefined;
  const text =
    state.expanded !== options.expanded || !previousText
      ? new TreeText(paddingX)
      : previousText;

  state.expanded = options.expanded;
  return text;
}
