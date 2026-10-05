# @blazer2k/pi-ui-enhancements

Compact tool output and a configurable terminal interface for [pi](https://pi.dev).

**Current version:** 0.1.0

## Overview

This extension adds:

- An ASCII art header at session start, using figlet or the bundled Greek pi fonts.
- A rounded editor border showing the working directory, git branch, model, token usage, and context percentage.
- A shimmer animation on the "Working" label, with elapsed time and an interrupt hint.
- Compact tool output with tree-style lines and clickable paths when your terminal supports them. This also works with eligible third-party tools.
- Optional capitalization of tool headers, enabled by default.

![Example: compact tool output with ASCII header](images/example.webp)

![Example: rounded editor border with working indicator](images/editor.webp)

## Installation

```bash
pi install npm:@blazer2k/pi-ui-enhancements
```

For local development:

```bash
git clone https://github.com/blazer2k/pi-blz.git
cd pi-blz
npm install
pi -e ./packages/pi-ui-enhancements/src/index.ts
```

## Settings

Edit `~/.pi/agent/ui-settings.json`, then run `/reload` in pi. Changes are loaded at startup or on reload, not when the file is edited. This extension does not add a settings command.

The file is created with defaults when the extension loads. Missing keys are filled in, and invalid values fall back to their defaults. Use JSON booleans and numbers, not quoted strings. Use `PI_UI_ENHANCEMENTS_CONFIG_PATH` to choose a different settings file.

For example:

```json
{
  "asciiHeaderEnabled": false,
  "collapsedOutputDisplay": "summary",
  "maxExpandedEntries": 50
}
```

| JSON key                           | Default     | Allowed values / purpose                                      |
| ---------------------------------- | ----------- | ------------------------------------------------------------- |
| `asciiHeaderEnabled`               | `true`      | Boolean: show the ASCII header                                |
| `asciiHeaderFont`                  | `"Greek"`   | Font name from the list below                                 |
| `asciiHeaderColor`                 | `"text"`    | `"text"`, `"accent"`, `"dim"`                                 |
| `asciiHeaderAlign`                 | `"center"`  | `"left"`, `"center"`, `"right"`                               |
| `asciiHeaderShowVersion`           | `true`      | Boolean: show the pi version below the header                 |
| `workingIndicatorShowInterruptMsg` | `true`      | Boolean: show "esc to interrupt"                              |
| `workingIndicatorShowDuration`     | `true`      | Boolean: show elapsed time and completion duration            |
| `patchCustomTools`                 | `true`      | Boolean: compact eligible extension tools, including Codemode |
| `capitalizeToolNames`              | `true`      | Boolean: capitalize headers drawn by this extension           |
| `indicatorStyle`                   | `"circle"`  | `"dot"`, `"circle"`, `"diamond"`                              |
| `indicatorColor`                   | `"success"` | `"success"`, `"text"`, `"toolTitle"`                          |
| `maxExpandedEntries`               | `20`        | `-1`, `10`, `20`, `50`, `100`; `-1` means unlimited           |
| `collapsedOutputDisplay`           | `"preview"` | `"preview"`, `"summary"`                                      |
| `showExpansionHint`                | `true`      | Boolean: show expand/collapse keybinding hints                |
| `roundedEditorColor`               | `"dim"`     | `"thinking"`, `"dim"`, `"muted"`                              |
| `roundedEditorShowThinkingLevel`   | `true`      | Boolean: show the thinking level                              |
| `roundedEditorShowCacheTokens`     | `false`     | Boolean: show cache read/write token counts                   |
| `roundedEditorShowCost`            | `false`     | Boolean: show total session cost                              |
| `roundedEditorShowBranch`          | `true`      | Boolean: show the git branch                                  |

Bundled fonts: `Greek`, `Greek Large`.

Figlet fonts: `3D-ASCII`, `Alligator`, `ANSI Compact`, `Classy`, `Coder Mini`, `Crazy`, `Delta Corps Priest 1`, `Future`, `Future Smooth`, `Georgia11`, `Italic`, `Jazmine`, `Larry 3D`, `Poison`, `Rebel`, `Slant`, `Tmplr`, `Trek`, `Univers`.

## Built-in tool display

The extension changes how read, write, edit, bash, ls, find, and grep look. Pi still runs the original tools and controls their arguments, source information, and availability. Your `defaultTools` setting and CLI options decide which tools are active; this extension does not enable them.

Tool calls and output fit the available terminal width and adjust when you resize it.

Expanded Bash and Write show their full content. Expanded list tools show the beginning and end of a list, with an omission marker between them. `maxExpandedEntries` controls that limit and also applies to generic custom-tool results.

Unfinished indicators in expanded Bash, Write, and wrapped Codemode blink in fullscreen mode. In regular mode they stay dim and still, avoiding repeated redraws of terminal scrollback. Completed indicators stay still in both modes. These mode rules apply only to expanded calls, and work even when the rounded editor is disabled.

Bash duration is measured from execution events. Small extension-only records in the session file keep those durations available when you reopen a session or Pi rebuilds the conversation display. These records are not sent to the model and do not change tool results. Saved results with `details.durationMs` also remain supported.

## Collapsed Bash and Codemode output

`collapsedOutputDisplay` has two options:

- `preview`: Show up to three output lines. For longer output, show the first line, an omission marker, and the last line. Long lines are shortened to fit the terminal.
- `summary`: Hide ordinary output and show its line count below the tool call.

This setting applies to Codemode while `patchCustomTools` is enabled. Failed Codemode scripts still show a short error message in either mode.

## Codemode display

With `patchCustomTools` enabled, collapsed Codemode shows a syntax-highlighted script preview and a count of nested tool calls. Below the output, it shows running, failed, and cancelled call counts when available, along with duration, available model-call costs, and hints for expanding the display.

The live timer starts when script execution is observed. Pi's reported wall time supplies the final duration when available. Saved results without timing information do not get an estimated duration.

Expanding Codemode shows Pi's script display, nested-call details, and all returned output, followed by the extension's summary line. `maxExpandedEntries` does not limit Codemode output. Costs can appear both in Pi's nested-call details and in the extension's summary.

Links to full output files remain visible in both preview and summary mode, as do warnings about failed saves. Expanding the display does not read those files or restore output that Pi omitted. Pi handles image display.

## Custom-tool display

A tool-call block is the part of the conversation showing one tool's header, arguments, and output. It can span several terminal lines.

`patchCustomTools` controls compact display for eligible extension tools, including Codemode. Turning it off uses their normal display. This setting does not affect the seven built-in tool displays.

Pi checks this setting when it creates or rebuilds a tool-call block. Existing component instances keep their layout and drawing functions. After editing the configuration, run `/reload` so new or rebuilt blocks use the updated settings.

If a custom tool has a working `renderCall()` function, the extension keeps its header wording. If that function is missing or fails, the extension builds a simple header using the tool identifier, such as `web_search`. A separate display label such as "Web Search" is not available through Pi's public renderer API.

Tools that provide their own layout with `renderShell: "self"` keep that layout and their own labels.

## Tool-name capitalization

`capitalizeToolNames` applies to headers drawn by this extension: Read, Write, Edit, Bash, Ls, Find, Grep, and wrapped Codemode or third-party tools.

It defaults to `true` and capitalizes the first visible character, for example `read` becomes `Read` and `mcp` becomes `Mcp`. Turning it off preserves the original spelling; it does not force lowercase. Tools that draw their own layout keep their own capitalization.

This setting changes only the displayed header. Tool identifiers, arguments, resource tags such as `[skill]`, output text, and Pi's nested-call details stay unchanged.

## Compatibility with other extensions

Tool display uses Pi's public `registerToolRenderer()` API. The extension does not monkey-patch Pi's methods or prototypes, or replace tool registrations. Pi continues to load its own Codemode extension without replacement warnings or built-in configuration changes.

The extension uses `getAllTools()` to identify built-in tools from their source information. A third-party tool named `codemode` gets ordinary custom-tool treatment. If source information is unavailable, the extension leaves the tool's display unchanged.

Pi checks renderer overrides in extension load order. This extension consults the next renderer in the chain once per tool lookup. If reading tool or renderer information fails, it leaves that renderer unchanged. If a custom renderer fails while drawing, it uses a simple fallback display. Each problem is reported once per tool and failure type until session cleanup.

Each loaded copy of this extension tracks and cleans up its own custom-tool timers.

## Editor and footer compatibility

Pi allows one custom editor and one custom footer at a time. Extensions cannot automatically combine their editors or footers.

This extension installs a `CustomEditor` subclass for each terminal session. Its footer shows extension-provided status messages that are not already in the editor border.

On shutdown, it restores the previous editor only if its rounded editor is still active. An editor installed later by another extension is left alone. Editor selection follows extension load order, including after `/reload`.

If another extension replaces the footer, Pi disposes this extension's footer. During shutdown, this extension clears the footer only if it still owns it.

## License

MIT
