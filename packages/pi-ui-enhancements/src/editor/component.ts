import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { getConfig, type Config } from "../config";
import { shortenPath } from "../path-utils";
import { frameEditorLines, type BorderFn } from "./frame";
import { formatTokens, type SessionUsage } from "./usage";

type StatusInfo = {
  modelId: string;
  thinkingLevel: string | null;
  pct: string;
  pctValue: number | null;
  cwd: string;
};

export class RoundedEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly pi: ExtensionAPI,
    private readonly getGitBranch: () => string | null,
    private readonly getCurrentUsage: () => SessionUsage,
  ) {
    super(tui, theme, kb, { paddingX: 0 });
  }

  private buildStatusInfo(config: Config): StatusInfo {
    const modelId = this.ctx.model?.id ?? "?";
    const modelContextWindow = this.ctx.model?.contextWindow
      ? formatTokens(this.ctx.model.contextWindow)
      : "?";
    const contextUsage = this.ctx.getContextUsage();
    const pctValue = contextUsage?.percent ?? null;
    const pct =
      pctValue === null
        ? `?%/${modelContextWindow}`
        : `${pctValue.toFixed(1)}%/${modelContextWindow}`;
    const thinkingLevel = this.getVisibleThinkingLevel(config);

    let cwd = shortenPath(this.ctx.cwd);
    const branch = config.roundedEditorShowBranch ? this.getGitBranch() : null;
    if (branch) cwd = `${cwd} (${branch})`;

    return { modelId, pct, pctValue, thinkingLevel, cwd };
  }

  private getVisibleThinkingLevel(config: Config): string | null {
    if (!config.roundedEditorShowThinkingLevel || !this.ctx.model?.reasoning) {
      return null;
    }

    const level = this.pi.getThinkingLevel();
    if (!level || level === "off") return null;

    const supportedLevels = this.ctx.model.thinkingLevelMap;
    return supportedLevels && supportedLevels[level] !== null ? level : null;
  }

  private getBorder(config: Config): BorderFn {
    if (this.getText().trim().startsWith("!")) {
      return this.ctx.ui.theme.getBashModeBorderColor();
    }

    const color = config.roundedEditorColor;
    if (color === "thinking") {
      return this.ctx.ui.theme.getThinkingBorderColor(
        this.pi.getThinkingLevel() ?? "off",
      );
    }

    return (text: string) => this.ctx.ui.theme.fg(color, text);
  }

  override render(width: number): string[] {
    const config = getConfig();
    const lines = super.render(Math.max(1, width - 2));
    if (lines.length < 2) return lines;

    return frameEditorLines(
      lines,
      width,
      {
        ...this.buildStatusInfo(config),
        ...this.getCurrentUsage(),
        showCacheTokens: config.roundedEditorShowCacheTokens,
        showCost: config.roundedEditorShowCost,
      },
      this.ctx.ui.theme,
      this.getBorder(config),
    );
  }
}
