# AGENTS.md

This file provides guidance to AI coding agents working on the `subagents` CLI codebase.

## Project Overview

`subagents` is a CLI for installing cross-agent subagent definitions from git repos, URLs, or local paths into target agent directories. Forked from `vercel-labs/skills`, the installer pipeline is intact but the content unit is now **subagents** (single `.md` files with YAML frontmatter) instead of skills (`SKILL.md` folders).

### What is a subagent?

A subagent is a single Markdown file with YAML frontmatter (`name`, `description`, optional `tools`, `model`, `mode`, etc.) whose body is the agent's system prompt. The canonical authoring format follows Claude Code conventions:

```markdown
---
name: code-reviewer
description: Reviews diffs for correctness and risks
tools: [Read, Grep, Glob, Bash]
model: inherit
---

You are a focused code reviewer. …
```

Discovery scans for any `*.md` file containing `name` + `description` frontmatter. Subagents are installed **verbatim** — no per-target frontmatter translation in v1.

## Supported Agents (v1)

| Agent           | Project Dir         | Global Dir                   |
| --------------- | ------------------- | ---------------------------- |
| Claude Code     | `.claude/agents/`   | `~/.claude/agents/`          |
| Factory (Droid) | `.factory/droids/`  | `~/.factory/droids/`         |
| Codex CLI       | `.codex/agents/`    | `~/.codex/agents/`           |
| OpenCode        | `.opencode/agents/` | `~/.config/opencode/agents/` |
| Cursor          | `.cursor/agents/`   | `~/.cursor/agents/`          |
| Amp             | `.agents/agents/`   | `~/.config/agents/agents/`   |

Only agents with documented subagent install paths are included. Adding more requires evidence of an upstream-documented path.

## Commands

| Command                          | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `subagents`                      | Show banner with available commands                    |
| `subagents add <pkg>`            | Install subagents from git repos, URLs, or local paths |
| `subagents experimental_install` | Restore subagents from subagents-lock.json             |
| `subagents experimental_sync`    | Sync subagents from node_modules into agent dirs       |
| `subagents list`                 | List installed subagents (alias: `ls`)                 |
| `subagents update [names...]`    | Update subagents to latest versions                    |
| `subagents find <query>`         | Search for subagents in remote collections             |
| `subagents remove <name>`        | Remove an installed subagent                           |
| `subagents init [name]`          | Create a new AGENT.md template                         |

Aliases: `subagents a` for `add`. `subagents i` / `subagents install` (no args) restores from `subagents-lock.json`. `subagents ls` for `list`.

## Architecture

```
src/
├── cli.ts            # Main entry point, command routing, init/check/update
├── cli.test.ts       # CLI tests
├── add.ts            # Core add command logic
├── add-prompt.test.ts  # Add prompt behavior tests
├── add.test.ts       # Add command tests
├── agents.ts         # Agent definitions (6 targets) and detection
├── blob.ts           # Blob/file fetching (GitHub raw, etc.)
├── constants.ts      # Shared constants (AGENTS_DIR, SUBAGENTS_SUBDIR, CANONICAL_SUBAGENTS_DIR)
├── find.ts           # Find/search command
├── frontmatter.ts    # YAML frontmatter parser
├── git.ts            # Git clone operations
├── init.test.ts      # Init command tests
├── installer.ts      # Subagent installation logic (symlink/copy) + listInstalledSubagents
├── install.ts        # Restore from lock file command
├── list.test.ts      # List command tests
├── list.ts           # List installed subagents command
├── local-lock.ts     # Local lock file management (subagents-lock.json, checked in)
├── plugin-manifest.ts # Plugin manifest discovery support (legacy)
├── prompts/          # Interactive prompt helpers
│   └── search-multiselect.ts
├── providers/        # Remote subagent providers (GitHub, HuggingFace, Mintlify, well-known)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   ├── mintlify.ts
│   └── wellknown.ts
├── remove.test.ts    # Remove command tests
├── remove.ts         # Remove command implementation
├── sanitize.ts       # Metadata sanitization (path traversal prevention)
├── skill-lock.ts     # Global lock file management (~/.agents/.subagent-lock.json)
├── skills.ts         # Legacy skill discovery (retained during migration)
├── source-parser.test.ts # Tests for URL/path parsing
├── source-parser.ts  # Parse git URLs, GitHub shorthand, local paths, @agent-name syntax
├── subagents.ts      # Subagent discovery and parsing (discoverSubagents, parseSubagentMd)
├── sync.ts           # Sync command — crawl node_modules for subagents
├── telemetry.ts      # Anonymous usage tracking
├── test-utils.ts     # Test utilities
├── types.ts          # TypeScript types (Subagent, AgentConfig, AgentType, RemoteSubagent, ParsedSource)
├── update-source.test.ts # Tests for update source URLs
├── update-source.ts  # Build update source URLs

tests/
├── cross-platform-paths.test.ts     # Path normalization across platforms
├── dist.test.ts                     # Tests for built distribution
├── search-dir-discovery.test.ts      # --search-dir recursive discovery tests
├── installer-copy.test.ts           # Tests for copy installation
├── installer-symlink.test.ts        # Tests for symlink installation
├── list-installed.test.ts           # Tests for listing installed subagents
├── local-lock.test.ts              # Tests for local lock file
├── openclaw-paths.test.ts           # OpenClaw-specific path tests
├── plugin-grouping.test.ts         # Plugin grouping tests
├── plugin-manifest-discovery.test.ts # Plugin manifest discovery
├── remove-canonical.test.ts        # Canonical remove tests
├── sanitize-name.test.ts           # Tests for sanitizeName (path traversal prevention)
├── sanitize-terminal.test.ts       # Tests for terminal-safe sanitization
├── search-multiselect-visual-rows.test.ts # TUI visual row tests
├── skill-matching.test.ts          # Tests for filterSubagents (multi-word name matching)
├── skill-path.test.ts              # Tests for subagent path handling
├── source-parser.test.ts           # Tests for URL/path parsing
├── subpath-traversal.test.ts       # Subpath traversal security tests
├── sync.test.ts                    # Tests for sync command
├── wellknown-provider.test.ts      # Tests for well-known provider
└── xdg-config-paths.test.ts        # XDG global path handling tests
```

