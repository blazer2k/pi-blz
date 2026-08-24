import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { ExtensionRunner } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "../../config";
import { cleanRunnerProto, mkTheme, mkToolCtx } from "../../test-helpers";
import { clearBlinkTimers } from "../rendering/state";
import { patchCustomToolRendering } from "./patch-manager";

const originalConfigPath = process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
let configDir: string;

beforeEach(() => {
  cleanRunnerProto();
  configDir = mkdtempSync(join(tmpdir(), "pi-ui-custom-tools-"));
  process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = join(configDir, "settings.json");
  loadConfig();
  saveConfig("capitalizeToolNames", "false");
});

afterEach(() => {
  cleanRunnerProto();
  clearBlinkTimers();
  rmSync(configDir, { recursive: true, force: true });
  if (originalConfigPath === undefined) {
    delete process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH;
  } else {
    process.env.PI_UI_ENHANCEMENTS_CONFIG_PATH = originalConfigPath;
  }
  loadConfig();
});

const proto = ExtensionRunner.prototype as unknown as Record<
  string | symbol,
  unknown
>;

function mkRegisteredTool(name: string) {
  const def: ToolDefinition = {
    name,
    label: name,
    description: `test ${name}`,
    parameters: {} as any,
    execute: async () => ({ content: [], details: undefined }),
  };
  return { definition: def, sourceInfo: undefined };
}

