// Based on @aphotic/pi-flow-ux's border-status editor, stripped to the essentials.
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { getConfig } from "./config";
import type { Handle } from "./types";

type BorderFn = (c: string) => string;

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

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      const usage = entry.message.usage;
      inputTokens += usage.input;
      outputTokens += usage.output;
      cacheReadTokens += usage.cacheRead ?? 0;
      cacheWriteTokens += usage.cacheWrite ?? 0;
      totalCost += usage.cost?.total ?? 0;
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

export function registerRoundedEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  onReregister: (fn: () => void) => void,
): Handle {
  const runtime = getRuntime(pi);
  let gitBranchProvider: (() => string | null) | null = null;
  let requestRender: (() => void) | null = null;
  const getGitBranch = (): string | null => gitBranchProvider?.() ?? null;

  function getCurrentUsage() {
    return getTotalUsage(ctx);
  }

  const invalidateUsage = () => {
    requestRender?.();
  };
  runtime.invalidateUsage = invalidateUsage;

  // Render only extension statuses. The rounded editor already displays model,
  // context, cost, cwd, and branch info, so pi's default footer would duplicate it.
  ctx.ui.setFooter((tui, _theme, footerData) => {
    requestRender = () => tui.requestRender();
    gitBranchProvider = () => footerData.getGitBranch();
    const statuses = footerData.getExtensionStatuses();
    const disposeBranchChange = footerData.onBranchChange?.(() => {
      tui.requestRender();
    });

    return {
      render(_width: number): string[] {
        if (statuses.size === 0) return [];
        const line = [...statuses.values()].join(" ");
        return ["", line];
      },
      invalidate() {},
      dispose: disposeBranchChange,
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
      ctx.ui.setFooter(undefined);
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

  private buildStatusInfo() {
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
      getConfig().roundedEditorShowThinkingLevel &&
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

    let cwd = this.ctx.cwd;
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home && cwd.startsWith(home)) cwd = `~${cwd.slice(home.length)}`;

    const branch = getConfig().roundedEditorShowBranch
      ? this.getGitBranch()
      : null;
    if (branch) cwd = `${cwd} (${branch})`;

    return { modelId, pct, pctValue, thinkingLevel, cwd };
  }

  private buildTopLine(width: number, cwd: string, border: BorderFn): string {
    const cwdBudget = Math.max(1, width - 5);
    const cwdDisplay = truncateToWidth(cwd, cwdBudget, "...");
    const topRight = ` ${border(cwdDisplay)} `;
    const topGap = Math.max(1, width - 3 - visibleWidth(topRight));
    return `${border("╭")}${border("─".repeat(topGap))}${topRight}${border("─╮")}`;
  }

  private buildBottomLine(
    width: number,
    modelId: string,
    thinkingLevel: string | null,
    pct: string,
    pctValue: number | null,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    totalCost: number,
    border: BorderFn,
  ): string {
    const theme = this.ctx.ui.theme;
    const parts: string[] = [theme.fg("text", modelId)];

    if (thinkingLevel) {
      parts.push(theme.fg("text", `(${thinkingLevel})`));
    }

    const bottomLeft = ` ${parts.join(" ")} `;

    let coloredPct: string;

    // pi's default behaviour
    if (pctValue !== null && pctValue > 90) {
      coloredPct = theme.fg("error", pct);
    } else if (pctValue !== null && pctValue > 70) {
      coloredPct = theme.fg("warning", pct);
    } else {
      coloredPct = theme.fg("text", pct);
    }

    const stats: string[] = [];

    if (inputTokens > 0) {
      stats.push(theme.fg("accent", `↑${formatTokens(inputTokens)}`));
    }
    if (outputTokens > 0) {
      stats.push(theme.fg("accent", `↓${formatTokens(outputTokens)}`));
    }
    const cfg = getConfig();
    if (cfg.roundedEditorShowCacheTokens && cacheReadTokens > 0) {
      stats.push(theme.fg("accent", `R${formatTokens(cacheReadTokens)}`));
    }
    if (cfg.roundedEditorShowCacheTokens && cacheWriteTokens > 0) {
      stats.push(theme.fg("accent", `W${formatTokens(cacheWriteTokens)}`));
    }
    if (cfg.roundedEditorShowCost && totalCost > 0) {
      stats.push(theme.fg("accent", `$${totalCost.toFixed(1)}`));
    }
    stats.push(coloredPct);

    let bottomRight = ` ${stats.join(" ")} `;
    let left = bottomLeft;
    let bw = visibleWidth(left);
    let rw = visibleWidth(bottomRight);
    const available = Math.max(1, width - 5);

    if (bw + rw > available) {
      const rightBudget = Math.min(rw, Math.max(1, Math.floor(available / 2)));
      const leftBudget = Math.max(1, available - rightBudget);
      left = truncateToWidth(left, leftBudget, theme.fg("text", "..."));
      bottomRight = truncateToWidth(
        bottomRight,
        Math.max(1, available - visibleWidth(left)),
        theme.fg("text", "..."),
      );
      bw = visibleWidth(left);
      rw = visibleWidth(bottomRight);
    }

    const botGap = Math.max(1, width - 4 - bw - rw);
    return `${border("╰─")}${left}${border("─".repeat(botGap))}${bottomRight}${border("─╯")}`;
  }

  private removeSeparatorLine(lines: string[], innerWidth: number): void {
    const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
    for (let i = lines.length - 1; i > 0; i--) {
      const stripped = plain(lines[i]!);
      if (
        stripped.startsWith("─") &&
        [...stripped].filter((c) => c === "─").length >= innerWidth / 2
      ) {
        lines.splice(i, 1);
        break;
      }
    }
  }

  private frameInterior(
    lines: string[],
    width: number,
    innerWidth: number,
    border: BorderFn,
  ): void {
    if (width >= 3) {
      const v = border("│");
      for (let i = 1; i < lines.length - 1; i++) {
        const line = lines[i]!;
        const pad = Math.max(0, innerWidth - visibleWidth(line));
        lines[i] = `${v}${line}${" ".repeat(pad)}${v}`;
      }
    }
  }

  override render(width: number): string[] {
    const {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalCost,
    } = this.getCurrentUsage();
    const { modelId, pct, pctValue, thinkingLevel, cwd } =
      this.buildStatusInfo();

    const innerWidth = Math.max(1, width - 2);
    const lines = super.render(innerWidth);
    if (lines.length < 2) return lines;

    const text = this.getText();
    const isBashMode = text.trim().startsWith("!");

    let border: BorderFn;
    if (isBashMode) {
      border = this.ctx.ui.theme.getBashModeBorderColor();
    } else {
      const color = getConfig().roundedEditorColor;
      if (color === "thinking") {
        border = this.ctx.ui.theme.getThinkingBorderColor(
          this.pi.getThinkingLevel() ?? "off",
        );
      } else {
        const theme = this.ctx.ui.theme;
        border = (s: string) => theme.fg(color, s);
      }
    }

    // Top line
    lines[0] = this.buildTopLine(width, cwd, border);

    // Remove separator line when the editor is expanded
    this.removeSeparatorLine(lines, innerWidth);

    // Bottom line
    lines.push(
      this.buildBottomLine(
        width,
        modelId,
        thinkingLevel,
        pct,
        pctValue,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalCost,
        border,
      ),
    );

    // Left/right lines
    this.frameInterior(lines, width, innerWidth, border);

    return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
  }
}
