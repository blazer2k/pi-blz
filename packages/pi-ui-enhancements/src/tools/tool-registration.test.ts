import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
  SourceInfo,
  ToolInfo,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "../config/store";
import { mkTheme, mkToolCtx, setTestConfig } from "../testing/helpers";
import { createWrappedRenderers } from "./custom-tools/definition-adapter";
import { clearBlinkTimers } from "./rendering/state";
import { createToolRendering } from "./tool-registration";

const originalPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-ui-renderer-resolver-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(directory, "settings.json");
  loadConfig();
});
afterEach(() => {
  clearBlinkTimers();
  rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined)
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  else process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalPath;
  loadConfig();
});
const native: ToolRenderers = {
  renderCall: () => new Text("native wording", 0, 0),
  renderResult: () => new Text("native result", 0, 0),
};
function source(name: string, origin = "builtin"): SourceInfo {
  return {
    source: origin,
    path: `builtin:${name}`,
    scope: "temporary",
    origin: "top-level",
  };
}
function info(name: string, sourceInfo = source(name)): ToolInfo {
  return {
    name,
    description: name,
    parameters: {} as any,
    exposure: "direct",
    sourceInfo,
  };
}
function output(renderers: ToolRenderers) {
  return renderers.renderResult!(
    { content: [{ type: "text", text: "a\nb\nc\nd" }], details: { calls: [] } },
    { expanded: false, isPartial: false },
    mkTheme(),
    mkToolCtx(),
  )
    .render(120)
    .join("\n");
}

