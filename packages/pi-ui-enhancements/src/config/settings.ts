import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
  SelectList,
  type SelectItem,
  type SettingItem,
} from "@earendil-works/pi-tui";
import { ALLOWED_FONTS, type Config, type ConfigKey } from "./definition";

type SettingDefinition = Omit<SettingItem, "id" | "currentValue"> & {
  id: ConfigKey;
};

export type ConfigSettingItem = SettingItem & { id: ConfigKey };

const BOOLEAN_VALUES = ["false", "true"];

const fontSubmenu: NonNullable<SettingItem["submenu"]> = (
  currentValue,
  done,
) => {
  const items: SelectItem[] = ALLOWED_FONTS.map((font) => ({
    label: font,
    value: font,
  }));
  const list = new SelectList(
    items,
    Math.min(items.length, 10),
    getSelectListTheme(),
  );
  const currentIndex = items.findIndex((item) => item.value === currentValue);
  if (currentIndex > 0) list.setSelectedIndex(currentIndex);
  list.onSelect = (item) => done(item.value);
  list.onCancel = () => done();
  return list;
};

const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ASCII header
  {
    id: "asciiHeaderEnabled",
    label: "Enable ASCII header",
    description: "Show ASCII art header at session start",
    values: BOOLEAN_VALUES,
  },
  {
    id: "asciiHeaderFont",
    label: "Header font",
    description: "Font for ASCII header",
    submenu: fontSubmenu,
  },
  {
    id: "asciiHeaderColor",
    label: "Header color",
    description: "Theme color of ASCII header",
    values: ["text", "accent", "dim"],
  },
  {
    id: "asciiHeaderAlign",
    label: "Header alignment",
    description: "Horizontal alignment of ASCII header",
    values: ["left", "center", "right"],
  },
  {
    id: "asciiHeaderShowVersion",
    label: "Show version",
    description: "Display pi version below ASCII header",
    values: BOOLEAN_VALUES,
  },

  // Working indicator
  {
    id: "workingIndicatorShowInterruptMsg",
    label: "Show interrupt hint",
    description: 'Show "esc to interrupt" next to the working indicator',
    values: BOOLEAN_VALUES,
  },
  {
    id: "workingIndicatorShowDuration",
    label: "Show run duration",
    description: "Show how long the current task has been running",
    values: BOOLEAN_VALUES,
  },

  // Tool rendering
  {
    id: "patchedBuiltInTools",
    label: "Patched built-in tools",
    description: "Which built-in tool renderers to replace (reload required)",
    values: ["essential", "all"],
  },
  {
    id: "patchCustomTools",
    label: "Patch custom tools",
    description: "Apply compact rendering to third-party tools",
    values: BOOLEAN_VALUES,
  },
  {
    id: "capitalizeToolNames",
    label: "Capitalize tool names",
    description:
      "Capitalize first letter of custom tool names (e.g. mcp → Mcp)",
    values: BOOLEAN_VALUES,
  },
  {
    id: "indicatorStyle",
    label: "Indicator style",
    description: "Symbol style of the status indicator next to tool calls",
    values: ["dot", "circle", "diamond"],
  },
  {
    id: "maxCallWidth",
    label: "Max call width",
    description: "Maximum width for tool call and output lines",
    values: ["40", "60", "80", "100", "120", "160", "200"],
  },
  {
    id: "maxExpandedEntries",
    label: "Max expanded entries",
    description:
      "Maximum entries shown by capped list and custom results (-1 shows all)",
    values: ["-1", "10", "20", "50", "100"],
  },
  {
    id: "bashCollapsedDisplay",
    label: "Collapsed Bash output",
    description: "Show a five-row preview or summary-only Bash result",
    values: ["preview", "summary"],
  },
  {
    id: "showExpansionHint",
    label: "Show expansion hint",
    description: "Show expand/collapse keybinding hints in tool metadata",
    values: BOOLEAN_VALUES,
  },

  // Editor
  {
    id: "roundedEditorColor",
    label: "Editor border color",
    description: "How the editor border is colored",
    values: ["thinking", "dim", "muted"],
  },
  {
    id: "roundedEditorShowThinkingLevel",
    label: "Show thinking level",
    description: "Display thinking level in editor footer",
    values: BOOLEAN_VALUES,
  },
  {
    id: "roundedEditorShowCacheTokens",
    label: "Show cache tokens",
    description: "Display cache read/write token counts",
    values: BOOLEAN_VALUES,
  },
  {
    id: "roundedEditorShowCost",
    label: "Show cost",
    description: "Display total session cost in editor footer",
    values: BOOLEAN_VALUES,
  },
  {
    id: "roundedEditorShowBranch",
    label: "Show git branch",
    description: "Display current git branch in editor header",
    values: BOOLEAN_VALUES,
  },
];

export function getSettingItems(config: Config): ConfigSettingItem[] {
  return SETTING_DEFINITIONS.map((definition) => ({
    ...definition,
    currentValue: String(config[definition.id]),
  }));
}
