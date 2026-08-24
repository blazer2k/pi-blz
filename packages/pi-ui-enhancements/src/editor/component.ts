import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { getConfig, type Config } from "../config";
import { frameEditorLines, type BorderFn } from "./frame";
import { buildEditorFrameData } from "./status";
import type { SessionUsage } from "./usage";

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

  private buildFrameData(config: Config) {
    const thinkingLevel = this.pi.getThinkingLevel();
    const supportedLevels = this.ctx.model?.thinkingLevelMap;

    return buildEditorFrameData(
      {
        cwd: this.ctx.cwd,
        modelId: this.ctx.model?.id,
        modelContextWindow: this.ctx.model?.contextWindow,
        modelSupportsReasoning: this.ctx.model?.reasoning === true,
        activeThinkingLevel: thinkingLevel ?? null,
        activeThinkingLevelSupported: Boolean(
          thinkingLevel &&
          supportedLevels &&
          supportedLevels[thinkingLevel] !== null,
        ),
        contextPercent: this.ctx.getContextUsage()?.percent ?? null,
        gitBranch: config.roundedEditorShowBranch ? this.getGitBranch() : null,
        usage: this.getCurrentUsage(),
      },
      config,
    );
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
      this.buildFrameData(config),
      this.ctx.ui.theme,
      this.getBorder(config),
    );
  }
}
