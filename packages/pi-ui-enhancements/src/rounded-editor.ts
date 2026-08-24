// Based on @aphotic/pi-flow-ux's border-status editor, stripped to the essentials.
import type { Usage } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getConfig, type Config } from "./config";
import { shortenPath } from "./path-utils";
import type { Handle } from "./types";

export type BorderFn = (c: string) => string;

export type ScrollIndicators = {
  hiddenAbove: boolean;
  hiddenBelow: boolean;
  contentLineCount: number;
};

export function getRightBorderGlyph(
  row: number,
  scroll: ScrollIndicators | null,
): "│" | "▲" | "▼" {
  if (scroll?.hiddenAbove && row === 0) return "▲";
  if (scroll?.hiddenBelow && row === scroll.contentLineCount - 1) return "▼";
  return "│";
}

type RoundedEditorRuntime = {
  invalidateUsage: (() => void) | null;
};

const runtimes = new WeakMap<ExtensionAPI, RoundedEditorRuntime>();

function getRuntime(pi: ExtensionAPI): RoundedEditorRuntime {
  let runtime = runtimes.get(pi);
  if (runtime) return runtime;

  runtime = { invalidateUsage: null };
  pi.on("agent_end", async () => {
    runtime.invalidateUsage?.();
  });
  pi.on("session_compact", async () => {
    runtime.invalidateUsage?.();
  });
  pi.on("session_tree", async () => {
    runtime.invalidateUsage?.();
  });
  runtimes.set(pi, runtime);
  return runtime;
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function getTotalUsage(ctx: ExtensionContext): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCost = 0;

  const add = (usage: Usage | undefined) => {
    if (!usage) return;
    inputTokens += usage.input;
    outputTokens += usage.output;
    cacheReadTokens += usage.cacheRead ?? 0;
    cacheWriteTokens += usage.cacheWrite ?? 0;
    totalCost += usage.cost?.total ?? 0;
  };

  // Match pi's native session accounting
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant") add(entry.message.usage);
      else if (entry.message.role === "toolResult") add(entry.message.usage);
    } else if (
      (entry.type === "branch_summary" || entry.type === "compaction") &&
      entry.usage
    ) {
      add(entry.usage);
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCost,
  };
}

type FooterTheme = { fg(color: string, text: string): string };

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

function buildTopLine(width: number, cwd: string, border: BorderFn): string {
  const cwdBudget = Math.max(1, width - 5);
  const cwdDisplay = truncateToWidth(cwd, cwdBudget, "...");
  const topRight = ` ${border(cwdDisplay)} `;
  const topGap = Math.max(1, width - 3 - visibleWidth(topRight));
  return `${border("╭")}${border("─".repeat(topGap))}${topRight}${border("─╮")}`;
}

