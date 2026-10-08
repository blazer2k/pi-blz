import { Type, type Static } from "typebox";
import { Create, Repair } from "typebox/value";

// Literal unions prevent Repair from coercing strings or numbers to booleans.
const flag = (defaultValue: boolean) =>
  Type.Union([Type.Literal(true), Type.Literal(false)], {
    default: defaultValue,
  });

const ConfigSchema = Type.Object(
  {
    header: Type.Object(
      {
        style: Type.Union(
          [
            Type.Literal("native"),
            Type.Literal("compact"),
            Type.Literal("large"),
            Type.Literal("off"),
          ],
          { default: "compact" },
        ),
        align: Type.Union([Type.Literal("left"), Type.Literal("center")], {
          default: "left",
        }),
      },
      { additionalProperties: false },
    ),
    workingIndicator: Type.Object(
      {
        style: Type.Union([Type.Literal("native"), Type.Literal("shimmer")], {
          default: "shimmer",
        }),
        showInterruptHint: flag(true),
        showDuration: flag(true),
      },
      { additionalProperties: false },
    ),
    tools: Type.Object(
      {
        enhanceCustomTools: flag(true),
        capitalizeNames: flag(true),
        indicator: Type.Object(
          {
            style: Type.Union(
              [
                Type.Literal("dot"),
                Type.Literal("circle"),
                Type.Literal("diamond"),
              ],
              { default: "circle" },
            ),
            color: Type.Union(
              [
                Type.Literal("success"),
                Type.Literal("text"),
                Type.Literal("toolTitle"),
              ],
              { default: "success" },
            ),
          },
          { additionalProperties: false },
        ),
        maxExpandedEntries: Type.Union(
          [
            Type.Literal(-1),
            Type.Literal(10),
            Type.Literal(20),
            Type.Literal(50),
            Type.Literal(100),
          ],
          { default: 20 },
        ),
        collapsedOutputDisplay: Type.Union(
          [Type.Literal("preview"), Type.Literal("summary")],
          { default: "preview" },
        ),
        showExpansionHint: flag(true),
      },
      { additionalProperties: false },
    ),
    editor: Type.Object(
      {
        style: Type.Union(
          [
            Type.Literal("native"),
            Type.Literal("compact"),
            Type.Literal("rounded"),
          ],
          { default: "rounded" },
        ),
        color: Type.Union(
          [
            Type.Literal("thinking"),
            Type.Literal("dim"),
            Type.Literal("muted"),
          ],
          { default: "dim" },
        ),
        showThinkingLevel: flag(true),
        showCacheTokens: flag(false),
        showCost: flag(true),
        showBranch: flag(true),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type Config = Static<typeof ConfigSchema>;

export function getDefaultConfig(): Config {
  return Create(ConfigSchema);
}

export function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return getDefaultConfig();
  return Repair(ConfigSchema, structuredClone(raw));
}
