import type {
  ExtensionAPI,
  ToolRendererResolver,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "../config/store";
import { patchTools } from "./built-ins";
import { createCodemodeRenderers } from "./codemode";
import { clearCodemodeTimers } from "./codemode/timing";
import {
  createWrappedRenderers,
  shouldWrapRenderers,
  type DefinitionAdapterOptions,
} from "./custom-tools/definition-adapter";
import type {
  CustomToolRenderingIssue,
  CustomToolRenderingReporter,
} from "./custom-tools/types";
import { updateBlinkTimer } from "./rendering/state";
import type { BaseRenderState } from "./rendering/types";

function defaultReporter(issue: CustomToolRenderingIssue): void {
  const tool = issue.toolName ? ` for ${issue.toolName}` : "";
  console.warn(
    `[pi-tui-tweaks] Tool rendering ${issue.stage} failed${tool}; continuing without that enhancement.`,
    issue.error,
  );
}

export function createToolRendering(
  pi: Pick<ExtensionAPI, "getAllTools">,
  options: {
    isToolCallActive: (toolCallId: string) => boolean;
    isEnabled: () => boolean;
    reportIssue?: CustomToolRenderingReporter;
  },
) {
  const core = patchTools();
  const customStates = new Set<BaseRenderState>();
  const reported = new Set<string>();
  const reportIssue = (issue: CustomToolRenderingIssue): void => {
    const key = `${issue.toolName ?? ""}:${issue.stage}`;
    if (reported.has(key)) return;
    reported.add(key);
    try {
      (options.reportIssue ?? defaultReporter)(issue);
    } catch {
      /* Diagnostics must not interrupt rendering. */
    }
  };
  const customEnabled = () =>
    options.isEnabled() && getConfig().tools.enhanceCustomTools;
  function createAdapterOptions(toolName: string): DefinitionAdapterOptions {
    return {
      isToolCallActive(toolCallId) {
        try {
          return customEnabled() && options.isToolCallActive(toolCallId);
        } catch (error) {
          reportIssue({ stage: "activity", toolName, error });
          return false;
        }
      },
      reportIssue,
      trackState(state) {
        if (state.hasResult === true) {
          if (state.blinkTimer)
            updateBlinkTimer(state, false, state.blinkTimer.invalidate);
          customStates.delete(state);
        } else customStates.add(state);
      },
    };
  }

  const resolve: ToolRendererResolver = (toolName, next) => {
    const native = next();
    if (!native || !options.isEnabled()) return native;
    try {
      const source = pi
        .getAllTools()
        .find((tool) => tool.name === toolName)?.sourceInfo;
      const builtin =
        source?.source === "builtin" && source.path === `builtin:${toolName}`;
      const coreRenderers = builtin ? core.get(toolName) : undefined;
      if (coreRenderers) return coreRenderers;
      if (
        !getConfig().tools.enhanceCustomTools ||
        !source ||
        !shouldWrapRenderers(native)
      )
        return native;
      const adapterOptions = createAdapterOptions(toolName);
      const enhanced =
        builtin && toolName === "codemode"
          ? createCodemodeRenderers(native, adapterOptions)
          : createWrappedRenderers(toolName, native, adapterOptions);
      return enhanced;
    } catch (error) {
      reportIssue({ stage: "metadata", toolName, error });
      return native;
    }
  };

  function clearCustomTimers(): void {
    clearCodemodeTimers(customStates);
    customStates.clear();
  }

  return {
    resolve,
    clearCustomTimers,
    reset() {
      clearCustomTimers();
      reported.clear();
    },
  };
}
