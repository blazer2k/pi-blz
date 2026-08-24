import { describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerRoundedEditor } from "./registration";

const footerTheme = { fg: (_color: string, text: string) => text };
const plainBorder = (text: string) => text;

describe("registerRoundedEditor", () => {
  it("owns and restores the editor and footer lifecycle", async () => {
    const handlers: Record<string, () => Promise<void>> = {};
    const pi = {
      on: (event: string, handler: () => Promise<void>) => {
        handlers[event] = handler;
      },
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    const previousEditor = () => ({ render: () => [] });
    let editorFactory: Function = previousEditor;
    let footerFactory: Function | undefined;
    let footerCleared = false;
    let footerClearCount = 0;
    let renderRequests = 0;
    let reregister: (() => void) | undefined;
    const ctx = {
      cwd: "/repo",
      model: undefined,
      getContextUsage: () => undefined,
      sessionManager: { getEntries: () => [] },
      ui: {
        theme: {
          fg: (_color: string, text: string) => text,
          getThinkingBorderColor: () => (text: string) => text,
          getBashModeBorderColor: () => (text: string) => text,
        },
        getEditorComponent: () => editorFactory,
        setEditorComponent: (factory: Function) => {
          editorFactory = factory;
        },
        setFooter: (factory: Function | undefined) => {
          footerFactory = factory;
          footerCleared = factory === undefined;
          if (factory === undefined) footerClearCount++;
        },
      },
    } as unknown as ExtensionContext;

    const handle = registerRoundedEditor(pi, ctx, (register) => {
      reregister = register;
    });
    expect(editorFactory).not.toBe(previousEditor);

    const tui = {
      terminal: { rows: 24 },
      requestRender: () => {
        renderRequests++;
      },
    };
    const footer = footerFactory!(tui, footerTheme, {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map([["status", "ready"]]),
      onBranchChange: () => () => {},
    });
    expect(footer.render(80)).toEqual(["", "ready"]);

    const editor = editorFactory(
      tui,
      { borderColor: plainBorder, selectList: {} },
      { matches: () => false },
    );
    expect(editor.render(40).join("\n")).toContain("/repo (main)");

    await handlers.agent_end!();
    expect(renderRequests).toBeGreaterThan(0);

    editorFactory = previousEditor;
    reregister!();
    expect(editorFactory).not.toBe(previousEditor);

    handle.dispose();
    handle.dispose();
    reregister!();
    expect(editorFactory).toBe(previousEditor);
    expect(footerCleared).toBe(true);
    expect(footerClearCount).toBe(1);
  });
});
