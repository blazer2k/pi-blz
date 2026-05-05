import { loadConfig, saveConfig } from "./config";
import { search } from "./search";
import {
  type ExtensionAPI,
  getSettingsListTheme,
  keyHint,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@mariozechner/pi-tui";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using SearxNG",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),

    async execute(_id, params, signal) {
      const config = loadConfig();

      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: "Search aborted" }],
          details: { query: params.query, resultCount: 0 },
        };
      }

      try {
        const { results } = await search(
          params.query,
          config.limit,
          config.timeoutMs,
          config.safesearch,
        );

        const text =
          results.length === 0
            ? `No results found for "${params.query}"`
            : results
                .map(
                  (r, i) =>
                    `## **${i + 1}.** ${r.title}\n**URL:** ${r.url}\n**Engine:** ${r.engine}\n${r.content}`,
                )
                .join("\n\n---\n\n");

        return {
          content: [{ type: "text", text }],
          details: { query: params.query, resultCount: results.length },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { query: params.query, resultCount: 0 },
        };
      }
    },
    renderCall(args, theme, context_) {
      const query = args.query;
      return new Text(
        theme.fg("toolTitle", "search") +
          " " +
          theme.fg("accent", `"${query}"`),
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      const output = result.content.find((c) => c.type === "text")?.text ?? "";

      let text = "";
      if (output) {
        const lines = output.split("\n");
        const maxLines = options.expanded ? lines.length : 20;
        const displayLines = lines.slice(0, maxLines);
        const remainingLines = lines.length - maxLines;

        text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;

        if (remainingLines > 0) {
          text += `${theme.fg("muted", `\n... (${remainingLines} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
        }
      }
      return new Text(theme.fg("dim", text), 0, 0);
    },
  });

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
