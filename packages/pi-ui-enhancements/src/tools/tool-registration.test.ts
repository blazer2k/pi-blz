import { describe, expect, it } from "bun:test";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  createCwdDeferredTool,
  registerPatchedTool,
} from "./tool-registration";

const fakeComponent = { render: () => [] } as unknown as Component;

describe("registerPatchedTool", () => {
  it("keeps native tool properties and only replaces rendering", () => {
    const registrations: ToolDefinition<any, any, any>[] = [];
    const pi = {
      registerTool: (tool: ToolDefinition<any, any, any>) => {
        registrations.push(tool);
      },
    } as unknown as ExtensionAPI;

    const tool = createCwdDeferredTool(createBashToolDefinition);
    registerPatchedTool({
      pi,
      tool,
      renderCall: () => fakeComponent,
      renderResult: () => fakeComponent,
    });

    const native = createBashToolDefinition(process.cwd());
    const registered = registrations[0]!;

    expect(registered.name).toBe("bash");
    expect(registered.label).toBe("bash");
    expect(registered.description).toBe(native.description);
    expect(registered.parameters).toEqual(native.parameters);
    expect(registered.promptSnippet).toBe(native.promptSnippet);
    expect(registered.promptGuidelines).toEqual(native.promptGuidelines);
    expect(registered.constrainedSampling).toEqual(native.constrainedSampling);
    expect(registered.prepareArguments).toBe(native.prepareArguments);
    expect(registered.executionMode).toBe(native.executionMode);
    expect(registered.renderShell).toBe("self");
    expect(registered.renderCall).not.toBe(native.renderCall);
    expect(registered.renderResult).not.toBe(native.renderResult);
  });
});
