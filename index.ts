import { loadConfig, saveConfig } from "./config";
import { search } from "./search";
import {
  type ExtensionAPI,
  getSettingsListTheme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  SelectList,
  type SettingItem,
  SettingsList,
  Text,
} from "@mariozechner/pi-tui";

// console.log(
//   await search(
//     "Hello World",
//     config.limit,
//     config.timeoutMs,
//     config.safesearch,
//   ),
// );

export default function (pi: ExtensionAPI) {
  pi.registerCommand("search-config", {
    description: "Configure search",
    handler: async (_args, ctx) => {
      const config = loadConfig();

      const items: SettingItem[] = [
        {
          id: "limit",
          label: "Results limit",
          description: "Max results from search engines",
          currentValue: String(config.limit),
          values: ["5", "10", "15", "20"],
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
      ];

      await ctx.ui.custom((_tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Search settings")), 1, 0),
        );

        const settingsList = new SettingsList(
          items,
          5,
          getSettingsListTheme(),
          (id, newValue) => {
            saveConfig(id, newValue);
          },
          () => done(undefined),
          { enableSearch: true },
        );

        container.addChild(settingsList);

        return {
          render: (w) => container.render(w),
          handleInput: (data) => settingsList.handleInput?.(data),
          invalidate: () => container.invalidate(),
        };
      });
    },
  });
}
