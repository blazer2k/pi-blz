import {
  DynamicBorder,
  getSelectListTheme,
  getSettingsListTheme,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  type SettingItem,
  type SelectItem,
  Container,
  Text,
  SelectList,
  SettingsList,
} from "@earendil-works/pi-tui";
import {
  type Config,
  type ConfigKey,
  getConfig,
  saveConfig,
  ALLOWED_FONTS,
} from "./config";

function getAsciiHeaderSettings(config: Config): SettingItem[] {
  return [
    {
      id: "asciiHeaderEnabled",
      label: "Enable ASCII header",
      description: "Show ASCII art header at session start",
      currentValue: String(config.asciiHeaderEnabled),
      values: ["false", "true"],
    },
    {
      id: "asciiHeaderFont",
      label: "Header font",
      description: "Font for ASCII art header",
      currentValue: String(config.asciiHeaderFont),
      submenu: (currentValue, done) => {
        const items: SelectItem[] = ALLOWED_FONTS.map((font) => ({
          label: font,
          value: font,
        }));

        const list = new SelectList(
          items,
          Math.min(items.length, 10),
          getSelectListTheme(),
        );

        const currentIndex = items.findIndex(
          (item) => item.value === currentValue,
        );
        if (currentIndex > 0) {
          list.setSelectedIndex(currentIndex);
        }
        list.onSelect = (item) => done(item.value);
        list.onCancel = () => done();

        return list;
      },
    },
    {
      id: "asciiHeaderColor",
      label: "Header color",
      description: "Theme color of ASCII header",
      currentValue: String(config.asciiHeaderColor),
      values: ["text", "accent", "dim"],
    },
    {
      id: "asciiHeaderAlign",
      label: "Header alignment",
      description: "Horizontal alignment of ASCII header",
      currentValue: String(config.asciiHeaderAlign),
      values: ["left", "center", "right"],
    },
    {
      id: "asciiHeaderShowVersion",
      label: "Show version",
      description: "Display pi version below ASCII header",
      currentValue: String(config.asciiHeaderShowVersion),
      values: ["false", "true"],
    },
  ] satisfies SettingItem[];
}

function getWorkingIndicatorSettings(config: Config): SettingItem[] {
  return [
    {
      id: "workingIndicatorShowInterruptMsg",
      label: "Show interrupt hint",
      description: `Show "esc to interrupt" next to the working indicator`,
      currentValue: String(config.workingIndicatorShowInterruptMsg),
      values: ["false", "true"],
    },
    {
      id: "workingIndicatorShowDuration",
      label: "Show run duration",
      description: "Show how long the current task has been running",
      currentValue: String(config.workingIndicatorShowDuration),
      values: ["false", "true"],
    },
  ] satisfies SettingItem[];
}

function getToolRenderingSettings(config: Config): SettingItem[] {
  return [
    {
      id: "patchCustomTools",
      label: "Patch custom tools",
      description: "Apply compact rendering to third-party tools",
      currentValue: String(config.patchCustomTools),
      values: ["false", "true"],
    },
    {
      id: "maxCallWidth",
      label: "Max call width",
      description: "Maximum width for tool call and output lines",
      currentValue: String(config.maxCallWidth),
      values: ["40", "60", "80", "100", "120", "160", "200"],
    },
    {
      id: "maxExpandedEntries",
      label: "Max expanded entries",
      description: "Maximum number of lines to show when expanding tool output",
      currentValue: String(config.maxExpandedEntries),
      values: ["-1", "10", "20", "50", "100"],
    },
  ] satisfies SettingItem[];
}

function getRoundedEditorSettings(config: Config): SettingItem[] {
  return [
    {
      id: "roundedEditorColor",
      label: "Editor border color",
      description: "How the editor border is colored",
      currentValue: String(config.roundedEditorColor),
      values: ["thinking", "dim", "muted"],
    },
    {
      id: "roundedEditorShowThinkingLevel",
      label: "Show thinking level",
      description: "Display thinking level in editor footer",
      currentValue: String(config.roundedEditorShowThinkingLevel),
      values: ["false", "true"],
    },
    {
      id: "roundedEditorShowCacheTokens",
      label: "Show cache tokens",
      description: "Display cache read/write token counts",
      currentValue: String(config.roundedEditorShowCacheTokens),
      values: ["false", "true"],
    },
    {
      id: "roundedEditorShowCost",
      label: "Show cost",
      description: "Display total session cost in editor footer",
      currentValue: String(config.roundedEditorShowCost),
      values: ["false", "true"],
    },
    {
      id: "roundedEditorShowBranch",
      label: "Show git branch",
      description: "Display current git branch in editor header",
      currentValue: String(config.roundedEditorShowBranch),
      values: ["false", "true"],
    },
  ] satisfies SettingItem[];
}

export function registerConfigCommand(
  pi: ExtensionAPI,
  onOpen: () => void,
  onClose: () => void,
) {
  pi.registerCommand("ui", {
    description: "Open UI settings menu",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("UI settings are only available in TUI mode", "error");
        return;
      }

      onOpen();
      try {
        await ctx.ui.custom((tui, theme, _kb, done) => {
          const settingsListTheme = getSettingsListTheme();

          const container = new Container();
          container.addChild(new DynamicBorder());
          container.addChild(
            new Text(theme.fg("accent", theme.bold("UI configuration")), 1, 1),
          );

          const config = getConfig();

          const items = [
            ...getAsciiHeaderSettings(config),
            ...getWorkingIndicatorSettings(config),
            ...getToolRenderingSettings(config),
            ...getRoundedEditorSettings(config),
          ];

          const settingsList = new SettingsList(
            items,
            5,
            settingsListTheme,
            (id, newValue) => {
              try {
                saveConfig(id as ConfigKey, newValue);
              } catch (err) {
                ctx.ui.notify(
                  err instanceof Error ? err.message : String(err),
                  "error",
                );
              }
            },
            () => {
              done(undefined);
            },
          );

          container.addChild(settingsList);
          container.addChild(new DynamicBorder());

          return {
            render: (w) => container.render(w),
            handleInput: (data) => {
              settingsList.handleInput?.(data);
              tui.requestRender();
            },
            invalidate: () => container.invalidate(),
          };
        });
      } finally {
        onClose();
      }
    },
  });
}
