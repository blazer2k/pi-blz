import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const CONFIG_PATH = join(getAgentDir(), "ui-settings.json");

export const ALLOWED_FONTS = [
  "Alligator",
  "ANSI Compact",
  "Classy",
  "Coder Mini",
  "Crazy",
  "Delta Corps Priest 1",
  "Future",
  "Future Smooth",
  "Georgia11",
  "Italic",
  "Jazmine",
  "Larry 3D",
  "NV Script",
  "Nancyj",
  "Poison",
  "Rebel",
  "Roman",
  "Speed",
  "Tmplr",
  "Trek",
  "Univers",
  "Varsity",
  "Whimsy",
];

export interface Config {
  // ASCII header
  asciiHeaderEnabled: boolean;
  asciiHeaderFont: string;
  asciiHeaderAlign: "left" | "center" | "right";
  asciiHeaderShowVersion: boolean;

  // Working indicator
  workingIndicatorShowInterruptMsg: boolean;
  workingIndicatorShowDuration: boolean;

  // Tool rendering
  patchCustomTools: boolean;
  maxCallWidth: number;
  maxExpandedEntries: number;

  // Editor
  roundedEditorColorizeThinking: boolean;
  roundedEditorShowThinkingLevel: boolean;
  roundedEditorShowCacheTokens: boolean;
  roundedEditorShowCost: boolean;
  roundedEditorShowBranch: boolean;
}

const defaultConfig: Config = {
  asciiHeaderEnabled: true,
  asciiHeaderFont: "Larry 3D",
  asciiHeaderAlign: "center",
  asciiHeaderShowVersion: true,
  workingIndicatorShowInterruptMsg: true,
  workingIndicatorShowDuration: true,
  patchCustomTools: true,
  maxCallWidth: 80,
  roundedEditorColorizeThinking: true,
  roundedEditorShowThinkingLevel: true,
  roundedEditorShowCacheTokens: false,
  roundedEditorShowCost: false,
  roundedEditorShowBranch: true,
  maxExpandedEntries: 20,
};

const ConfigSchema = Type.Object(
  {
    asciiHeaderEnabled: Type.Boolean(),
    asciiHeaderFont: Type.String({ minLength: 1 }),
    asciiHeaderAlign: Type.Union([
      Type.Literal("left"),
      Type.Literal("center"),
      Type.Literal("right"),
    ]),
    asciiHeaderShowVersion: Type.Boolean(),
    workingIndicatorShowInterruptMsg: Type.Boolean(),
    workingIndicatorShowDuration: Type.Boolean(),
    patchCustomTools: Type.Boolean(),
    maxCallWidth: Type.Number({ minimum: 40, maximum: 200 }),
    maxExpandedEntries: Type.Number({ minimum: -1, maximum: 100 }),
    roundedEditorColorizeThinking: Type.Boolean(),
    roundedEditorShowThinkingLevel: Type.Boolean(),
    roundedEditorShowCacheTokens: Type.Boolean(),
    roundedEditorShowCost: Type.Boolean(),
    roundedEditorShowBranch: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ConfigKey = keyof Config;

const validator = Compile(ConfigSchema);

let config: Config = { ...defaultConfig };

function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return defaultConfig;

  const merged = { ...defaultConfig, ...raw };
  if (!validator.Check(merged)) {
    return { ...defaultConfig };
  }

  const typed = merged as Config;

  if (typed.asciiHeaderFont && !ALLOWED_FONTS.includes(typed.asciiHeaderFont)) {
    console.error(
      `Invalid figlet font "${typed.asciiHeaderFont}", ` +
        `falling back to "${defaultConfig.asciiHeaderFont}"`,
    );
    typed.asciiHeaderFont = defaultConfig.asciiHeaderFont;
  }

  return typed;
}

export function loadConfig(onError?: (error: unknown) => void): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });

    if (!existsSync(CONFIG_PATH)) {
      config = { ...defaultConfig };
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      return;
    }

    const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const validated = validateConfig(saved);
    config = validated;

    // Normalize config by adding missing default keys
    writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
  } catch (error) {
    config = { ...defaultConfig };

    try {
      mkdirSync(dirname(CONFIG_PATH), { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (repairError) {
      if (onError) {
        onError(repairError);
        return;
      }

      console.error(`Failed to repair config at ${CONFIG_PATH}:`, repairError);
      return;
    }

    if (onError) {
      onError(error);
      return;
    }

    console.error(`Failed to load config from ${CONFIG_PATH}:`, error);
  }
}

function parseConfigValue(id: ConfigKey, value: string): Config[ConfigKey] {
  switch (id) {
    case "asciiHeaderEnabled":
      return value === "true";
    case "asciiHeaderFont":
      return value;
    case "asciiHeaderAlign":
      return value as Config["asciiHeaderAlign"];
    case "asciiHeaderShowVersion":
      return value === "true";
    case "workingIndicatorShowInterruptMsg":
      return value === "true";
    case "workingIndicatorShowDuration":
      return value === "true";
    case "patchCustomTools":
      return value === "true";
    case "maxCallWidth":
      return Number(value);
    case "maxExpandedEntries":
      return Number(value);
    case "roundedEditorColorizeThinking":
      return value === "true";
    case "roundedEditorShowThinkingLevel":
      return value === "true";
    case "roundedEditorShowCacheTokens":
      return value === "true";
    case "roundedEditorShowCost":
      return value === "true";
    case "roundedEditorShowBranch":
      return value === "true";
  }
}

export function saveConfig(id: ConfigKey, value: string): void {
  const parsed = parseConfigValue(id, value);

  const updated = { ...config, [id]: parsed };
  if (!validator.Check(updated)) {
    throw new Error(`Invalid config update: ${id}=${value}`);
  }

  // Re-run domain-specific validation on the updated config
  const validated = validateConfig(updated);

  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(validated, null, 2));
  config = validated;
}

export function getConfig(): Config {
  return { ...config };
}
