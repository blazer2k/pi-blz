import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { patchTools } from "./built-ins";

describe("patchTools", () => {
  it("registers all supported built-in renderers without activating tools", () => {
    const registered: Array<Parameters<ExtensionAPI["registerTool"]>[0]> = [];
    const pi = {
      registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
        registered.push(tool);
      },
    } as unknown as ExtensionAPI;

    const handles = patchTools(pi);

    expect(registered.map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "ls",
      "find",
      "grep",
    ]);
    expect(registered.every((tool) => tool.defaultActive === false)).toBe(true);
    handles.forEach((handle) => handle.dispose());
  });
});
