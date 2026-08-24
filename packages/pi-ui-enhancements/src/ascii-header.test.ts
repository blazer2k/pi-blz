import { describe, expect, it } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  type AsciiHeaderConfig,
  type AsciiHeaderData,
  buildAsciiHeader,
  buildAsciiHeaderData,
} from "./ascii-header";

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

const baseConfig: AsciiHeaderConfig = {
  enabled: true,
  text: "pi",
  font: "Greek",
  color: "text",
  align: "left",
  showVersion: false,
};

const singleLineData: AsciiHeaderData = {
  rawLines: ["pi"],
  rawLineWidths: [2],
  versionWidth: 0,
};

describe("buildAsciiHeader", () => {
  it("renders all supported alignments", () => {
    const render = (align: AsciiHeaderConfig["align"]) =>
      buildAsciiHeader(theme, 10, { ...baseConfig, align }, singleLineData);

    expect(render("left")).toEqual(["", " pi", "", ""]);
    expect(render("center")).toEqual(["", "    pi", "", ""]);
    expect(render("right")).toEqual(["", "       pi", "", ""]);
  });

  it("renders the bundled Greek font deterministically", () => {
    const data = buildAsciiHeaderData(baseConfig);

    expect(data.rawLines).toEqual([
      "▄▄▄▄▄▄▄▄▄▄▄▄▄",
      " ███     ███  ",
      " ███     ███  ",
      " ███     ███  ",
      " ███     ███  ",
      "▀▀▀▀▀   ▀▀▀▀▀",
    ]);
    expect(data.rawLineWidths).toEqual([14, 14, 14, 14, 14, 14]);
  });

  it("falls back to plain text when figlet rejects a font", () => {
    const data = buildAsciiHeaderData({
      ...baseConfig,
      text: "fallback",
      font: "not-a-font",
    });

    expect(data.rawLines).toEqual(["fallback"]);
    expect(data.rawLineWidths).toEqual([8]);
  });

  it("keeps every alignment and the version within widths zero through 200", () => {
    for (const align of ["left", "center", "right"] as const) {
      const config = { ...baseConfig, align, showVersion: true };
      const data = buildAsciiHeaderData(config);

      for (let width = 0; width <= 200; width++) {
        for (const line of buildAsciiHeader(theme, width, config, data)) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