### Key Terminology Mapping (skills → subagents)

| Skills (old)                  | Subagents (new)                                  |
| ----------------------------- | ------------------------------------------------ |
| `SKILL.md`                    | Any `*.md` with `name`+`description` frontmatter |
| `Skill` type                  | `Subagent` type                                  |
| `AgentConfig.skillsDir`       | `AgentConfig.agentsDir`                          |
| `AgentConfig.globalSkillsDir` | `AgentConfig.globalAgentsDir`                    |
| `discoverSkills()`            | `discoverSubagents()`                            |
| `skillFolderHash`             | `subagentFileHash` (per-file SHA-256)            |
| `skills-lock.json`            | `subagents-lock.json`                            |
| `~/.agents/.skill-lock.json`  | `~/.agents/.subagent-lock.json`                  |

## Update Checking System

### How `subagents check` and `subagents update` Work

1. Read `~/.agents/.subagent-lock.json` for installed subagents
2. Filter to GitHub-backed subagents that have both `subagentFileHash` and `subagentPath`
3. For each subagent, call `fetchSubagentFileHash(source, subagentPath, token)`. Optional auth token is sourced from `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to improve rate limits.
4. `fetchSubagentFileHash` calls GitHub Trees API directly (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback)
5. Compare latest file hash with lock file `subagentFileHash`; mismatch means update available
6. `subagents update` reinstalls changed subagents by invoking the current CLI entrypoint directly (`node <repo>/bin/cli.mjs add <source-tree-url> -g -y`) to avoid nested npm exec/npx behavior

### Lock Files

- **Global** (`~/.agents/.subagent-lock.json`): v1 format. Key field: `subagentFileHash`.
- **Local** (`subagents-lock.json`, checked in): v1 format. Key field: `computedHash` (SHA-256 of the `.md` file).

If reading an older lock file version, it's wiped. Users must reinstall subagents to populate the new format.

## Key Integration Points

| Feature                        | Implementation                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `subagents add`                | `src/add.ts` - full implementation                                                                                  |
| `subagents experimental_sync`  | `src/sync.ts` - crawl node_modules                                                                                  |
| `subagents find`               | `src/find.ts` - search remote collections                                                                           |
| `subagents check`              | `src/cli.ts` + `fetchSubagentFileHash` in `src/skill-lock.ts`                                                       |
| `subagents update`             | `src/cli.ts` direct hash compare + reinstall via `subagents add`                                                    |
| `subagents remove`             | `src/remove.ts` - removes file + lock entries                                                                       |
| Subagent discovery             | `src/subagents.ts` - `discoverSubagents()` scans `*.md` + frontmatter; supports `--search-dir` for recursive search |
| Frontmatter parsing            | `src/frontmatter.ts` + `src/sanitize.ts`                                                                            |
| Source parsing (`@agent-name`) | `src/source-parser.ts` - supports `owner/repo@agent-name` syntax                                                    |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add VoltAgent/awesome-claude-code-subagents --list
pnpm dev experimental_sync
pnpm dev check
pnpm dev update
pnpm dev init my-subagent

# Run all tests
pnpm test

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts
pnpm test tests/skill-matching.test.ts tests/source-parser.test.ts

# Type check
pnpm type-check

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm format:check
```

CI will fail if code is not properly formatted.

## Adding a New Agent

1. Add the agent definition to `src/agents.ts` with `agentsDir` (project-relative) and `globalAgentsDir` (absolute) — only add agents with an upstream-documented subagent install path
2. Add the `AgentType` union member to `src/types.ts`
3. Verify paths resolve correctly with new/updated tests
4. Update `package.json` keywords if desired

## Design Decisions (locked)

- **Agent registry, v1:** Core 6 only (`claude-code`, `factory`, `codex`, `opencode`, `cursor`, `amp`). Add more only when their subagent path is documented upstream.
- **Translation:** Install verbatim. No per-target frontmatter transformer in v1. Revisit only if a target rejects a real subagent.
- **File extension:** `.md` — installed as-is, no rename.
- **Discovery:** Priority dirs first (agents/, subagents/, droids/, .claude/agents/, etc.), then optional `--search-dir <dir>` for recursive search. Any `*.md` with `name` + `description` YAML frontmatter. Not a fixed filename like `SKILL.md`.
- **Hashing:** Per-file SHA-256 (subagents are single files), not per-folder tree SHA.
