import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Handle } from "../types";
import { clearBlinkTimers } from "./tool-rendering";

type ToolRegistration = Parameters<ExtensionAPI["registerTool"]>[0];

type BaseTool = {
  description: ToolRegistration["description"];
  parameters: ToolRegistration["parameters"];
  prepareArguments?: ToolRegistration["prepareArguments"];
  executionMode?: ToolRegistration["executionMode"];
  execute: NonNullable<ToolRegistration["execute"]>;
};

export function createCwdDeferredTool(
  createTool: (cwd: string) => BaseTool,
): BaseTool {
  const meta = createTool(process.cwd());
  const execute: BaseTool["execute"] = (
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) => createTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);

  return { ...meta, execute };
}

export function registerPatchedTool(config: {
  pi: ExtensionAPI;
  tool: BaseTool;
  name: ToolRegistration["name"];
  label: ToolRegistration["label"];
  promptSnippet: NonNullable<ToolRegistration["promptSnippet"]>;
  promptGuidelines?: ToolRegistration["promptGuidelines"];
  execute?: ToolRegistration["execute"];
  renderCall: NonNullable<ToolRegistration["renderCall"]>;
  renderResult: NonNullable<ToolRegistration["renderResult"]>;
}): Handle {
  config.pi.registerTool({
    name: config.name,
    label: config.label,
    description: config.tool.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    parameters: config.tool.parameters,
    prepareArguments: config.tool.prepareArguments,
    executionMode: config.tool.executionMode,
    renderShell: "self",
    execute: config.execute ?? config.tool.execute,
    renderCall: config.renderCall,
    renderResult: config.renderResult,
  });

  return {
    dispose() {
      clearBlinkTimers();
    },
  };
}
