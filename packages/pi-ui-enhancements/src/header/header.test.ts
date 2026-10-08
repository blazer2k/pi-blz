import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  VERSION,
  type ExtensionContext,
  type QuietStartup,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  foregroundAnsi,
  rgbColor,
  visibleWidth,
  type Component,
  type TerminalColorMode,
  type TUI,
} from "@earendil-works/pi-tui";
import type { Config } from "../config/definition";
import { getConfig } from "../config/store";
import { mkTheme, setTestConfig } from "../testing/helpers";
import { stripAnsi } from "../tools/rendering/text";
import { buildHeader, registerHeader } from "./header";

let previous: Config;
beforeEach(() => {
  previous = getConfig();
});
afterEach(() => {
  setTestConfig(previous);
});

const compact = ["▀▀█ ", "█▀ █"];
const large = ["██████  ", "██  ██  ", "████  ██", "██    ██"];

type HeaderComponent = Component & { dispose?(): void };
type HeaderFactory = NonNullable<
  Parameters<ExtensionContext["ui"]["setHeader"]>[0]
>;

function headerContext(quietStartup?: QuietStartup) {
  let current: HeaderComponent | undefined;
  const calls: Array<HeaderFactory | undefined> = [];
  const ctx = {
    ui: {
      setHeader(factory: HeaderFactory | undefined) {
        calls.push(factory);
        current?.dispose?.();
        current = factory?.({} as TUI, mkTheme());
      },
    },
  } as unknown as ExtensionContext;
  const pi = { getSettings: () => ({ quietStartup }) };
  return { pi, ctx, calls, current: () => current };
}

describe("buildHeader", () => {
  for (const [headerMode, logo] of [
    ["compact", compact],
    ["large", large],
  ] as const) {
    it(`renders the ${headerMode} logo and version with left and center alignment`, () => {
      const left = buildHeader(
        mkTheme(),
        20,
        { headerMode, headerAlign: "left" },
        false,
      ).map(stripAnsi);
      expect(left).toEqual([
        "",
        ...logo.map((line) => " " + line),
        "",
        ` v${VERSION}`,
        "",
      ]);
      const center = buildHeader(
        mkTheme(),
        20,
        { headerMode, headerAlign: "center" },
        false,
      ).map(stripAnsi);
      const padding = " ".repeat(Math.floor((20 - logo[0]!.length) / 2));
      expect(center).toEqual([
        "",
        ...logo.map((line) => padding + line),
        "",
        " ".repeat(Math.floor((20 - visibleWidth(`v${VERSION}`)) / 2)) +
          `v${VERSION}`,
        "",
      ]);
      expect(logo.map(visibleWidth)).toEqual(
        logo.map(() => (headerMode === "compact" ? 4 : 8)),
      );
    });

    it(`uses the colored wordmark fallback for ${headerMode} on Apple Terminal`, () => {
      const output = buildHeader(
        mkTheme(),
        20,
        { headerMode, headerAlign: "center" },
        true,
      );
      expect(output.map(stripAnsi)).toEqual([
        "",
        "         Pi",
        "",
        " ".repeat(Math.floor((20 - visibleWidth(`v${VERSION}`)) / 2)) +
          `v${VERSION}`,
        "",
      ]);
      expect(output[1]).toContain(
        foregroundAnsi(rgbColor(228, 138, 122), "truecolor") + "P\x1b[0m",
      );
      expect(output[1]).toContain(
        foregroundAnsi(rgbColor(234, 182, 93), "truecolor") + "i\x1b[0m",
      );
    });
  }

  it("uses the current terminal color mode on every render and keeps the version dim", () => {
    let mode: TerminalColorMode = "truecolor";
    const colors: Array<[string, string]> = [];
    const theme = {
      ...mkTheme(),
      getColorMode: () => mode,
      fg: (color: string, text: string) => {
        colors.push([color, text]);
        return text;
      },
    } as Theme;
    for (const next of ["truecolor", "256color", "truecolor"] as const) {
      mode = next;
      for (const headerMode of ["compact", "large"] as const) {
        for (const appleTerminal of [false, true]) {
          const output = buildHeader(
            theme,
            20,
            { headerMode, headerAlign: "left" },
            appleTerminal,
          ).join("\n");
          expect(output).toContain(
            foregroundAnsi(rgbColor(228, 138, 122), mode),
          );
          expect(output).toContain(
            foregroundAnsi(rgbColor(234, 182, 93), mode),
          );
          if (!appleTerminal)
            expect(output).toContain(
              foregroundAnsi(rgbColor(79, 142, 179), mode),
            );
          expect(output.includes("\x1b[38;2;")).toBe(mode === "truecolor");
          expect(colors.at(-1)).toEqual(["dim", `v${VERSION}`]);
          expect(output).toContain("\x1b[0m");
        }
      }
    }
  });

  it("fits both custom modes and fallback at widths zero through 200", () => {
    for (const headerMode of ["compact", "large"] as const) {
      for (const headerAlign of ["left", "center"] as const) {
        for (const appleTerminal of [false, true]) {
          for (let width = 0; width <= 200; width++) {
            for (const line of buildHeader(
              mkTheme(),
              width,
              { headerMode, headerAlign },
              appleTerminal,
            )) {
              expect(visibleWidth(line)).toBeLessThanOrEqual(width);
            }
          }
        }
      }
    }
  });

  it("returns no custom content for native and off", () => {
    for (const headerMode of ["native", "off"] as const) {
      expect(
        buildHeader(
          {} as Theme,
          80,
          { headerMode, headerAlign: "center" },
          false,
        ),
      ).toEqual([]);
    }
  });
});

