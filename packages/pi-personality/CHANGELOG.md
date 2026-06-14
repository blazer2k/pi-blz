# Changelog

## [0.1.1] – 2026-06-14

### Fixed

- **Teacher personality** – narrowed teaching skip conditions to simple facts and explicit answers only, with positive guidance on when to teach during implementation work

## [0.1.0] – 2026-06-12

### Added

- **`/personality` command** – TUI selector to switch communication styles at runtime
- **Three builtin personalities** – Pragmatic (from Codex CLI), Friendly (from Codex CLI), Teacher (custom)
- **Custom personality support** – Drop `.md` files with YAML frontmatter into `~/.pi/agent/personalities/`
- **Persistence** – Active personality saved to `~/.pi/agent/personality-state.json` and restored on next session
