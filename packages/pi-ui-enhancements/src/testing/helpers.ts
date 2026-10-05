import { writeFileSync } from "node:fs";
import {
  type Theme,
  type ToolDefinition,
  type ToolInfo,
  type ToolRenderers,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import type { Config } from "../config/definition";
import { getConfig, loadConfig } from "../config/store";
import { createToolRendering } from "../tools/tool-registration";
import type { CustomToolRenderingReporter } from "../tools/custom-tools/types";

export function setTestConfig(updates: Partial<Config>): void {
  const config = { ...getConfig(), ...updates };
  loadConfig(undefined, {
    prepare() {},
    exists: () => true,
    read: () => JSON.stringify(config),
    write() {},
  });
}

export function writeTestConfig(updates: Partial<Config>): void {
  const path = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  if (!path) throw new Error("A temporary config path is required");
  writeFileSync(path, JSON.stringify({ ...getConfig(), ...updates }));
  loadConfig();
}

export function mkTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (s: string) => s,
    getBashModeBorderColor: () => (s: string) => s,
  } as unknown as Theme;
}

export function setupTool(createRenderers: () => ToolRenderers) {
  return createRenderers();
}

export function setupCustomTool(
  definition: ToolDefinition,
  isToolCallActive: (toolCallId: string) => boolean = () => false,
  reportIssue: CustomToolRenderingReporter = () => {},
  sourceInfo: SourceInfo = {
    source: "inline",
    path: "<inline:test>",
    scope: "temporary",
    origin: "top-level",
  },
) {
  let enabled = true;
  const rendering = createToolRendering(
    {
      getAllTools: () => [
        {
          ...definition,
          exposure: definition.exposure ?? "direct",
          sourceInfo,
        } as ToolInfo,
      ],
    },
    { isToolCallActive, isEnabled: () => enabled, reportIssue },
  );
  return {
    renderers: rendering.resolve(definition.name, () => definition)!,
    clearCustomTimers: rendering.clearCustomTimers,
    dispose() {
      enabled = false;
      rendering.reset();
    },
  };
}

export function mkToolCtx(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    toolCallId: "call-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    isPartial: false,
    isError: false,
    expanded: false,
    argsComplete: true,
    showImages: false,
    ...overrides,
  };
}
