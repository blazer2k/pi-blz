// Based on @aphotic/pi-flow-ux's border-status editor, stripped to the essentials.
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Handle } from "./types";

type BorderFn = (c: string) => string;

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function getTotalUsage(ctx: ExtensionContext): {
  inputTokens: number;
  outputTokens: number;
} {
  let inputTokens = 0,
    outputTokens = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      inputTokens += entry.message.usage.input;
      outputTokens += entry.message.usage.output;
    }
  }

  return { inputTokens, outputTokens };
}

export function registerRoundedEditor(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Handle {
  // Render only extension statuses
  ctx.ui.setFooter((_tui, _theme, footerData) => {
    const statuses = footerData.getExtensionStatuses();
    return {
      render(width: number): string[] {
        if (statuses.size === 0) return [];
        const line = [...statuses.values()].join(" ");
        return ["", line];
      },
      invalidate() {},
    };
  });

  ctx.ui.setEditorComponent((tui, theme, kb) => {
    return new RoundedEditor(tui, theme, kb, ctx, pi);
  });

  return {
    dispose() {
      ctx.ui.setEditorComponent(undefined);
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

    let cwd = this.ctx.cwd;
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home && cwd.startsWith(home)) cwd = `~${cwd.slice(home.length)}`;

    return { modelId, pct, pctValue, cwd };
  }

  private buildTopLine(width: number, cwd: string, border: BorderFn): string {
    const topRight = ` ${border(cwd)} `;
    const topGap = Math.max(1, width - 3 - visibleWidth(topRight));
    return `${border("╭")}${border("─".repeat(topGap))}${topRight}${border("─╮")}`;
  }

  private buildBottomLine(
    width: number,
    modelId: string,
    pct: string,
    pctValue: number | null,
    inputTokens: number,
    outputTokens: number,
    border: BorderFn,
  ): string {
    const bottomLeft = ` ${this.ctx.ui.theme.fg("text", modelId)} `;

    let coloredPct: string;

    // pi's default behaviour
    if (pctValue !== null && pctValue > 90) {
      coloredPct = this.ctx.ui.theme.fg("error", pct);
    } else if (pctValue !== null && pctValue > 70) {
      coloredPct = this.ctx.ui.theme.fg("warning", pct);
    } else {
      coloredPct = this.ctx.ui.theme.fg("text", pct);
    }

    let usageStr = "";

    if (inputTokens > 0 && outputTokens > 0) {
      usageStr = this.ctx.ui.theme.fg(
        "text",
        ` ↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`,
      );
    }

    const bottomRight = `${usageStr} ${coloredPct} `;
    const bw = visibleWidth(bottomLeft);
    const rw = visibleWidth(bottomRight);
    const botGap = Math.max(1, width - 4 - bw - rw);
    return `${border("╰─")}${bottomLeft}${border("─".repeat(botGap))}${bottomRight}${border("─╯")}`;
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
    const { inputTokens, outputTokens } = getTotalUsage(this.ctx);
    const { modelId, pct, pctValue, cwd } = this.buildStatusInfo();

    const innerWidth = Math.max(1, width - 2);
    const lines = super.render(innerWidth);
    if (lines.length < 2) return lines;

    const text = this.getText();
    const isBashMode = text.trim().startsWith("!");

    const border = isBashMode
      ? this.ctx.ui.theme.getBashModeBorderColor()
      : this.ctx.ui.theme.getThinkingBorderColor(
          this.pi.getThinkingLevel() ?? "off",
        );

    // Top line
    lines[0] = this.buildTopLine(width, cwd, border);

    // Remove separator line when the editor is expanded
    this.removeSeparatorLine(lines, innerWidth);

    // Bottom line
    lines.push(
      this.buildBottomLine(
        width,
        modelId,
        pct,
        pctValue,
        inputTokens,
        outputTokens,
        border,
      ),
    );

    // Left/right lines
    this.frameInterior(lines, width, innerWidth, border);

    return lines;
  }
}
