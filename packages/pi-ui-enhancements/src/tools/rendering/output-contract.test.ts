import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ExtensionRunner,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import {
  cleanRunnerProto,
  mkTheme,
  mkToolCtx,
  setupTool,
} from "../../test-helpers";
import { patchBashTool } from "../bash";
import { patchCustomToolRendering } from "../custom-tools";
import { patchEditTool } from "../edit";
import { patchFindTool } from "../find";
import { patchReadTool } from "../read";
import { patchWriteTool } from "../write";
import { clearBlinkTimers } from "./state";

type Renderable = { render(width: number): string[] };
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
};

let restorePiKeybindings: (() => void) | undefined;

beforeAll(async () => {
  // keyText() resolves Pi's own TUI instance, which is nested in the installed
  // Pi package in this workspace.
  const piTui =
    await import("../../../../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js");
  const piKeybindings =
    await import("../../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js");
  const previous = piTui.getKeybindings();
  piTui.setKeybindings(new piKeybindings.KeybindingsManager());
  restorePiKeybindings = () => piTui.setKeybindings(previous);
});

afterAll(() => {
  restorePiKeybindings?.();
  clearBlinkTimers();
  cleanRunnerProto();
});

function meaningfulLines(component: Renderable, width = 80): string[] {
  return component
    .render(width)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function renderCompletedTool(
  patchTool: Parameters<typeof setupTool>[0],
  args: Record<string, unknown>,
  result: ToolResult,
  expanded = false,
): string[] {
  const definition = setupTool(patchTool);
  const state = {};
  const toolCtx = mkToolCtx({ state, args, expanded });
  const resultComponent = definition.renderResult!(
    result,
    { expanded, isPartial: false },
    mkTheme(),
    toolCtx,
  );
  const callComponent = definition.renderCall!(args, mkTheme(), toolCtx);

  return [
    ...meaningfulLines(callComponent),
    ...meaningfulLines(resultComponent),
  ];
}

describe("built-in tool output", () => {
  it("pins completed Bash output", () => {
    expect(
      renderCompletedTool(
        patchBashTool,
        { command: "printf hello" },
        {
          content: [{ type: "text", text: "hello\nworld" }],
          details: { durationMs: 50 },
        },
      ),
    ).toEqual([
      " ● Bash $ printf hello",
      " ├─ took 50ms",
      " │  hello",
      " ╰─ world",
    ]);
  });

  it("pins completed Read output", () => {
    expect(
      renderCompletedTool(
        patchReadTool,
        { path: "src/index.ts" },
        {
          content: [{ type: "text", text: "line one\nline two" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([" ● Read src/index.ts", " ╰─ 2 lines"]);
  });

  it("pins expanded Write output", () => {
    expect(
      renderCompletedTool(
        patchWriteTool,
        { path: "notes.txt", content: "alpha\nbeta" },
        {
          content: [{ type: "text", text: "wrote 2 lines" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([
      " ● Write notes.txt",
      " ├─ 2 lines • ctrl+o to collapse",
      " │  alpha",
      " ╰─ beta",
    ]);
  });

  it("pins collapsed Edit output", () => {
    expect(
      renderCompletedTool(
        patchEditTool,
        { path: "src/a.ts", edits: [{ oldText: "old", newText: "new" }] },
        {
          content: [{ type: "text", text: "edited" }],
          details: {
            diff: [
              "--- a/src/a.ts",
              "+++ b/src/a.ts",
              "@@ -1 +1 @@",
              "-old",
              "+new",
              "",
            ].join("\n"),
          },
        },
      ),
    ).toEqual([" ● Edit src/a.ts", " ╰─ +1 -1 • ctrl+o to expand"]);
  });

  it("pins expanded list output", () => {
    expect(
      renderCompletedTool(
        patchFindTool,
        { pattern: "*.ts", path: "src" },
        {
          content: [{ type: "text", text: "src/a.ts\nsrc/b.ts\nsrc/c.ts" }],
          details: undefined,
        },
        true,
      ),
    ).toEqual([
      " ● Find *.ts in src",
      " ├─ 3 files • ctrl+o to collapse",
      " │  src/a.ts",
      " │  src/b.ts",
      " ╰─ src/c.ts",
    ]);
  });
});

describe("custom tool output", () => {
  it("pins wrapped renderer output", () => {
    cleanRunnerProto();
    const prototype = ExtensionRunner.prototype as unknown as Record<
      string,
      unknown
    >;
    const definition: ToolDefinition = {
      name: "Lookup",
      label: "Lookup",
      description: "test lookup",
      parameters: {} as never,
      execute: async () => ({ content: [], details: undefined }),
      renderCall: () => new Text("Lookup pi", 0, 0),
      renderResult: () => new Text("2 matches", 0, 0),
    };
    prototype.getAllRegisteredTools = () => [
      { definition, sourceInfo: undefined },
    ];
    const handle = patchCustomToolRendering();

    try {
      const tools = (prototype.getAllRegisteredTools as Function).call(
        {},
      ) as Array<{
        definition: ToolDefinition;
      }>;
      const wrapped = tools[0]!.definition;
      const state = {};
      const toolCtx = mkToolCtx({ state, args: { query: "pi" } });
      const result = wrapped.renderResult!(
        { content: [{ type: "text", text: "two" }], details: {} },
        { expanded: false, isPartial: false },
        mkTheme(),
        toolCtx,
      );
      const call = wrapped.renderCall!({ query: "pi" }, mkTheme(), toolCtx);

      expect([...meaningfulLines(call), ...meaningfulLines(result)]).toEqual([
        " ● Lookup pi",
        " ╰─ 2 matches",
      ]);
    } finally {
      handle.dispose();
      cleanRunnerProto();
    }
  });
});

describe("terminal width contract", () => {
  it("stays within Pi's one-column minimum through width 200", () => {
    const definition = setupTool(patchFindTool);
    const state = {};
    const args = { pattern: "*.ts", path: "src" };
    const toolCtx = mkToolCtx({ state, args, expanded: true });
    const component = definition.renderResult!(
      {
        content: [{ type: "text", text: "src/a.ts\nsrc/b.ts\nsrc/c.ts" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      mkTheme(),
      toolCtx,
    );

    for (let width = 0; width <= 200; width++) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(width, 1));
      }
    }
  });
});
