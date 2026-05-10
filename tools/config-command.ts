import {
  type ExtensionAPI,
  DynamicBorder,
  getSettingsListTheme,
} from "@mariozechner/pi-coding-agent";
import { SettingsList, Container, Text } from "@mariozechner/pi-tui";
import { type ConfigKey, getConfig, saveConfig } from "../helpers/config";
import { getSettingsList } from "../ui/settings-list";
import { errorMessage } from "../helpers/error";

export function registerConfigCommand(pi: ExtensionAPI) {
  pi.registerCommand("search-config", {
    description: "Configure search",
    handler: async (_args, ctx) => {
      const config = getConfig();
      const list = getSettingsList(config);

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder());

        container.addChild(
          new Text(theme.fg("accent", theme.bold("Search settings")), 1, 0),
        );

        const settingsList = new SettingsList(
          list,
          5,
          getSettingsListTheme(),
          (id, newValue) => {
            try {
              saveConfig(id as ConfigKey, newValue);
            } catch (err) {
              ctx.ui.notify(errorMessage(err), "error");
            }
          },
          () => done(undefined),
          { enableSearch: true },
        );

        container.addChild(settingsList);
        container.addChild(new DynamicBorder());

        return {
          render: (w) => container.render(w),
          handleInput: (data) => settingsList.handleInput?.(data),
          invalidate: () => container.invalidate(),
        };
      });
    },
  });
}