describe("patchCustomToolRendering", () => {
  it("wraps third-party tools", () => {
    proto.getAllRegisteredTools = function () {
      return [mkRegisteredTool("myTool")];
    };

    const handle = patchCustomToolRendering();
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as unknown[];

    expect(
      (tools[0] as { definition: { renderShell?: string } }).definition
        .renderShell,
    ).toBe("self");
    handle.dispose();
  });

  it("does not wrap tools that own their render shell", () => {
    const tools = [mkRegisteredTool("read"), mkRegisteredTool("powershell")];
    for (const tool of tools) tool.definition.renderShell = "self";
    proto.getAllRegisteredTools = function () {
      return tools;
    };

    patchCustomToolRendering();
    const registered = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as unknown[];

    expect(
      registered.map((tool) => (tool as (typeof tools)[number]).definition),
    ).toEqual(tools.map((tool) => tool.definition));
  });

  it("does not double-wrap already wrapped tools", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    patchCustomToolRendering();
    const getter = proto.getAllRegisteredTools as Function;
    const first = getter.call({} as any) as unknown[];
    const second = getter.call({} as any) as unknown[];

    // definition-level cache: same wrapped definition reused
    expect((first[0] as { definition: unknown }).definition).toBe(
      (second[0] as { definition: unknown }).definition,
    );
  });

  it("dispose restores original prototype method", () => {
    const original = function () {
      return [];
    };
    proto.getAllRegisteredTools = original;

    const handle = patchCustomToolRendering();
    expect(proto.getAllRegisteredTools).not.toBe(original);

    handle.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
  });

  it("dispose restores the complete original property descriptor", () => {
    const original = function () {
      return [];
    };
    Object.defineProperty(proto, "getAllRegisteredTools", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: original,
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      proto,
      "getAllRegisteredTools",
    );

    const handle = patchCustomToolRendering();
    handle.dispose();

    expect(
      Object.getOwnPropertyDescriptor(proto, "getAllRegisteredTools"),
    ).toEqual(originalDescriptor);
  });

  it("fails open when Pi's registry method is unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      proto,
      "getAllRegisteredTools",
    )!;
    const issues: unknown[] = [];
    delete proto.getAllRegisteredTools;

    try {
      const handle = patchCustomToolRendering(undefined, (issue) =>
        issues.push(issue),
      );
      handle.dispose();

      expect(issues).toEqual([expect.objectContaining({ stage: "install" })]);
      expect(proto.getAllRegisteredTools).toBeUndefined();
    } finally {
      Object.defineProperty(proto, "getAllRegisteredTools", originalDescriptor);
    }
  });

  it("leaves an unexpected registry value untouched", () => {
    const registry = { tools: [] };
    proto.getAllRegisteredTools = function () {
      return registry as any;
    };
    const issues: unknown[] = [];

    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );
    const result = (proto.getAllRegisteredTools as Function).call({} as any);

    expect(result).toBe(registry);
    expect(issues).toEqual([expect.objectContaining({ stage: "registry" })]);
    handle.dispose();
  });

  it("reports registry failures without changing their error", () => {
    const failure = new Error("registry failed");
    proto.getAllRegisteredTools = function () {
      throw failure;
    };
    const issues: unknown[] = [];
    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );

    expect(() =>
      (proto.getAllRegisteredTools as Function).call({} as any),
    ).toThrow(failure);
    expect(() =>
      (proto.getAllRegisteredTools as Function).call({} as any),
    ).toThrow(failure);
    expect(issues).toEqual([
      expect.objectContaining({ stage: "registry", error: failure }),
    ]);
    handle.dispose();
  });

  it("keeps the patch until every client disposes", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const h1 = patchCustomToolRendering();
    const h2 = patchCustomToolRendering();

    expect(proto.getAllRegisteredTools).not.toBe(original);

    h1.dispose();
    expect(proto.getAllRegisteredTools).not.toBe(original);

    h2.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
  });

  it("makes disposal idempotent for each client", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const h1 = patchCustomToolRendering();
    const h2 = patchCustomToolRendering();

    h1.dispose();
    h1.dispose();
    expect(proto.getAllRegisteredTools).not.toBe(original);

    h2.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
  });

  it("uses every active client's activity predicate", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const inactive = patchCustomToolRendering(() => false);
    const active = patchCustomToolRendering(
      (toolCallId) => toolCallId === "call-1",
    );
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    const state = {};

    tools[0]!.definition.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ state, isPartial: true, executionStarted: true }),
    );

    expect((state as any)._uiEnhancements.blinkTimer).toBeDefined();
    inactive.dispose();
    active.dispose();
  });

  it("ignores a broken activity predicate and reports it once", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };
    const issues: unknown[] = [];
    const broken = patchCustomToolRendering(
      () => {
        throw new Error("activity failed");
      },
      (issue) => issues.push(issue),
    );
    const active = patchCustomToolRendering(() => true);
    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    for (let render = 0; render < 2; render++) {
      tools[0]!.definition.renderCall!(
        {},
        mkTheme(),
        mkToolCtx({
          state: {},
          isPartial: true,
          executionStarted: true,
        }),
      );
    }

    expect(issues).toEqual([
      expect.objectContaining({ stage: "activity", toolName: "myTool" }),
    ]);
    broken.dispose();
    active.dispose();
  });

  it("lets cached definitions observe clients installed later", () => {
    const tool = mkRegisteredTool("myTool");
    proto.getAllRegisteredTools = function () {
      return [tool];
    };

    const inactive = patchCustomToolRendering(() => false);
    const getter = proto.getAllRegisteredTools as Function;
    const first = getter.call({} as any) as Array<{
      definition: ToolDefinition;
    }>;
    const active = patchCustomToolRendering(() => true);
    const second = getter.call({} as any) as Array<{
      definition: ToolDefinition;
    }>;
    const state = {};

    expect(second[0]!.definition).toBe(first[0]!.definition);
    second[0]!.definition.renderCall!(
      {},
      mkTheme(),
      mkToolCtx({ state, isPartial: true, executionStarted: true }),
    );
    expect((state as any)._uiEnhancements.blinkTimer).toBeDefined();

    inactive.dispose();
    active.dispose();
  });

  it("disabled patch stops wrapping even when another patch is chained after it", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const handle = patchCustomToolRendering();
    const patched = proto.getAllRegisteredTools as Function;
    proto.getAllRegisteredTools = function () {
      return patched.call(this);
    };

    handle.dispose();

    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    expect(tools[0]!.definition.renderShell).toBeUndefined();
  });

  it("reactivates the existing layer when another patch is chained after it", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const first = patchCustomToolRendering();
    const patched = proto.getAllRegisteredTools as Function;
    proto.getAllRegisteredTools = function () {
      return patched.call(this);
    };
    first.dispose();

    const second = patchCustomToolRendering();
    const activeTools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    expect(activeTools[0]!.definition.renderShell).toBe("self");

    second.dispose();
    const inactiveTools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;
    expect(inactiveTools[0]!.definition.renderShell).toBeUndefined();
  });

  it("reinstalls after an inactive chained layer is removed", () => {
    const original = function () {
      return [mkRegisteredTool("myTool")];
    };
    proto.getAllRegisteredTools = original;

    const first = patchCustomToolRendering();
    const patched = proto.getAllRegisteredTools as Function;
    proto.getAllRegisteredTools = function () {
      return patched.call(this);
    };
    first.dispose();
    proto.getAllRegisteredTools = original;

    const second = patchCustomToolRendering();
    expect(proto.getAllRegisteredTools).not.toBe(original);
    second.dispose();
    expect(proto.getAllRegisteredTools).toBe(original);
  });

  it("keeps invalid registry entries unchanged and reports once", () => {
    const invalid = { sourceInfo: undefined };
    proto.getAllRegisteredTools = function () {
      return [invalid, invalid] as any;
    };
    const issues: unknown[] = [];

    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );
    const tools = (proto.getAllRegisteredTools as Function).call({} as any);

    expect(tools).toEqual([invalid, invalid]);
    expect(issues).toEqual([expect.objectContaining({ stage: "definition" })]);
    handle.dispose();
  });

  it("keeps definitions unchanged when their metadata cannot be read", () => {
    const tool = mkRegisteredTool("myTool");
    Object.defineProperty(tool.definition, "renderShell", {
      configurable: true,
      get() {
        throw new Error("metadata failed");
      },
    });
    proto.getAllRegisteredTools = function () {
      return [tool];
    };
    const issues: unknown[] = [];
    const handle = patchCustomToolRendering(undefined, (issue) =>
      issues.push(issue),
    );

    const tools = (proto.getAllRegisteredTools as Function).call(
      {} as any,
    ) as Array<{ definition: ToolDefinition }>;

    expect(tools[0]!.definition).toBe(tool.definition);
    expect(issues).toEqual([
      expect.objectContaining({ stage: "definition", toolName: "myTool" }),
    ]);
    handle.dispose();
  });
});
