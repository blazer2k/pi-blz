import { describe, expect, it } from "bun:test";
import { blend, parseRgb, rgbFg } from "./colors";

describe("parseRgb", () => {
  it("parses truecolor foreground ANSI", () => {
    expect(parseRgb("\x1b[38;2;10;20;30m")).toEqual({ r: 10, g: 20, b: 30 });
  });

  it("rejects non-truecolor ANSI", () => {
    expect(parseRgb("\x1b[31m")).toBeUndefined();
    expect(parseRgb("plain")).toBeUndefined();
    expect(parseRgb("\x1b[48;2;1;2;3m")).toBeUndefined();
  });

  it("clamps values to 255", () => {
    expect(parseRgb("\x1b[38;2;999;300;256m")).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });
});

describe("blend", () => {
  it("interpolates colors", () => {
    expect(blend({ r: 0, g: 0, b: 0 }, { r: 100, g: 50, b: 200 }, 0.5)).toEqual(
      {
        r: 50,
        g: 25,
        b: 100,
      },
    );
  });

  it("returns low color when alpha is 0", () => {
    expect(blend({ r: 10, g: 20, b: 30 }, { r: 99, g: 88, b: 77 }, 0)).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
  });

  it("returns high color when alpha is 1", () => {
    expect(blend({ r: 10, g: 20, b: 30 }, { r: 99, g: 88, b: 77 }, 1)).toEqual({
      r: 99,
      g: 88,
      b: 77,
    });
  });
});

describe("rgbFg", () => {
  it("emits truecolor foreground ANSI", () => {
    expect(rgbFg({ r: 1, g: 2, b: 3 })).toBe("\x1b[38;2;1;2;3m");
  });
});
