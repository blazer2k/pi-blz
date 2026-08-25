import { Type } from "typebox";
import { Compile } from "typebox/compile";

export const ALLOWED_FONTS: string[] = [
  "3D-ASCII",
  "Alligator",
  "ANSI Compact",
  "Classy",
  "Coder Mini",
  "Crazy",
  "Delta Corps Priest 1",
  "Future",
  "Future Smooth",
  "Georgia11",
  "Greek",
  "Greek Large",
  "Italic",
  "Jazmine",
  "Larry 3D",
  "Poison",
  "Rebel",
  "Slant",
  "Tmplr",
  "Trek",
  "Univers",
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
  patchedBuiltInTools: "essential" | "all";
  patchCustomTools: boolean;
  capitalizeToolNames: boolean;
  indicatorStyle: "dot" | "circle" | "diamond";
  maxCallWidth: number;
  maxExpandedEntries: number;
  bashCollapsedDisplay: "preview" | "summary";
  showExpansionHint: boolean;

  // Editor
  roundedEditorColor: "thinking" | "dim" | "muted";
  roundedEditorShowThinkingLevel: boolean;
  roundedEditorShowCacheTokens: boolean;
  roundedEditorShowCost: boolean;
  roundedEditorShowBranch: boolean;
}

export type ConfigKey = keyof Config;

const DEFAULT_CONFIG: Config = {
  asciiHeaderEnabled: true,
  asciiHeaderFont: "Greek",
  asciiHeaderColor: "text",
  asciiHeaderAlign: "center",
  asciiHeaderShowVersion: true,
  workingIndicatorShowInterruptMsg: true,
  workingIndicatorShowDuration: true,
  patchedBuiltInTools: "essential",
  patchCustomTools: true,
  capitalizeToolNames: true,
  indicatorStyle: "circle",
  maxCallWidth: 80,
  maxExpandedEntries: 20,
  bashCollapsedDisplay: "preview",
  showExpansionHint: true,
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
    patchedBuiltInTools: Type.Union([
      Type.Literal("essential"),
      Type.Literal("all"),
    ]),
    patchCustomTools: Type.Boolean(),
    capitalizeToolNames: Type.Boolean(),
    indicatorStyle: Type.Union([
      Type.Literal("dot"),
      Type.Literal("circle"),
      Type.Literal("diamond"),
    ]),
    maxCallWidth: Type.Number({ minimum: 40, maximum: 200 }),
    maxExpandedEntries: Type.Union([
      Type.Literal(-1),
      Type.Literal(10),
      Type.Literal(20),
      Type.Literal(50),
      Type.Literal(100),
    ]),
    bashCollapsedDisplay: Type.Union([
      Type.Literal("preview"),
      Type.Literal("summary"),
    ]),
    showExpansionHint: Type.Boolean(),
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

const validator = Compile(ConfigSchema);

const BOOLEAN_CONFIG_KEYS: ReadonlySet<ConfigKey> = new Set([
  "asciiHeaderEnabled",
  "asciiHeaderShowVersion",
  "workingIndicatorShowInterruptMsg",
  "workingIndicatorShowDuration",
  "patchCustomTools",
  "capitalizeToolNames",
  "showExpansionHint",
  "roundedEditorShowThinkingLevel",
  "roundedEditorShowCacheTokens",
  "roundedEditorShowCost",
  "roundedEditorShowBranch",
]);

const INTEGER_CONFIG_KEYS: ReadonlySet<ConfigKey> = new Set([
  "maxCallWidth",
  "maxExpandedEntries",
]);

export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

function isIntegerConstrainedValue(key: ConfigKey, value: unknown): boolean {
  return (
    !INTEGER_CONFIG_KEYS.has(key) ||
    (typeof value === "number" && Number.isInteger(value))
  );
}

export function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return getDefaultConfig();

  const input = raw as Partial<Record<ConfigKey, unknown>>;
  const validated = getDefaultConfig();

  for (const key of Object.keys(DEFAULT_CONFIG) as ConfigKey[]) {
    if (!(key in input) || !isIntegerConstrainedValue(key, input[key])) {
      continue;
    }

    const candidate = { ...validated, [key]: input[key] };
    if (validator.Check(candidate)) {
      validated[key] = candidate[key] as never;
    }
  }

  if (!ALLOWED_FONTS.includes(validated.asciiHeaderFont)) {
    console.error(
      `Invalid font "${validated.asciiHeaderFont}", ` +
        `falling back to "${DEFAULT_CONFIG.asciiHeaderFont}"`,
    );
    validated.asciiHeaderFont = DEFAULT_CONFIG.asciiHeaderFont;
  }

  return validated;
}

function parseConfigValue(key: ConfigKey, value: string): Config[ConfigKey] {
  if (BOOLEAN_CONFIG_KEYS.has(key)) return value === "true";
  if (INTEGER_CONFIG_KEYS.has(key)) return Number(value);
  return value;
}

export function applyConfigUpdate(
  current: Config,
  key: ConfigKey,
  value: string,
): Config {
  const parsed = parseConfigValue(key, value);
  const updated = { ...current, [key]: parsed };

  if (!isIntegerConstrainedValue(key, parsed) || !validator.Check(updated)) {
    throw new Error(`Invalid config update: ${key}=${value}`);
  }
  if (key === "asciiHeaderFont" && !ALLOWED_FONTS.includes(String(parsed))) {
    throw new Error(`Invalid config update: ${key}=${value}`);
  }

  return validateConfig(updated);
}
