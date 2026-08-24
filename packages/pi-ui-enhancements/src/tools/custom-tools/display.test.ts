import { afterEach, describe, expect, it } from "bun:test";
import {
  getCapabilities,
  hyperlink,
  setCapabilities,
} from "@earendil-works/pi-tui";
import { mkTheme } from "../../test-helpers";
import {
  applyArgumentHyperlinks,
  buildGenericCallHeader,
  capitalizeFirstVisibleChar,
  sanitizeRenderedText,
} from "./display";

const originalCapabilities = getCapabilities();

afterEach(() => {
  setCapabilities(originalCapabilities);
});

describe("sanitizeRenderedText", () => {
  it("keeps SGR styling while removing terminal control sequences", () => {
    const rendered = sanitizeRenderedText(
      "\x1b[31msearch\x1b[0m\nlatest\x1b[?25l\x1b]0;title\x07",
    );

    expect(rendered).toBe("\x1b[31msearch\x1b[0m latest");
  });

  it("removes control characters and flattens tabs", () => {
    expect(sanitizeRenderedText("one\u0000\ttwo\r\nthree")).toBe(
      "one two three",
    );
  });
});

describe("capitalizeFirstVisibleChar", () => {
  it("skips whitespace and ANSI sequences", () => {
    expect(capitalizeFirstVisibleChar(" \x1b[31msearch\x1b[0m")).toBe(
      " \x1b[31mSearch\x1b[0m",
    );
  });

  it("leaves text without a lowercase first character unchanged", () => {
    expect(capitalizeFirstVisibleChar(" 2 results")).toBe(" 2 results");
  });
});

describe("buildGenericCallHeader", () => {
  it("shows only the first three scalar arguments", () => {
    expect(
      buildGenericCallHeader(
        {
          query: "pi",
          count: 2,
          enabled: true,
          fourth: "hidden",
          nested: { ignored: true },
        },
        "Lookup",
        mkTheme(),
      ),
    ).toBe('Lookup query="pi" count=2 enabled=true');
  });
});

describe("applyArgumentHyperlinks", () => {
  it("links URL arguments when the terminal supports hyperlinks", () => {
    setCapabilities({ ...originalCapabilities, hyperlinks: true });
    const url = "https://example.com/reference";

    expect(applyArgumentHyperlinks(`Open ${url}`, { url }, "/repo")).toBe(
      `Open ${hyperlink(url, url)}`,
    );
  });

  it("leaves output unchanged when hyperlinks are unavailable", () => {
    setCapabilities({ ...originalCapabilities, hyperlinks: false });
    const text = "Open https://example.com/reference";

    expect(
      applyArgumentHyperlinks(
        text,
        { url: "https://example.com/reference" },
        "/repo",
      ),
    ).toBe(text);
  });
});
