import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getDefaultConfig } from "../../config/definition";
import { loadConfig } from "../../config/store";
import { formatToolLabel } from "./labels";
import { setTestConfig } from "../../testing/helpers";

const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-labels-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
});
afterEach(() => {
  if (originalPath === undefined) delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
  rmSync(directory, { recursive: true, force: true });
  loadConfig();
});

describe("formatToolLabel", () => {
  it("keeps capitalization enabled by default", () => {
    expect(getDefaultConfig().tools.capitalizeNames).toBe(true);
    expect(formatToolLabel("read")).toBe("Read");
  });

  it("changes only the first visible character", () => {
    for (const [source, expected] of [
      ["mcp_search", "Mcp_search"],
      ["searchAPI", "SearchAPI"],
      ["Web Search", "Web Search"],
      ["MCP", "MCP"],
      ["", ""],
      [" 2 results", " 2 results"],
      ["[skill]", "[skill]"],
      [" \x1b[31msearch\x1b[0m", " \x1b[31mSearch\x1b[0m"],
      [
        "\x1b]8;;https://example.com\x07search\x1b]8;;\x07",
        "\x1b]8;;https://example.com\x07Search\x1b]8;;\x07",
      ],
      [
        "\x1b]8;;https://example.com\x1b\\search\x1b]8;;\x1b\\",
        "\x1b]8;;https://example.com\x1b\\Search\x1b]8;;\x1b\\",
      ],
      ["\x1b[?25l\x1bsearch", "\x1b[?25l\x1bSearch"],
    ])
      expect(formatToolLabel(source!)).toBe(expected!);
  });

  it("preserves exact spelling and escape sequences when disabled", () => {
    setTestConfig({
      tools: {
        capitalizeNames: false,
      },
    });
    for (const source of [
      "read",
      "searchAPI",
      "Web Search",
      "MCP",
      " \x1b[31msearch\x1b[0m",
      "",
    ]) {
      expect(formatToolLabel(source)).toBe(source);
    }
  });

  it("observes setting changes without rebuilding the helper", () => {
    expect(formatToolLabel("bash")).toBe("Bash");
    setTestConfig({
      tools: {
        capitalizeNames: false,
      },
    });
    expect(formatToolLabel("bash")).toBe("bash");
    setTestConfig({
      tools: {
        capitalizeNames: true,
      },
    });
    expect(formatToolLabel("bash")).toBe("Bash");
  });
});
