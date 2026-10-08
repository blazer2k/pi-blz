import { describe, expect, it } from "bun:test";
import { PI_0_84_3_OUTPUT } from "../tools/test-fixtures/pi-0.84.3";
import { PI_0_85_0_OUTPUT } from "../tools/test-fixtures/pi-0.85.0";
import { adaptNativeEditorLayout } from "./native-layout";

describe("adaptNativeEditorLayout", () => {
  it("adapts Pi 0.84.3 borders and preserves trailing autocomplete rows", () => {
    const nativeLines = [
      `\x1b[2m${PI_0_84_3_OUTPUT.editor.scrolledTop}\x1b[0m`,
      "first".padEnd(18),
      "second".padEnd(18),
      PI_0_84_3_OUTPUT.editor.scrolledBottom,
      "autocomplete".padEnd(18),
    ];

    expect(adaptNativeEditorLayout(nativeLines)).toEqual({
      compatible: true,
      lines: [
        nativeLines[0]!,
        nativeLines[1]!,
        nativeLines[2]!,
        nativeLines[4]!,
      ],
      scroll: {
        hiddenAbove: true,
        hiddenBelow: true,
        contentLineCount: 2,
      },
    });
    expect(nativeLines).toHaveLength(5);
  });

  it("adapts Pi 0.85.0 centered scroll borders", () => {
    const nativeLines = [
      PI_0_85_0_OUTPUT.editor.scrolledTop,
      "first".padEnd(80),
      "second".padEnd(80),
      PI_0_85_0_OUTPUT.editor.scrolledBottom,
      "autocomplete".padEnd(80),
    ];

    expect(adaptNativeEditorLayout(nativeLines)).toEqual({
      compatible: true,
      lines: [
        nativeLines[0]!,
        nativeLines[1]!,
        nativeLines[2]!,
        nativeLines[4]!,
      ],
      scroll: {
        hiddenAbove: true,
        hiddenBelow: true,
        contentLineCount: 2,
      },
    });
  });

  it("does not mistake content resembling a centered marker for a border", () => {
    const nativeLines = ["────────", "content", "──── ↑ heading"];

    expect(adaptNativeEditorLayout(nativeLines)).toEqual({
      compatible: false,
      lines: nativeLines,
      scroll: null,
    });
  });

  it("reports incompatible layouts without changing their lines", () => {
    const nativeLines = ["future top", "content", "future bottom"];

    expect(adaptNativeEditorLayout(nativeLines)).toEqual({
      compatible: false,
      lines: nativeLines,
      scroll: null,
    });
  });
});