describe("public tool renderer resolver", () => {
  it("calls the downstream resolver once and leaves unknown tools unchanged", () => {
    let calls = 0;
    const layer = createToolRendering(
      { getAllTools: () => [] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    expect(
      layer.resolve("unknown", () => {
        calls++;
        return native;
      }),
    ).toBe(native);
    expect(calls).toBe(1);
    expect(layer.resolve("unknown", () => undefined)).toBeUndefined();
    expect(layer.resolve("read", () => undefined)).toBeUndefined();
  });

  it("overrides only verified native core tools, including native self-rendering Edit", () => {
    const layer = createToolRendering(
      { getAllTools: () => [info("read"), info("edit")] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    expect(layer.resolve("read", () => native)!.renderCall).not.toBe(
      native.renderCall,
    );
    const edit = { ...native, renderShell: "self" as const };
    expect(layer.resolve("edit", () => edit)!.renderCall).not.toBe(
      edit.renderCall,
    );
    setTestConfig({ patchCustomTools: false });
    expect(layer.resolve("read", () => native)!.renderCall).not.toBe(
      native.renderCall,
    );
    const thirdParty = createToolRendering(
      { getAllTools: () => [info("read", source("read", "inline"))] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    expect(thirdParty.resolve("read", () => edit)).toBe(edit);
  });

  for (const sourceInfo of [
    source("codemode"),
    source("other"),
    source("codemode", "inline"),
  ]) {
    it(`specializes Codemode only for ${sourceInfo.source}/${sourceInfo.path}`, () => {
      const layer = createToolRendering(
        { getAllTools: () => [info("codemode", sourceInfo)] },
        { isEnabled: () => true, isToolCallActive: () => false },
      );
      const renderer = layer.resolve("codemode", () => ({
        renderCall: native.renderCall,
      }))!;
      expect(output(renderer).includes("+2 lines")).toBe(
        sourceInfo.source === "builtin" &&
          sourceInfo.path === "builtin:codemode",
      );
    });
  }

  it("respects self-rendering and already wrapped custom renderers", () => {
    const layer = createToolRendering(
      { getAllTools: () => [info("tool", source("tool", "inline"))] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    const self = { ...native, renderShell: "self" as const };
    expect(layer.resolve("tool", () => self)).toBe(self);
    const wrapped = createWrappedRenderers("tool", native, {
      isToolCallActive: () => false,
      reportIssue() {},
    });
    expect(layer.resolve("tool", () => wrapped)).toBe(wrapped);
  });

  it("reads live settings on every resolution while keeping existing row shells stable", () => {
    let enabled = true;
    const layer = createToolRendering(
      { getAllTools: () => [info("tool", source("tool", "inline"))] },
      { isEnabled: () => enabled, isToolCallActive: () => false },
    );
    setTestConfig({ patchCustomTools: false });
    expect(layer.resolve("tool", () => native)).toBe(native);
    setTestConfig({ patchCustomTools: true });
    const enhanced = layer.resolve("tool", () => native)!;
    expect(enhanced.renderCall).not.toBe(native.renderCall);
    expect(enhanced.renderShell).toBe("self");
    setTestConfig({ patchCustomTools: false });
    expect(layer.resolve("tool", () => native)).toBe(native);
    expect(enhanced.renderShell).toBe("self");
    enabled = false;
    layer.reset();
    layer.reset();
    expect(layer.resolve("tool", () => native)).toBe(native);
    enabled = true;
    setTestConfig({ patchCustomTools: true });
    expect(layer.resolve("tool", () => native)!.renderCall).not.toBe(
      native.renderCall,
    );
  });

  it("uses current metadata and callbacks after dynamic registration", () => {
    let metadata: ToolInfo[] = [];
    const layer = createToolRendering(
      { getAllTools: () => metadata },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    expect(layer.resolve("tool", () => native)).toBe(native);
    metadata = [info("tool", source("tool", "inline"))];
    const first = layer.resolve("tool", () => ({ ...native }))!;
    expect(
      first.renderCall!({}, mkTheme(), mkToolCtx()).render(80).join("\n"),
    ).toContain("Native wording");
    const changed = {
      ...native,
      renderCall: () => new Text("new wording", 0, 0),
    };
    const second = layer.resolve("tool", () => changed)!;
    expect(
      second.renderCall!({}, mkTheme(), mkToolCtx()).render(80).join("\n"),
    ).toContain("New wording");
    metadata = [];
    expect(layer.resolve("tool", () => changed)).toBe(changed);
  });

  it("fails open and reports unavailable metadata once per session", () => {
    const issues: unknown[] = [];
    const layer = createToolRendering(
      {
        getAllTools: () => {
          throw new Error("not initialized");
        },
      },
      {
        isEnabled: () => true,
        isToolCallActive: () => false,
        reportIssue: (issue) => {
          issues.push(issue);
        },
      },
    );
    for (let i = 0; i < 2; i++)
      expect(layer.resolve("tool", () => native)).toBe(native);
    expect(issues).toEqual([
      expect.objectContaining({ stage: "metadata", toolName: "tool" }),
    ]);
    layer.reset();
    layer.resolve("tool", () => native);
    expect(issues).toHaveLength(2);
  });

  it("leaves a bundle unchanged when its renderer properties throw", () => {
    const issues: unknown[] = [];
    const broken: ToolRenderers = {
      get renderShell(): ToolRenderers["renderShell"] {
        throw new Error("renderer metadata failed");
      },
    };
    const layer = createToolRendering(
      { getAllTools: () => [info("tool", source("tool", "inline"))] },
      {
        isEnabled: () => true,
        isToolCallActive: () => false,
        reportIssue: (issue) => {
          issues.push(issue);
        },
      },
    );
    for (let i = 0; i < 2; i++)
      expect(layer.resolve("tool", () => broken)).toBe(broken);
    expect(issues).toEqual([
      expect.objectContaining({ stage: "metadata", toolName: "tool" }),
    ]);
  });

  it("preserves downstream exceptions rather than swallowing another resolver's failure", () => {
    const layer = createToolRendering(
      { getAllTools: () => [] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    const failure = new Error("downstream failure");
    expect(() =>
      layer.resolve("tool", () => {
        throw failure;
      }),
    ).toThrow(failure);
  });

  it("keeps a broken activity predicate and reporter from interrupting rendering", () => {
    const issues: unknown[] = [];
    const layer = createToolRendering(
      { getAllTools: () => [info("tool", source("tool", "inline"))] },
      {
        isEnabled: () => true,
        isToolCallActive: () => {
          throw new Error("activity");
        },
        reportIssue: (issue) => {
          issues.push(issue);
          throw new Error("reporter");
        },
      },
    );
    const bundle = layer.resolve("tool", () => native)!;
    for (let i = 0; i < 2; i++)
      expect(
        bundle.renderCall!({}, mkTheme(), mkToolCtx()).render(80).join("\n"),
      ).toContain("Native wording");
    expect(issues).toEqual([
      expect.objectContaining({ stage: "activity", toolName: "tool" }),
    ]);
    layer.reset();
  });

  it("reuses native components across fresh bundles without a wrapper cache", () => {
    const previous: unknown[] = [];
    const nativeCall = (
      _args: unknown,
      _theme: unknown,
      context: Parameters<NonNullable<ToolRenderers["renderCall"]>>[2],
    ) => {
      previous.push(context.lastComponent);
      return context.lastComponent ?? new Text("reuse", 0, 0);
    };
    const layer = createToolRendering(
      { getAllTools: () => [info("tool", source("tool", "inline"))] },
      { isEnabled: () => true, isToolCallActive: () => false },
    );
    const context = mkToolCtx();
    for (let i = 0; i < 2; i++)
      layer.resolve("tool", () => ({ renderCall: nativeCall }))!.renderCall!(
        {},
        mkTheme(),
        context,
      ).render(80);
    expect(previous[0]).toBeUndefined();
    expect(previous[1]).toBeInstanceOf(Text);
    layer.reset();
  });

  it("does not share activity or cleanup state between extension instances", () => {
    const pi = { getAllTools: () => [info("tool", source("tool", "inline"))] };
    const active = createToolRendering(pi, {
      isEnabled: () => true,
      isToolCallActive: () => true,
    });
    const inactive = createToolRendering(pi, {
      isEnabled: () => true,
      isToolCallActive: () => false,
    });
    const activeContext = mkToolCtx({ isPartial: true });
    const inactiveContext = mkToolCtx({ isPartial: true });
    active.resolve("tool", () => native)!.renderCall!(
      {},
      mkTheme(),
      activeContext,
    ).render(80);
    inactive.resolve("tool", () => native)!.renderCall!(
      {},
      mkTheme(),
      inactiveContext,
    ).render(80);
    const activeState = (activeContext.state as any)._uiEnhancements;
    expect(activeState.blinkTimer).toBeDefined();
    expect(
      (inactiveContext.state as any)._uiEnhancements.blinkTimer,
    ).toBeUndefined();
    inactive.clearCustomTimers();
    expect(activeState.blinkTimer).toBeDefined();
    active.clearCustomTimers();
    active.clearCustomTimers();
    expect(activeState.blinkTimer).toBeUndefined();
  });
});
