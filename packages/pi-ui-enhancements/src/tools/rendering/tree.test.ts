import { describe, expect, it } from "bun:test";
import type { ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { clearBlinkTimers } from "./state";
import { getCallRenderParts, getResultText } from "./tree";
import { mkTheme } from "../../test-helpers";

const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

describe("tree-aware text wrapping", () => {
  it("prefixes every wrapped result row and closes only the final row", () => {
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      "├─ summary\n╰─ a long result line that wraps across several visual rows",
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => /^[├│╰]/u.test(line))).toBe(true);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });

  it("prefixes wrapped tree rows embedded in partial tool calls", () => {
    const { text, prefix } = getCallRenderParts({}, mkTheme(), {
      executionStarted: true,
      isPartial: true,
      invalidate: () => {},
    });
    text.setText(
      `${prefix}Write file\n╰─ a long preview line that wraps across visual rows`,
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.slice(1).every((line) => /^[│╰]/u.test(line))).toBe(true);
    clearBlinkTimers();
  });

  it("keeps dotted prefixes on wrapped hidden-lines rows", () => {
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      "├─ took 562ms • ctrl+o to expand\n┊  12345678901234567890 more lines\n│  visible tail line\n╰─ last line",
    );

    const lines = text
      .render(28)
      .map((line) => line.trimEnd().slice(1))
      .filter(Boolean);

    expect(lines.every((line) => /^[├│╰┊]/u.test(line))).toBe(true);
    expect(
      lines.filter((line) => line.startsWith("┊  ")).length,
    ).toBeGreaterThanOrEqual(2);
    expect(lines.at(-1)).toStartWith("╰─ ");
  });
});
