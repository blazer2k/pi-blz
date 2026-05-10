import {
  type ExtensionAPI,
  DynamicBorder,
  getSettingsListTheme,
} from "@mariozechner/pi-coding-agent";
import {
  type SettingItem,
  SettingsList,
  Container,
  Text,
} from "@mariozechner/pi-tui";
import { type ConfigKey, getConfig, saveConfig } from "../helpers/config";
import { errorMessage } from "../helpers/error";

export function registerConfigCommand(pi: ExtensionAPI) {
  pi.registerCommand("search-config", {
    description: "Configure search",
    handler: async (_args, ctx) => {
      const config = getConfig();

      const items: SettingItem[] = [
        {
          id: "limit",
          label: "Results limit",
          description: "Max results from search engines",
          currentValue: String(config.limit),
          values: ["1", "5", "10", "15", "20"],
        },
        {
          id: "timeoutMs",
          label: "Timeout",
          description: "Request timeout in milliseconds",
          currentValue: String(config.timeoutMs),
          values: ["5000", "10000", "15000", "30000"],
        },
        {
          id: "safesearch",
          label: "SafeSearch",
          description:
            "Filter explicit content (0 = off, 1 = moderate, 2 = strict)",
          currentValue: String(config.safesearch),
          values: ["0", "1", "2"],
        },
        {
          id: "allowPrivateUrls",
          label: "Allow private URLs",
          description: "Allow requests to local and private IP ranges",
          currentValue: String(config.allowPrivateUrls),
          values: ["false", "true"],
        },
        {
          id: "verbose",
          label: "Verbose",
          description: "Render results in tool output",
          currentValue: String(config.verbose),
          values: ["false", "true"],
        },
      ];

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder());

        container.addChild(
          new Text(theme.fg("accent", theme.bold("Search settings")), 1, 0),
        );

        const settingsList = new SettingsList(
          items,
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
