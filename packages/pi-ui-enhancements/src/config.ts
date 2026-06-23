import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import figlet from "figlet";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "ui-settings.json");

export interface Config {
  // ASCII header
  asciiHeaderEnabled: boolean;
  asciiHeaderText: string;
  asciiHeaderFont: string;
  asciiHeaderAlign: "left" | "center" | "right";
  asciiHeaderShowVersion: boolean;

  // Working indicator
  workingIndicatorShowInterruptMsg: boolean;
  workingIndicatorShowDuration: boolean;

  // Tool rendering
  maxCallWidth: number;
  maxExpandedEntries: number;

  // Editor
  hiddenThinkingLabel: string;
}

const defaultConfig: Config = {
  asciiHeaderEnabled: true,
  asciiHeaderText: "pi",
  asciiHeaderFont: "Larry 3D 2",
  asciiHeaderAlign: "center",
  asciiHeaderShowVersion: true,
  workingIndicatorShowInterruptMsg: true,
  workingIndicatorShowDuration: true,
  maxCallWidth: 80,
  maxExpandedEntries: 20,
  hiddenThinkingLabel: "(think)",
};

const ConfigSchema = Type.Object(
  {
    asciiHeaderEnabled: Type.Boolean(),
    asciiHeaderText: Type.String({ minLength: 1, maxLength: 20 }),
    asciiHeaderFont: Type.String({ minLength: 1 }),
    asciiHeaderAlign: Type.Union([
      Type.Literal("left"),
      Type.Literal("center"),
      Type.Literal("right"),
    ]),
    asciiHeaderShowVersion: Type.Boolean(),
    workingIndicatorShowInterruptMsg: Type.Boolean(),
    workingIndicatorShowDuration: Type.Boolean(),
    maxCallWidth: Type.Number({ minimum: 40, maximum: 200 }),
    maxExpandedEntries: Type.Number({ minimum: -1, maximum: 100 }),
    hiddenThinkingLabel: Type.String({ minLength: 1 }),
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

  if (typed.asciiHeaderFont) {
    const availableFonts = figlet.fontsSync();
    if (!availableFonts.includes(typed.asciiHeaderFont)) {
      console.error(
        `Invalid figlet font "${typed.asciiHeaderFont}", ` +
          `falling back to "${defaultConfig.asciiHeaderFont}"`,
      );
      typed.asciiHeaderFont = defaultConfig.asciiHeaderFont;
    }
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
    case "asciiHeaderText":
      return value;
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
    case "maxCallWidth":
      return Number(value);
    case "maxExpandedEntries":
      return Number(value);
    case "hiddenThinkingLabel":
      return value;
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
