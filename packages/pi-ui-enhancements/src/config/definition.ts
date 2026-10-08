import { Type, type Static } from "typebox";
import { Compile } from "typebox/compile";

export type Config = Static<typeof ConfigSchema>;

export type ConfigKey = keyof Config;

const DEFAULT_CONFIG: Config = {
  headerMode: "compact",
  headerAlign: "left",
  workingIndicatorStyle: "shimmer",
  workingIndicatorShowInterruptMsg: true,
  workingIndicatorShowDuration: true,
  patchCustomTools: true,
  capitalizeToolNames: true,
  indicatorStyle: "circle",
  indicatorColor: "success",
  maxExpandedEntries: 20,
  collapsedOutputDisplay: "preview",
  showExpansionHint: true,
  editorStyle: "rounded",
  editorColor: "dim",
  editorShowThinkingLevel: true,
  editorShowCacheTokens: false,
  editorShowCost: true,
  editorShowBranch: true,
};

const ConfigSchema = Type.Object(
  {
    headerMode: Type.Union([
      Type.Literal("native"),
      Type.Literal("compact"),
      Type.Literal("large"),
      Type.Literal("off"),
    ]),
    headerAlign: Type.Union([Type.Literal("left"), Type.Literal("center")]),
    workingIndicatorStyle: Type.Union([
      Type.Literal("native"),
      Type.Literal("shimmer"),
    ]),
    workingIndicatorShowInterruptMsg: Type.Boolean(),
    workingIndicatorShowDuration: Type.Boolean(),
    patchCustomTools: Type.Boolean(),
    capitalizeToolNames: Type.Boolean(),
    indicatorStyle: Type.Union([
      Type.Literal("dot"),
      Type.Literal("circle"),
      Type.Literal("diamond"),
    ]),
    indicatorColor: Type.Union([
      Type.Literal("success"),
      Type.Literal("text"),
      Type.Literal("toolTitle"),
    ]),
    maxExpandedEntries: Type.Union([
      Type.Literal(-1),
      Type.Literal(10),
      Type.Literal(20),
      Type.Literal(50),
      Type.Literal(100),
    ]),
    collapsedOutputDisplay: Type.Union([
      Type.Literal("preview"),
      Type.Literal("summary"),
    ]),
    showExpansionHint: Type.Boolean(),
    editorStyle: Type.Union([
      Type.Literal("native"),
      Type.Literal("compact"),
      Type.Literal("rounded"),
    ]),
    editorColor: Type.Union([
      Type.Literal("thinking"),
      Type.Literal("dim"),
      Type.Literal("muted"),
    ]),
    editorShowThinkingLevel: Type.Boolean(),
    editorShowCacheTokens: Type.Boolean(),
    editorShowCost: Type.Boolean(),
    editorShowBranch: Type.Boolean(),
  },
  { additionalProperties: false },
);

const validator = Compile(ConfigSchema);

export function getDefaultConfig(): Config {
  return { ...DEFAULT_CONFIG };
}

export function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) return getDefaultConfig();

  const input = raw as Partial<Record<ConfigKey, unknown>>;
  const validated = getDefaultConfig();

  for (const key of Object.keys(DEFAULT_CONFIG) as ConfigKey[]) {
    if (!(key in input)) continue;

    const candidate = { ...validated, [key]: input[key] };
    if (validator.Check(candidate)) {
      validated[key] = candidate[key] as never;
    }
  }

  return validated;
}
