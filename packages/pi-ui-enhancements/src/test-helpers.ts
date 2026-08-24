import {
  ExtensionRunner,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";

export function mkTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (s: string) => s,
    getBashModeBorderColor: () => (s: string) => s,
  } as unknown as Theme;
}

export function setupTool(
  patchFn: (pi: ExtensionAPI, ctx: ExtensionContext) => void,
) {
  let definition: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
  const pi = {
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      definition = tool;
    },
  } as unknown as ExtensionAPI;
  const ctx = { cwd: process.cwd() } as ExtensionContext;
  patchFn(pi, ctx);
  return definition!;
}

export const CUSTOM_TOOL_PATCH_STATE = Symbol.for(
  "@blazer2k/pi-ui-enhancements/custom-tools/patch-state/v1",
);

export function mkToolCtx(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    toolCallId: "call-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    isPartial: false,
    isError: false,
    expanded: false,
    argsComplete: true,
    showImages: false,
    ...overrides,
  };
}

export function cleanRunnerProto() {
  const proto = ExtensionRunner.prototype as unknown as Record<
    string | symbol,
    unknown
  >;
  const state = proto[CUSTOM_TOOL_PATCH_STATE] as
    | { originalDescriptor?: PropertyDescriptor }
    | undefined;
  if (state?.originalDescriptor) {
    Object.defineProperty(
      proto,
      "getAllRegisteredTools",
      state.originalDescriptor,
    );
  }
  delete proto[CUSTOM_TOOL_PATCH_STATE];
}
