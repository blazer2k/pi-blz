import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getConfig } from "../config/store";
import { setTestConfig } from "../testing/helpers";
import type { Config } from "../config/definition";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { registerEditor } from "./registration";

const footerTheme = { fg: (_color: string, text: string) => text };
const plainBorder = (text: string) => text;

let previousConfig: Config;
beforeEach(() => {
  previousConfig = getConfig();
});
afterEach(() => {
  setTestConfig(previousConfig);
});

describe("registerEditor", () => {
  it("leaves editor, footer, and usage events untouched in native mode", () => {
    setTestConfig({
      editor: {
        style: "native",
      },
    });
    expect(() => {
      const handle = registerEditor({} as ExtensionAPI, {} as ExtensionContext);
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  it.each(["compact", "rounded"] as const)(
    "owns and restores the %s editor and footer lifecycle",
    async (editorStyle) => {
      setTestConfig({
        editor: {
          style: editorStyle,
        },
      });
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

      const handle = registerEditor(pi, ctx);
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

      handle.dispose();
      handle.dispose();
      expect(editorFactory).toBe(previousEditor);
      expect(footerCleared).toBe(true);
      expect(footerClearCount).toBe(1);

      const next = registerEditor(pi, ctx);
      const replacement = () => ({ render: () => [] });
      editorFactory = replacement;
      const nextFooter = footerFactory!(tui, footerTheme, {
        getGitBranch: () => "main",
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => {},
      });
      nextFooter.dispose();
      next.dispose();
      next.dispose();
      expect(editorFactory).toBe(replacement);
      expect(footerClearCount).toBe(1);
    },
  );
});