function buildBottomLine(
  width: number,
  data: EditorFrameData,
  theme: FooterTheme,
  border: BorderFn,
): string {
  const parts: string[] = [theme.fg("text", data.modelId)];

  if (data.thinkingLevel) {
    parts.push(theme.fg("text", `(${data.thinkingLevel})`));
  }

  let bottomLeft = ` ${parts.join(" ")} `;

  let coloredPct: string;

  // pi's default behaviour
  if (data.pctValue !== null && data.pctValue > 90) {
    coloredPct = theme.fg("error", data.pct);
  } else if (data.pctValue !== null && data.pctValue > 70) {
    coloredPct = theme.fg("warning", data.pct);
  } else {
    coloredPct = theme.fg("text", data.pct);
  }

  const stats: string[] = [];

  if (data.inputTokens > 0) {
    stats.push(theme.fg("accent", `↑${formatTokens(data.inputTokens)}`));
  }
  if (data.outputTokens > 0) {
    stats.push(theme.fg("accent", `↓${formatTokens(data.outputTokens)}`));
  }
  if (data.showCacheTokens && data.cacheReadTokens > 0) {
    stats.push(theme.fg("accent", `R${formatTokens(data.cacheReadTokens)}`));
  }
  if (data.showCacheTokens && data.cacheWriteTokens > 0) {
    stats.push(theme.fg("accent", `W${formatTokens(data.cacheWriteTokens)}`));
  }
  if (data.showCost && data.totalCost > 0) {
    stats.push(theme.fg("accent", `$${data.totalCost.toFixed(2)}`));
  }
  stats.push(coloredPct);

  let bottomRight = ` ${stats.join(" ")} `;
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

  for (let i = lines.length - 1; i > 0; i--) {
    const stripped = plain(lines[i]!);
    if (
      stripped.startsWith("─") &&
      [...stripped].filter((c) => c === "─").length >= innerWidth / 2
    ) {
      const scroll = {
        hiddenAbove,
        hiddenBelow: lines[i]!.includes("↓"),
        contentLineCount: i - 1,
      };
      lines.splice(i, 1);
      return scroll.hiddenAbove || scroll.hiddenBelow ? scroll : null;
    }
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
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const pad = Math.max(0, innerWidth - visibleWidth(line));
    const rightBorder = border(getRightBorderGlyph(i - 1, scroll));
    lines[i] = `${leftBorder}${line}${" ".repeat(pad)}${rightBorder}`;
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

// Mirrors pi's native footer: sort by key, strip line/tabs/CR, collapse and
// trim spaces, then truncate to the terminal width. Keeps the line safe for
// the TUI's one-string-per-row rendering contract.
export function formatStatusLine(
  statuses: ReadonlyMap<string, string>,
  width: number,
  theme: FooterTheme,
): string[] {
  if (statuses.size === 0) return [];
  const parts = [...statuses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
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

export function registerRoundedEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onReregister: (fn: () => void) => void,
): Handle {
  const runtime = getRuntime(pi);
  let gitBranchProvider: (() => string | null) | null = null;
  let requestRender: (() => void) | null = null;
  let footerOwned = false;
  const getGitBranch = (): string | null => gitBranchProvider?.() ?? null;

  let cachedUsage = getTotalUsage(ctx);

  function getCurrentUsage() {
    return cachedUsage;
  }

  const invalidateUsage = () => {
    cachedUsage = getTotalUsage(ctx);
    requestRender?.();
  };
  runtime.invalidateUsage = invalidateUsage;

  // Render only extension statuses. The rounded editor already displays model,
  // context, cost, cwd, and branch info, so pi's default footer would duplicate it.
  ctx.ui.setFooter((tui, theme, footerData) => {
    footerOwned = true;
    requestRender = () => tui.requestRender();
    gitBranchProvider = () => footerData.getGitBranch();
    const statuses = footerData.getExtensionStatuses();
    const disposeBranchChange = footerData.onBranchChange?.(() => {
      tui.requestRender();
    });

    return {
      render(width: number): string[] {
        return formatStatusLine(statuses, width, theme);
      },
      invalidate() {},
      dispose() {
        footerOwned = false;
        disposeBranchChange?.();
      },
    };
  });

  const previousEditorFactory = ctx.ui.getEditorComponent();
  const roundedEditorFactory: NonNullable<
    ReturnType<ExtensionContext["ui"]["getEditorComponent"]>
  > = (tui, theme, kb) => {
    requestRender = () => tui.requestRender();
    return new RoundedEditor(
      tui,
      theme,
      kb,
      ctx,
      pi,
      getGitBranch,
      getCurrentUsage,
    );
  };

  function applyEditor() {
    ctx.ui.setEditorComponent(roundedEditorFactory);
  }
  applyEditor();
  onReregister(applyEditor);

  return {
    dispose() {
      if (runtime.invalidateUsage === invalidateUsage) {
        runtime.invalidateUsage = null;
      }
      requestRender = null;
      if (ctx.ui.getEditorComponent() === roundedEditorFactory) {
        ctx.ui.setEditorComponent(previousEditorFactory);
      }
      if (footerOwned) {
        ctx.ui.setFooter(undefined);
      }
    },
  };
}

class RoundedEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private ctx: ExtensionContext,
    private pi: ExtensionAPI,
    private getGitBranch: () => string | null,
    private getCurrentUsage: () => ReturnType<typeof getTotalUsage>,
  ) {
    super(tui, theme, kb, { paddingX: 0 });
  }

  private buildStatusInfo(config: Config) {
    const modelId = this.ctx.model?.id ?? "?";
    const modelCW = this.ctx.model?.contextWindow
      ? formatTokens(this.ctx.model.contextWindow)
      : "?";
    const usage = this.ctx.getContextUsage();
    const pctValue = usage?.percent ?? null;
    const pct =
      pctValue != null ? `${pctValue.toFixed(1)}%/${modelCW}` : `?%/${modelCW}`;

    // Thinking level indicator (only shown if model supports reasoning effort)
    const rawLevel = this.pi.getThinkingLevel();
    let thinkingLevel: string | null = null;
    if (
      config.roundedEditorShowThinkingLevel &&
      this.ctx.model?.reasoning &&
      rawLevel &&
      rawLevel !== "off"
    ) {
      const map = this.ctx.model.thinkingLevelMap;
      // Show only if model has a thinkingLevelMap and the level isn't explicitly unsupported
      if (map && map[rawLevel] !== null) {
        thinkingLevel = rawLevel;
      }
    }

    let cwd = shortenPath(this.ctx.cwd);

    const branch = config.roundedEditorShowBranch ? this.getGitBranch() : null;
    if (branch) cwd = `${cwd} (${branch})`;

    return { modelId, pct, pctValue, thinkingLevel, cwd };
  }

  override render(width: number): string[] {
    const config = getConfig();
    const {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalCost,
    } = this.getCurrentUsage();
    const { modelId, pct, pctValue, thinkingLevel, cwd } =
      this.buildStatusInfo(config);

    const innerWidth = Math.max(1, width - 2);
    const lines = super.render(innerWidth);
    if (lines.length < 2) return lines;

    const text = this.getText();
    const isBashMode = text.trim().startsWith("!");

    let border: BorderFn;
    if (isBashMode) {
      border = this.ctx.ui.theme.getBashModeBorderColor();
    } else {
      const color = config.roundedEditorColor;
      if (color === "thinking") {
        border = this.ctx.ui.theme.getThinkingBorderColor(
          this.pi.getThinkingLevel() ?? "off",
        );
      } else {
        const theme = this.ctx.ui.theme;
        border = (s: string) => theme.fg(color, s);
      }
    }

    return frameEditorLines(
      lines,
      width,
      {
        cwd,
        modelId,
        thinkingLevel,
        pct,
        pctValue,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalCost,
        showCacheTokens: config.roundedEditorShowCacheTokens,
        showCost: config.roundedEditorShowCost,
      },
      this.ctx.ui.theme,
      border,
    );
  }
}
