import { describe, expect, it } from "bun:test";
import type {
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { clearBlinkTimers } from "./state";
import {
  formatOmissionRow,
  formatTreeLine,
  getCallRenderParts,
  getResultText,
} from "./tree";
import { mkTheme } from "../../testing/helpers";

const optsExpanded: ToolRenderResultOptions = {
  expanded: true,
  isPartial: false,
};

describe("formatOmissionRow", () => {
  it("dims the row and italicizes only the hidden count", () => {
    const theme = {
      ...mkTheme(),
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      italic: (text: string) => `<italic>${text}</italic>`,
    } as Theme;

    expect(
      formatOmissionRow(1, { singular: "line", plural: "lines" }, theme),
    ).toBe("<dim>┊  <italic>+1 line</italic></dim>");
  });
});

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

  it("preserves content color across wrapped tree rows", () => {
    const dim = "\x1b[90m";
    const error = "\x1b[31m";
    const resetForeground = "\x1b[39m";
    const theme = {
      ...mkTheme(),
      fg: (color: string, value: string) =>
        `${color === "error" ? error : dim}${value}${resetForeground}`,
    } as Theme;
    const text = getResultText({}, optsExpanded, undefined);
    text.setText(
      formatTreeLine(
        "ENOENT: no such file or directory, access '/tmp/pi-ui-visual-matrix/missing-file.txt'",
        {
          theme,
          prefix: "│  ",
          width: 120,
          mode: "preserve",
          color: "error",
        },
      ).text,
    );

    const lines = text.render(52);
    const first = lines.find((line) => line.includes("ENOENT"));
    const second = lines.find((line) => line.includes("missing-file.txt"));
    const hasActiveError = (line: string, content: string) => {
      const contentStart = line.indexOf(content);
      return (
        line.lastIndexOf(error, contentStart) >
        Math.max(
          line.lastIndexOf(dim, contentStart),
          line.lastIndexOf(resetForeground, contentStart),
        )
      );
    };

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(hasActiveError(first!, "ENOENT")).toBe(true);
    expect(hasActiveError(second!, "'/tmp")).toBe(true);
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
