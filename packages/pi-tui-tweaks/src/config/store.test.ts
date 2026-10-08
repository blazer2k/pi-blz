import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getDefaultConfig, validateConfig } from "./definition";
import { setTestConfig, writeTestConfig } from "../testing/helpers";
import { getConfig, loadConfig, type ConfigStorage } from "./store";

let configDir: string;
let previousConfigPath: string | undefined;

function createStorage(overrides: Partial<ConfigStorage> = {}): ConfigStorage {
  return {
    prepare() {},
    exists: () => true,
    read: () => "{}",
    write() {},
    ...overrides,
  };
}

beforeEach(() => {
  previousConfigPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  configDir = mkdtempSync(join(tmpdir(), "pi-tui-tweaks-config-"));
  process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(configDir, "settings.json");
  loadConfig();
});

afterEach(() => {
  if (previousConfigPath === undefined) {
    delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
  } else {
    process.env.PI_TUI_TWEAKS_CONFIG_PATH = previousConfigPath;
  }
  rmSync(configDir, { recursive: true, force: true });
  loadConfig();
});

describe("config validation", () => {
  it("defaults to the compact left-aligned header and rounded dim editor", () => {
    expect(getDefaultConfig()).toMatchObject({
      header: {
        style: "compact",
        align: "left",
      },
      workingIndicator: {
        style: "shimmer",
      },
      editor: {
        style: "rounded",
        color: "dim",
        showThinkingLevel: true,
        showCacheTokens: false,
        showCost: true,
        showBranch: true,
      },
    });
    expect(getConfig()).toEqual(getDefaultConfig());
  });

  it("resolves nested fields independently without coercion or unknown keys", () => {
    expect(
      validateConfig({
        header: { style: "unsupported", align: "center", extra: true },
        workingIndicator: {
          style: "native",
          showDuration: "false",
          showInterruptHint: false,
        },
        tools: {
          indicator: { style: "invalid", color: "text" },
          capitalizeNames: "false",
          enhanceCustomTools: 0,
          maxExpandedEntries: 50,
          unknown: true,
        },
        editor: {
          style: "compact",
          color: "muted",
          showCacheTokens: 1,
          showCost: "false",
          showBranch: null,
        },
        unknown: true,
      }),
    ).toEqual({
      header: { style: "compact", align: "center" },
      workingIndicator: {
        style: "native",
        showInterruptHint: false,
        showDuration: true,
      },
      tools: {
        ...getDefaultConfig().tools,
        indicator: { style: "circle", color: "text" },
        maxExpandedEntries: 50,
      },
      editor: {
        ...getDefaultConfig().editor,
        style: "compact",
        color: "muted",
      },
    });
    for (const malformed of [null, [], "bad", false]) {
      expect(validateConfig(malformed)).toEqual(getDefaultConfig());
      expect(
        validateConfig({
          header: malformed,
          workingIndicator: malformed,
          tools: malformed,
          editor: malformed,
        }),
      ).toEqual(getDefaultConfig());
      expect(
        validateConfig({
          tools: { indicator: malformed, maxExpandedEntries: 50 },
        }).tools,
      ).toEqual({ ...getDefaultConfig().tools, maxExpandedEntries: 50 });
    }
  });

  it("does not share mutable nested objects between inputs, defaults, or stored config", () => {
    const raw = getDefaultConfig();
    const validated = validateConfig(raw);
    raw.header.style = "off";
    raw.tools.indicator.color = "text";
    validated.editor.showCost = false;
    expect(validated.header.style).toBe("compact");
    expect(validated.tools.indicator.color).toBe("success");
    expect(raw.editor.showCost).toBe(true);
    const copy = getConfig();
    copy.header.align = "center";
    copy.tools.indicator.style = "diamond";
    copy.editor.showCost = false;
    expect(getConfig()).toEqual(getDefaultConfig());
    expect(getDefaultConfig().header.style).toBe("compact");
    expect(getDefaultConfig().tools.indicator.color).toBe("success");
  });

  it("preserves sibling fields in partial test updates and written settings", () => {
    setTestConfig({
      tools: {
        indicator: { style: "diamond", color: "text" },
        maxExpandedEntries: 50,
      },
      editor: { showCost: false },
    });
    setTestConfig({ tools: { indicator: { style: "dot" } } });
    const before = getConfig();
    expect(before.tools.indicator).toEqual({ style: "dot", color: "text" });
    expect(before.tools.maxExpandedEntries).toBe(50);
    expect(before.editor.showCost).toBe(false);
    writeTestConfig({ header: { align: "center" } });
    expect(getConfig()).toEqual({
      ...before,
      header: { ...before.header, align: "center" },
    });
  });

  it("selects the renamed filename and only the new override", () => {
    const originalMode = process.env.NODE_ENV;
    const originalPath = process.env.PI_TUI_TWEAKS_CONFIG_PATH;
    const paths: string[] = [];
    const storage = createStorage({
      exists: () => false,
      prepare: (path) => paths.push(path),
    });
    try {
      delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
      process.env.NODE_ENV = "production";
      loadConfig(undefined, storage);
      expect(paths.at(-1)).toBe(join(getAgentDir(), "pi-tui-tweaks.json"));
      process.env.NODE_ENV = "test";
      loadConfig(undefined, storage);
      expect(paths.at(-1)).toBe(
        join(tmpdir(), "pi-tui-tweaks-test", "pi-tui-tweaks.json"),
      );
      process.env.PI_TUI_TWEAKS_CONFIG_PATH = join(configDir, "override.json");
      loadConfig(undefined, storage);
      expect(paths.at(-1)).toBe(process.env.PI_TUI_TWEAKS_CONFIG_PATH);
    } finally {
      if (originalMode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalMode;
      if (originalPath === undefined)
        delete process.env.PI_TUI_TWEAKS_CONFIG_PATH;
      else process.env.PI_TUI_TWEAKS_CONFIG_PATH = originalPath;
    }
  });

  it("recovers invalid settings individually and normalizes the file", () => {
    let normalized = "";
    loadConfig(
      undefined,
      createStorage({
        read: () =>
          JSON.stringify({
            header: {
              style: "unsupported",
              align: "center",
            },
            tools: {
              maxExpandedEntries: 25,
            },
            editor: {
              showCost: false,
            },
          }),
        write(_path, contents) {
          normalized = contents;
        },
      }),
    );

    expect(getConfig()).toEqual({
      ...getDefaultConfig(),
      header: {
        ...getDefaultConfig().header,
        align: "center",
      },
      editor: {
        ...getDefaultConfig().editor,
        showCost: false,
      },
    });
    expect(JSON.parse(normalized)).toEqual(getConfig());
  });

  it("loads boolean and enum settings as JSON values", () => {
    writeFileSync(
      process.env.PI_TUI_TWEAKS_CONFIG_PATH!,
      JSON.stringify({
        editor: {
          showBranch: false,
          showCost: false,
        },
        header: {
          align: "center",
        },
      }),
    );
    loadConfig();
    expect(getConfig()).toEqual({
      ...getDefaultConfig(),
      editor: {
        ...getDefaultConfig().editor,
        showBranch: false,
        showCost: false,
      },
      header: {
        ...getDefaultConfig().header,
        align: "center",
      },
    });
  });

  it("accepts all four header modes and both alignments", () => {
    for (const headerMode of ["native", "compact", "large", "off"] as const) {
      for (const headerAlign of ["left", "center"] as const) {
        loadConfig(
          undefined,
          createStorage({
            read: () =>
              JSON.stringify({
                header: {
                  style: headerMode,
                  align: headerAlign,
                },
              }),
          }),
        );
        expect(getConfig()).toEqual({
          ...getDefaultConfig(),
          header: {
            ...getDefaultConfig().header,
            style: headerMode,
            align: headerAlign,
          },
        });
      }
    }
  });

  it("accepts all editor styles and colors", () => {
    for (const editorStyle of ["native", "compact", "rounded"] as const) {
      for (const editorColor of ["thinking", "dim", "muted"] as const) {
        loadConfig(
          undefined,
          createStorage({
            read: () =>
              JSON.stringify({
                editor: {
                  style: editorStyle,
                  color: editorColor,
                },
              }),
          }),
        );
        expect(getConfig()).toEqual({
          ...getDefaultConfig(),
          editor: {
            ...getDefaultConfig().editor,
            style: editorStyle,
            color: editorColor,
          },
        });
      }
    }
  });

  it("accepts native and shimmer Working styles and rejects other values", () => {
    for (const workingIndicatorStyle of [
      "native",
      "shimmer",
      "unsupported",
      false,
      null,
    ]) {
      loadConfig(
        undefined,
        createStorage({
          read: () =>
            JSON.stringify({
              workingIndicator: {
                style: workingIndicatorStyle,
              },
            }),
        }),
      );
      expect(getConfig().workingIndicator.style).toBe(
        workingIndicatorStyle === "native" ? "native" : "shimmer",
      );
    }
  });

  it("recovers invalid primitive and enum values", () => {
    loadConfig(
      undefined,
      createStorage({
        read: () =>
          JSON.stringify({
            editor: {
              showBranch: "false",
              showCost: 1,
              style: "unsupported",
              color: "unsupported",
            },
            header: {
              style: false,
              align: "right",
            },
            tools: {
              indicator: {
                style: null,
              },
            },
          }),
      }),
    );
    expect(getConfig()).toEqual(getDefaultConfig());
  });
});

describe("config numeric values", () => {
  it("accepts only configured maxExpandedEntries values", () => {
    for (const value of [-1, 10, 20, 50, 100] as const) {
      loadConfig(
        undefined,
        createStorage({
          read: () =>
            JSON.stringify({
              tools: {
                maxExpandedEntries: value,
              },
            }),
        }),
      );
      expect(getConfig().tools.maxExpandedEntries).toBe(value);
    }

    for (const value of [0, 25, 99, 20.5, null, "20", "NaN", "Infinity"]) {
      loadConfig(
        undefined,
        createStorage({
          read: () =>
            JSON.stringify({
              tools: {
                maxExpandedEntries: value,
              },
            }),
        }),
      );
      expect(getConfig().tools.maxExpandedEntries).toBe(
        getDefaultConfig().tools.maxExpandedEntries,
      );
    }
  });

  it("falls back to defaults for fractional numeric values loaded from disk", () => {
    writeFileSync(
      process.env.PI_TUI_TWEAKS_CONFIG_PATH!,
      JSON.stringify({
        tools: {
          maxExpandedEntries: 10.5,
        },
      }),
    );
    loadConfig();
    expect(getConfig().tools.maxExpandedEntries).toBe(20);
  });

  it("validates collapsedOutputDisplay against allowed values", () => {
    expect(getConfig().tools.collapsedOutputDisplay).toBe("preview");
    writeFileSync(
      process.env.PI_TUI_TWEAKS_CONFIG_PATH!,
      JSON.stringify({
        tools: {
          collapsedOutputDisplay: "summary",
        },
      }),
    );
    loadConfig();
    expect(getConfig().tools.collapsedOutputDisplay).toBe("summary");

    writeFileSync(
      process.env.PI_TUI_TWEAKS_CONFIG_PATH!,
      JSON.stringify({
        tools: {
          collapsedOutputDisplay: "tail",
        },
      }),
    );
    loadConfig();
    expect(getConfig().tools.collapsedOutputDisplay).toBe("preview");
  });
});

describe("config storage failures", () => {
  it("falls back to defaults when the config directory cannot be prepared", () => {
    setTestConfig({
      header: {
        align: "center",
      },
    });
    const failure = new Error("prepare failed");
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({
        prepare() {
          throw failure;
        },
      }),
    );
    expect(getConfig().header.align).toBe(getDefaultConfig().header.align);
    expect(errors).toEqual([failure]);
  });

  it("reports a failure to create a missing config file", () => {
    const failure = new Error("create failed");
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({
        exists: () => false,
        write() {
          throw failure;
        },
      }),
    );
    expect(getConfig().header.align).toBe(getDefaultConfig().header.align);
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config cannot be read", () => {
    setTestConfig({
      header: {
        align: "center",
      },
    });
    const failure = new Error("read failed");
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read() {
          throw failure;
        },
      }),
    );
    expect(getConfig().header.align).toBe(getDefaultConfig().header.align);
    expect(errors).toEqual([failure]);
  });

  it("falls back to defaults when the config contains malformed JSON", () => {
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({ read: () => "{" }),
    );
    expect(getConfig().header.align).toBe(getDefaultConfig().header.align);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
  });

  it("keeps validated config when normalization cannot be persisted", () => {
    const failure = new Error("normalize failed");
    const errors: unknown[] = [];
    loadConfig(
      (error) => errors.push(error),
      createStorage({
        read: () =>
          JSON.stringify({
            header: {
              align: "center",
            },
          }),
        write() {
          throw failure;
        },
      }),
    );
    expect(getConfig().header.align).toBe("center");
    expect(errors).toEqual([failure]);
  });
});
