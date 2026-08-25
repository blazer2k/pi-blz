import {
  DynamicBorder,
  getSettingsListTheme,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, SettingsList } from "@earendil-works/pi-tui";
import type { ConfigKey } from "./definition";
import { getSettingItems } from "./settings";
import { getConfig, saveConfig } from "./store";

const TOOL_RENDER_SETTINGS = new Set<ConfigKey>([
  "indicatorStyle",
  "maxCallWidth",
  "maxExpandedEntries",
  "bashCollapsedDisplay",
  "showExpansionHint",
]);

export function registerConfigCommand(
  pi: ExtensionAPI,
  onOpen: () => void,
  onClose: () => void,
): void {
  pi.registerCommand("ui-settings", {
    description: "Open UI settings menu",
    handler: async (_args, context) => {
      if (context.mode !== "tui") {
        context.ui.notify(
          "UI settings are only available in TUI mode",
          "error",
        );
        return;
      }

      onOpen();
      try {
        await context.ui.custom((tui, _theme, _keybindings, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder());

          const settingsList = new SettingsList(
            getSettingItems(getConfig()),
            10,
            getSettingsListTheme(),
            (id, newValue) => {
              try {
                const key = id as ConfigKey;
                saveConfig(key, newValue);

                if (TOOL_RENDER_SETTINGS.has(key)) {
                  tui.invalidate();
                  tui.requestRender();
                }
              } catch (error) {
                context.ui.notify(
                  error instanceof Error ? error.message : String(error),
                  "error",
                );
              }
            },
            () => done(undefined),
            { enableSearch: true },
          );

          container.addChild(settingsList);
          container.addChild(new DynamicBorder());

          return {
            render: (width) => container.render(width),
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