describe("registerHeader", () => {
  it("respects quiet startup and the native verbose flag in every header mode", () => {
    const argv = process.argv;
    try {
      for (const headerMode of ["native", "compact", "large", "off"] as const) {
        for (const [quietStartup, args, visible] of [
          [undefined, [], true],
          [false, [], true],
          ["header", [], true],
          [true, [], false],
          [true, ["--verbose"], true],
          [true, ["--", "--verbose"], false],
          [true, ["--append-system-prompt", "--verbose"], false],
        ] as const) {
          process.argv = [...argv.slice(0, 2), ...args];
          setTestConfig({ headerMode });
          const fixture = headerContext(quietStartup);
          const handle = registerHeader(fixture.pi, fixture.ctx);
          if (headerMode === "native") expect(fixture.calls).toEqual([]);
          else {
            const output = fixture.current()!.render(80);
            if (visible && headerMode !== "off")
              expect(output.join("\n")).toContain(`v${VERSION}`);
            else expect(output).toEqual([]);
          }
          handle.dispose();
          handle.dispose();
          expect(fixture.calls).toHaveLength(headerMode === "native" ? 0 : 2);
        }
      }
    } finally {
      process.argv = argv;
    }
  });

  it("makes no header calls in native mode, including cleanup", () => {
    for (const headerAlign of ["left", "center"] as const) {
      setTestConfig({ headerMode: "native", headerAlign });
      const fixture = headerContext();
      const handle = registerHeader(fixture.pi, fixture.ctx);
      handle.dispose();
      handle.dispose();
      expect(fixture.calls).toEqual([]);
    }
  });

  it("installs an empty component for off and restores native once on cleanup", () => {
    setTestConfig({ headerMode: "off" });
    const fixture = headerContext();
    const handle = registerHeader(fixture.pi, fixture.ctx);
    expect(fixture.calls[0]).toBeFunction();
    expect(fixture.current()!.render(80)).toEqual([]);
    handle.dispose();
    handle.dispose();
    expect(fixture.calls).toHaveLength(2);
    expect(fixture.calls[1]).toBeUndefined();
  });

  it("retains loaded settings until reinstall and leaves replacement headers alone", () => {
    setTestConfig({ headerMode: "compact", headerAlign: "center" });
    const fixture = headerContext();
    const old = registerHeader(fixture.pi, fixture.ctx);
    const before = fixture.current()!.render(80);
    setTestConfig({ headerMode: "large", headerAlign: "left" });
    fixture.current()!.invalidate();
    expect(fixture.current()!.render(80)).toEqual(before);
    const next = registerHeader(fixture.pi, fixture.ctx);
    old.dispose();
    expect(fixture.calls).toHaveLength(2);
    expect(fixture.current()!.render(80).map(stripAnsi).join("\n")).toContain(
      ` v${VERSION}`,
    );
    const replacement = { render: () => ["other extension"], invalidate() {} };
    fixture.ctx.ui.setHeader(() => replacement);
    next.dispose();
    next.dispose();
    expect(fixture.current()).toBe(replacement);
    expect(fixture.calls).toHaveLength(3);
  });
});
