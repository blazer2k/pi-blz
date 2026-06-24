import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

function getConfigPath(): string {
  if (process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH) {
    return process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  }

  if (process.env.NODE_ENV === "test") {
    return join(tmpdir(), "pi-ui-enhancements-test", "ui-settings.json");
  }

  return join(getAgentDir(), "ui-settings.json");
}

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
  "pi",
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
  asciiHeaderColor: "text" | "accent" | "dim";
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
  roundedEditorColor: "thinking" | "dim" | "muted";
  roundedEditorShowThinkingLevel: boolean;
  roundedEditorShowCacheTokens: boolean;
  roundedEditorShowCost: boolean;
  roundedEditorShowBranch: boolean;
}

const defaultConfig: Config = {
  asciiHeaderEnabled: true,
  asciiHeaderFont: "Larry 3D",
  asciiHeaderColor: "text",
  asciiHeaderAlign: "center",
  asciiHeaderShowVersion: true,
  workingIndicatorShowInterruptMsg: true,
  workingIndicatorShowDuration: true,
  patchCustomTools: true,
  maxCallWidth: 80,
  maxExpandedEntries: 20,
  roundedEditorColor: "thinking",
  roundedEditorShowThinkingLevel: true,
  roundedEditorShowCacheTokens: false,
  roundedEditorShowCost: false,
  roundedEditorShowBranch: true,
};

const ConfigSchema = Type.Object(
  {
    asciiHeaderEnabled: Type.Boolean(),
    asciiHeaderFont: Type.String({ minLength: 1 }),
    asciiHeaderColor: Type.Union([
      Type.Literal("text"),
      Type.Literal("accent"),
      Type.Literal("dim"),
    ]),
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
    roundedEditorColor: Type.Union([
      Type.Literal("thinking"),
      Type.Literal("dim"),
      Type.Literal("muted"),
    ]),
    roundedEditorShowThinkingLevel: Type.Boolean(),
    roundedEditorShowCacheTokens: Type.Boolean(),
    roundedEditorShowCost: Type.Boolean(),
    roundedEditorShowBranch: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ConfigKey = keyof Config;

let onConfigChange: (() => void) | null = null;

export function setOnConfigChange(callback: (() => void) | null): void {
  onConfigChange = callback;
}

export function clearOnConfigChange(): void {
  onConfigChange = null;
}

const validator = Compile(ConfigSchema);

let config: Config = { ...defaultConfig };

function isIntegerConfigValue(key: ConfigKey, value: unknown): boolean {
  if (key !== "maxCallWidth" && key !== "maxExpandedEntries") return true;
  return typeof value === "number" && Number.isInteger(value);
}

function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return { ...defaultConfig };

  const input = raw as Partial<Record<ConfigKey, unknown>>;
  const validated: Config = { ...defaultConfig };

  for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
    if (!(key in input)) continue;
    if (!isIntegerConfigValue(key, input[key])) continue;

    const candidate = { ...validated, [key]: input[key] };
    if (validator.Check(candidate)) {
      validated[key] = candidate[key] as never;
    }
  }

  if (!ALLOWED_FONTS.includes(validated.asciiHeaderFont)) {
    console.error(
      `Invalid font "${validated.asciiHeaderFont}", ` +
        `falling back to "${defaultConfig.asciiHeaderFont}"`,
    );
    validated.asciiHeaderFont = defaultConfig.asciiHeaderFont;
  }

  return validated;
}

export function loadConfig(onError?: (error: unknown) => void): void {
  const configPath = getConfigPath();

  try {
    mkdirSync(dirname(configPath), { recursive: true });
  } catch (error) {
    config = { ...defaultConfig };
    if (onError) onError(error);
    else
      console.error(
        `Failed to prepare config directory for ${configPath}:`,
        error,
      );
    return;
  }

  if (!existsSync(configPath)) {
    config = { ...defaultConfig };
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      if (onError) onError(error);
      else console.error(`Failed to create config at ${configPath}:`, error);
    }
    return;
  }

  let saved: unknown;
  try {
    saved = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    config = { ...defaultConfig };
    if (onError) onError(error);
    else console.error(`Failed to load config from ${configPath}:`, error);
    return;
  }

  const validated = validateConfig(saved);
  config = validated;

  try {
    // Normalize config by adding missing default keys
    writeFileSync(configPath, JSON.stringify(validated, null, 2));
  } catch (error) {
    if (onError) onError(error);
    else console.error(`Failed to normalize config at ${configPath}:`, error);
  }
}

function parseConfigValue(id: ConfigKey, value: string): Config[ConfigKey] {
  switch (id) {
    case "asciiHeaderEnabled":
      return value === "true";
    case "asciiHeaderFont":
      return value;
    case "asciiHeaderColor":
      return value as Config["asciiHeaderColor"];
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
    case "roundedEditorColor":
      return value as Config["roundedEditorColor"];
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
  if (!isIntegerConfigValue(id, parsed)) {
    throw new Error(`Invalid config update: ${id}=${value}`);
  }
  if (!validator.Check(updated)) {
    throw new Error(`Invalid config update: ${id}=${value}`);
  }
  if (id === "asciiHeaderFont" && !ALLOWED_FONTS.includes(String(parsed))) {
    throw new Error(`Invalid config update: ${id}=${value}`);
  }

  // Re-run domain-specific validation on the updated config
  const validated = validateConfig(updated);

  const configPath = getConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(validated, null, 2));
  config = validated;

  onConfigChange?.();
}

export function getConfig(): Config {
  return { ...config };
}
