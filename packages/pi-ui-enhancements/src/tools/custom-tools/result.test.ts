import { describe, expect, it } from "bun:test";
import { mkTheme } from "../../test-helpers";
import { getMaxExpandedEntries } from "../rendering/state";
import type { BaseRenderState } from "../rendering/types";
import { buildGenericResult } from "./result";

const theme = mkTheme();

function render(
  text: string,
  state: BaseRenderState = {},
  expanded = false,
): string {
  return buildGenericResult(
    { content: [{ type: "text", text }], details: undefined },
    state,
    { expanded, isPartial: false },
    theme,
  );
}

describe("buildGenericResult", () => {
  it("renders empty and truncated metadata together", () => {
    expect(render("", { truncated: true })).toBe("╰─ truncated • (no output)");
  });

  it("summarizes collapsed output", () => {
    expect(render("one\ntwo")).toBe("╰─ 2 lines");
  });

  it("renders expanded output as a closed tree", () => {
    expect(render("one\ntwo", {}, true)).toBe("├─ 2 lines\n│  one\n╰─ two");
  });

  it("limits expanded output using the configured entry count", () => {
    const maxEntries = getMaxExpandedEntries();
    const total = maxEntries + 2;
    const text = Array.from(
      { length: total },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const output = render(text, {}, true);

    expect(output).toContain(`├─ ${total} lines`);
    expect(output).toContain(`│  line ${maxEntries}`);
    expect(output).not.toContain(`line ${maxEntries + 1}`);
    expect(output).toContain("╰─ 2 more lines");
  });
});
