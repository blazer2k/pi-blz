import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig } from "../config/store";
import {
  buildCompactTopLine,
  buildCompactBottomLine,
  frameEditorLines,
  type BorderFn,
  type EditorStatusIndicator,
} from "./frame";
import { buildEditorFrameData } from "./status";
import type { SessionUsage } from "./usage";

export class EnhancedEditor extends CustomEditor {
  private nativeStatusIndicator?: EditorStatusIndicator;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    kb: KeybindingsManager,
    private readonly ctx: ExtensionContext,
    private readonly pi: ExtensionAPI,
    private readonly getGitBranch: () => string | null,
    private readonly getCurrentUsage: () => SessionUsage,
    private readonly style: Exclude<Config["editor"]["style"], "native">,
  ) {
    super(tui, theme, kb, {
      paddingX: style === "rounded" ? 0 : 1,
      embedWorkingStatus: getConfig().workingIndicator.style === "native",
    });
  }

  override setWorkingStatusIndicator(
    indicator: EditorStatusIndicator | undefined,
  ): void {
    // Our final frame draws the indicator; keep Pi's intermediate border plain.
    super.setWorkingStatusIndicator(undefined);
    this.nativeStatusIndicator = this.embedWorkingStatus
      ? indicator
      : undefined;
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
        gitBranch: config.editor.showBranch ? this.getGitBranch() : null,
        usage: this.getCurrentUsage(),
      },
      config,
    );
  }

  private getBorder(config: Config): BorderFn {
    if (this.getText().trim().startsWith("!")) {
      return this.ctx.ui.theme.getBashModeBorderColor();
    }

    const color = config.editor.color;
    if (color === "thinking") {
      return this.ctx.ui.theme.getThinkingBorderColor(
        this.pi.getThinkingLevel() ?? "off",
      );
    }

    return (text: string) => this.ctx.ui.theme.fg(color, text);
  }

  protected override renderTopBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (this.style !== "compact")
      return super.renderTopBorder(width, hiddenLineCount);
    const config = getConfig();
    return buildCompactTopLine(
      width,
      this.buildFrameData(config).cwd,
      this.getBorder(config),
      hiddenLineCount,
      this.nativeStatusIndicator,
    );
  }

  protected override renderBottomBorder(
    width: number,
    hiddenLineCount: number,
  ): string {
    if (this.style !== "compact")
      return super.renderBottomBorder(width, hiddenLineCount);
    const config = getConfig();
    return buildCompactBottomLine(
      width,
      this.buildFrameData(config),
      this.ctx.ui.theme,
      this.getBorder(config),
      hiddenLineCount,
    );
  }

  override render(width: number): string[] {
    const config = getConfig();
    if (this.style === "compact") {
      return super
        .render(Math.max(1, width))
        .map((line) => truncateToWidth(line, Math.max(0, width), ""));
    }
    const lines = super.render(Math.max(1, width - 2));
    if (lines.length < 2) return lines;

    return frameEditorLines(
      lines,
      width,
      this.buildFrameData(config),
      this.ctx.ui.theme,
      this.getBorder(config),
      this.nativeStatusIndicator,
    );
  }
}
