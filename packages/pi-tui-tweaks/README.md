# @blazer2k/pi-tui-tweaks

Compact tool output and configurable styling for [Pi's interactive TUI](https://pi.dev).

**Current version:** 0.1.0

## Overview

This extension adds:

- A compact or enlarged Pi logo at session start, with the version below it. You can also keep Pi's own header or hide the header content.
- Native, compact, or rounded editor styles. The custom styles show the working directory, git branch, model, token usage, and context percentage in their borders.
- A choice of Pi's embedded Working indicator or a separate shimmer label in compact and rounded styles.
- Compact tool output with tree-style lines and clickable paths when your terminal supports them. This also works with eligible third-party tools.
- Optional capitalization of tool headers, enabled by default.

![Example: compact tool output](images/example.webp)

![Example: rounded editor border with working indicator](images/editor.webp)

## Installation

```bash
pi install npm:@blazer2k/pi-tui-tweaks
```

For local development:

```bash
git clone https://github.com/blazer2k/pi-blz.git
cd pi-blz
npm install
pi -e ./packages/pi-tui-tweaks/index.ts
```

The entry point is the package-root `index.ts`. Update any Pi extension paths or enable/disable filters that still reference this package's previous `src/index.ts` entry.

## Settings

Edit `~/.pi/agent/pi-tui-tweaks.json`, then run `/reload` in pi. Changes are loaded at startup or on reload, not when the file is edited. This extension does not add a settings command.

Only the new filename, environment variable, and nested format are supported. The previous `ui-settings.json` is left untouched and ignored; nothing is migrated automatically. Configure the new file before reloading.

The file is created with defaults when the extension loads. Missing keys are filled in, and invalid values fall back to their defaults. Use JSON booleans and numbers, not quoted strings. Use `PI_TUI_TWEAKS_CONFIG_PATH` to choose a different settings file.

For example:

```json
{
  "header": {
    "style": "compact",
    "align": "left"
  },
  "workingIndicator": {
    "style": "native",
    "showInterruptHint": true,
    "showDuration": true
  },
  "tools": {
    "enhanceCustomTools": true,
    "capitalizeNames": true,
    "indicator": {
      "style": "circle",
      "color": "success"
    },
    "maxExpandedEntries": 20,
    "collapsedOutputDisplay": "preview",
    "showExpansionHint": true
  },
  "editor": {
    "style": "rounded",
    "color": "dim",
    "showThinkingLevel": true,
    "showCacheTokens": false,
    "showCost": true,
    "showBranch": true
  }
}
```

The table uses dotted paths for the nested JSON fields:

| JSON path                            | Default     | Allowed values / purpose                              |
| ------------------------------------ | ----------- | ----------------------------------------------------- |
| `header.style`                       | `"compact"` | `"native"`, `"compact"`, `"large"`, `"off"`           |
| `header.align`                       | `"left"`    | `"left"`, `"center"`; custom headers only             |
| `workingIndicator.style`             | `"shimmer"` | `"native"`, `"shimmer"`; custom editors only          |
| `workingIndicator.showInterruptHint` | `true`      | Show the interrupt hint; shimmer only                 |
| `workingIndicator.showDuration`      | `true`      | Show elapsed and completion time; shimmer only        |
| `tools.enhanceCustomTools`           | `true`      | Compact eligible extension tools, including Codemode  |
| `tools.capitalizeNames`              | `true`      | Capitalize headers drawn by this extension            |
| `tools.indicator.style`              | `"circle"`  | `"dot"`, `"circle"`, `"diamond"`                      |
| `tools.indicator.color`              | `"success"` | `"success"`, `"text"`, `"toolTitle"`                  |
| `tools.maxExpandedEntries`           | `20`        | `-1`, `10`, `20`, `50`, `100`; `-1` means unlimited   |
| `tools.collapsedOutputDisplay`       | `"preview"` | `"preview"`, `"summary"`                              |
| `tools.showExpansionHint`            | `true`      | Show expand/collapse keybinding hints                 |
| `editor.style`                       | `"rounded"` | `"native"`, `"compact"`, `"rounded"`                  |
| `editor.color`                       | `"dim"`     | `"thinking"`, `"dim"`, `"muted"`; custom editors only |
| `editor.showThinkingLevel`           | `true`      | Show the thinking level in custom editors             |
| `editor.showCacheTokens`             | `false`     | Show cache read/write tokens in custom editors        |
| `editor.showCost`                    | `true`      | Show total session cost in custom editors             |
| `editor.showBranch`                  | `true`      | Show the git branch in custom editors                 |

## Header

| `header.style` | Display                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `native`       | Pi's own startup header and hints, as configured in Pi. This extension leaves it untouched.             |
| `compact`      | Native-size logo, four columns wide and two lines tall, with the version below it and no startup hints. |
| `large`        | Enlarged logo, eight columns wide and four lines tall, with the version below it and no startup hints.  |
| `off`          | No header content. Pi's startup warnings and resource notices are unchanged.                            |

Custom headers respect Pi's `quietStartup` setting: `false` and `"header"` show the logo; `true` hides it unless you pass `--verbose`. Our `header.style: "off"` stays hidden even with `--verbose`, and `native` leaves this behavior to Pi.

`header.align` supports `left` and `center`. It applies to `compact` and `large`, including their Apple Terminal fallback. It has no effect in `native` or `off`.

The logo uses Pi's coral, blue, and yellow colors in the terminal's color mode. In Apple Terminal, both custom modes show a colored `Pi` wordmark instead. The version remains below it.

## Editor

| `editor.style` | Display                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `native`       | Pi's untouched editor, native footer, and Working indicator embedded in the upper rule.                                  |
| `compact`      | Two horizontal rules with our metadata, no corners or side borders, and centered `↑ N more` / `↓ N more` scroll notices. |
| `rounded`      | Rounded borders with our metadata and scroll arrows on the right edge.                                                   |

In compact and rounded styles, the working directory and optional branch sit in the upper rule. The lower rule shows the model and optional thinking level on the left, with token usage, optional cost, and context usage on the right. Compact keeps native input layout and places autocomplete below the lower rule.

`editor.color` and the `editor.show*` settings apply only to compact and rounded. The default color is `dim`; `thinking` follows Pi's thinking-level colors. Shell input uses Pi's Bash-mode color. High context usage retains warning and error colors.

Compact and rounded use a footer for extension status messages. Native leaves both Working and footer status messages to Pi.

## Working indicator

`workingIndicator.style` applies only to compact and rounded editors:

- `shimmer` (default): The current standalone animated "Working" label, with optional elapsed time, interrupt hint, and completion duration. `workingIndicator.showInterruptHint` and `workingIndicator.showDuration` apply only to this style.
- `native`: Pi's own indicator in the top border, with status on the left and directory/branch on the right. Pi manages its animation, lifecycle, retry, compaction, and branch-summary statuses. Narrow layouts shorten metadata or show only the spinner; compact scroll counts remain centered when space allows.

With `editor.style: "native"`, this setting and the shimmer options are ignored. Pi's editor and indicator remain untouched. Change styles through the settings file and `/reload`.

## Built-in tool display

The extension changes how read, write, edit, bash, ls, find, and grep look. Pi still runs the original tools and controls their arguments, source information, and availability. Your `defaultTools` setting and CLI options decide which tools are active; this extension does not enable them.

Tool calls and output fit the available terminal width and adjust when you resize it. They follow Pi's `outputPad` setting, including changes made during a session.

Expanded Bash and Write show their full content. Expanded list tools show the beginning and end of a list, with an omission marker between them. `tools.maxExpandedEntries` controls that limit and also applies to generic custom-tool results.

Unfinished indicators in expanded Bash, Write, and wrapped Codemode blink in fullscreen mode. In regular mode they stay dim and still, avoiding repeated redraws of terminal scrollback. Completed indicators stay still in both modes. These mode rules apply only to expanded calls and work with every editor style.

Running Bash calls show elapsed time. Completed calls use Pi's recorded duration, including when you reopen a session. Older results without a recorded duration show no timing label. Pi's HTML export shows the command and output without a duration label.

## Collapsed Bash and Codemode output

`tools.collapsedOutputDisplay` has two options:

- `preview`: Show up to three output lines. For longer output, show the first line, an omission marker, and the last line. Long lines are shortened to fit the terminal.
- `summary`: Hide ordinary output and show its line count below the tool call.

This setting applies to Codemode while `tools.enhanceCustomTools` is enabled. Failed Codemode scripts still show a short error message in either mode.

## Codemode display

With `tools.enhanceCustomTools` enabled, collapsed Codemode shows a syntax-highlighted script preview and a count of nested tool calls. Below the output, it shows running, failed, and cancelled call counts when available, along with duration, available model-call costs, and hints for expanding the display.

The live timer starts when script execution is observed. Pi's reported wall time supplies the final duration when available. Saved results without timing information do not get an estimated duration.

Expanding Codemode shows Pi's script display, nested-call details, and all returned output, followed by the extension's summary line. `tools.maxExpandedEntries` does not limit Codemode output. Costs can appear both in Pi's nested-call details and in the extension's summary.

Links to full output files remain visible in both preview and summary mode, as do warnings about failed saves. Expanding the display does not read those files or restore output that Pi omitted. Pi handles image display.

## Custom-tool display

A tool-call block is the part of the conversation showing one tool's header, arguments, and output. It can span several terminal lines.

`tools.enhanceCustomTools` controls compact display for eligible extension tools, including Codemode. Turning it off uses their normal display. This setting does not affect the seven built-in tool displays.

Pi checks this setting when it creates or rebuilds a tool-call block. Existing component instances keep their layout and drawing functions. After editing the configuration, run `/reload` so new or rebuilt blocks use the updated settings.

If a custom tool has a working `renderCall()` function, the extension keeps its header wording. If that function is missing or fails, the extension builds a simple header using the tool identifier, such as `web_search`. A separate display label such as "Web Search" is not available through Pi's public renderer API.

Tools that provide their own layout with `renderShell: "self"` keep that layout and their own labels.

## Tool-name capitalization

`tools.capitalizeNames` applies to headers drawn by this extension: Read, Write, Edit, Bash, Ls, Find, Grep, and wrapped Codemode or third-party tools.

It defaults to `true` and capitalizes the first visible character, for example `read` becomes `Read` and `mcp` becomes `Mcp`. Turning it off preserves the original spelling; it does not force lowercase. Tools that draw their own layout keep their own capitalization.

This setting changes only the displayed header. Tool identifiers, arguments, resource tags such as `[skill]`, output text, and Pi's nested-call details stay unchanged.

## Compatibility with other extensions

Tool display uses Pi's public `registerToolRenderer()` API. The extension does not monkey-patch Pi's methods or prototypes, or replace tool registrations. Pi continues to load its own Codemode extension without replacement warnings or built-in configuration changes.

The extension uses `getAllTools()` to identify built-in tools from their source information. A third-party tool named `codemode` gets ordinary custom-tool treatment. If source information is unavailable, the extension leaves the tool's display unchanged.

Pi checks renderer overrides in extension load order. This extension consults the next renderer in the chain once per tool lookup. If reading tool or renderer information fails, it leaves that renderer unchanged. If a custom renderer fails while drawing, it uses a simple fallback display. Each problem is reported once per tool and failure type until session cleanup.

Each loaded copy of this extension tracks and cleans up its own custom-tool timers.

## Editor and footer compatibility

Pi allows one custom editor and one custom footer at a time. Extensions cannot automatically combine their editors or footers.

In compact and rounded styles, this extension installs a `CustomEditor` subclass. Its footer shows extension-provided status messages. Native does not replace the editor or footer.

On shutdown, it restores the previous editor only if its custom editor is still active. An editor installed later by another extension is left alone. Editor selection follows extension load order, including after `/reload`.

If another extension replaces the footer, Pi disposes this extension's footer. During shutdown, this extension clears the footer only if it still owns it.

## License

MIT
