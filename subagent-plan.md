# Subagent Installer (fork of vercel-labs/skills)

## Context

You forked `vercel-labs/skills` to build the same UX, but for **subagents** instead of skills. A skill is a reusable prompt/instruction bundle (`SKILL.md`); a subagent is a named, isolated agent persona (also a Markdown file with YAML frontmatter, but with different semantics — `tools`, `model`, `mode`, etc.). Each target tool stores subagents in its own directory (`.claude/agents/`, `.factory/droids/`, `.codex/agents/`, `.opencode/agents/`, `.cursor/agents/`, …) at both project and user scope.

The fork should keep the entire installer pipeline (git clone, lock files, search-multiselect TUI, source parsing, project/global scoping) and swap the *content unit* from skills to subagents.

### Key research findings

**There is no formal open standard for subagents** equivalent to SKILL.md. There is a strong *de facto* convention that all major tools have converged on:

- A single Markdown file per subagent
- YAML frontmatter with `name`, `description`, optional `tools`, `model`, `mode`, sometimes `reasoningEffort`/`permissionMode`/`readonly`
- Body of the file = system prompt for the agent

Differences between tools are mostly in:
- **Frontmatter keys** — Claude/Codex/OpenCode use `tools: [Read, Write]`; Factory accepts `tools: read-only` or an array; Cursor adds `readonly`, `is_background`; OpenCode adds `mode: subagent`
- **Install path** — see table below
- **Tool-name vocabulary** — Claude tool names ≠ Codex tool names

**Per-agent install paths** (project / global):

| Agent           | Project              | Global                                   |
| --------------- | -------------------- | ---------------------------------------- |
| Claude Code     | `.claude/agents/`    | `~/.claude/agents/`                      |
| Factory (Droid) | `.factory/droids/`   | `~/.factory/droids/`                     |
| Codex CLI       | `.codex/agents/`     | `~/.codex/agents/`                       |
| OpenCode        | `.opencode/agents/`  | `~/.config/opencode/agents/`             |
| Cursor          | `.cursor/agents/`    | `~/.cursor/agents/`                      |
| Amp / universal | `.agents/agents/`    | `~/.config/agents/agents/` (or `.agents/agents/`) |

(These mirror the existing `skillsDir` / `globalSkillsDir` pattern in `src/agents.ts`. Many of the 50+ agents currently supported for skills do **not** have a documented subagent path — those should be dropped from the initial agent registry rather than guessed.)

**Existing prior art** (none of these match the target UX):
- `iannuttall/droid-factory` — interactive Factory-only droid installer (`npx droid-factory`); single-agent, bundled templates + marketplace
- `microsoft/apm` — generic Agent Package Manager with marketplaces; broader scope, different UX
- `agentregistry-dev/agentregistry` — multi-artifact registry (MCP + skills + agents)
- `VoltAgent/awesome-claude-code-subagents` (100+) and `VoltAgent/awesome-codex-subagents` (130+) — content collections, no installer
- `ayush-that/sub-agents.directory` — curated directory, no installer

**Conclusion:** No one has built a Vercel-skills-style cross-agent subagent installer. This is a real gap.

## Design

### Naming & versioning

- Rename the package `subagents` (binaries `subagents` and `add-subagent`); bump to `0.1.0`
- Replace `skills`/`skill` terminology throughout (`SKILL.md` → `AGENT.md`, `discoverSkills()` → `discoverSubagents()`, etc.)
- Keep the same source URL formats (GitHub shorthand, full URLs, local paths)

### The "open subagent definition"

Adopt the **Claude Code frontmatter as the canonical authoring format** (it is the most widely adopted, and Codex/OpenCode/Cursor/Factory all accept variations of it). A canonical subagent file looks like:

```markdown
---
name: code-reviewer
description: Reviews diffs for correctness and risks
tools: [Read, Grep, Glob, Bash]
model: inherit
---

You are a focused code reviewer. …
```

Discovery scans for `*.md` files containing this frontmatter (rather than a fixed filename like `SKILL.md`), because subagent collections in the wild already use the agent's own name as the filename (`code-reviewer.md`).

### Per-target translation (Phase 2, not initial)

Different targets accept slightly different frontmatter. For v1, **install the canonical file as-is** to each target directory — all tools tolerate unknown frontmatter keys. Add a per-target frontmatter transformer later (`src/transformers/{claude,factory,codex,opencode,cursor}.ts`) only if real-world testing surfaces breakage. Document this limitation clearly in the README.

### File-level changes

Most files mirror the existing skills pipeline 1:1. The list below is the work, not a re-explanation of what already exists.

**`src/agents.ts`** — replace the `agents` Record. New `AgentConfig` fields: `agentsDir` (project), `globalAgentsDir` (global). Drop `skillsDir`/`globalSkillsDir`. Initial registry: `claude-code`, `factory` (droid), `codex`, `opencode`, `cursor`, `amp`. Drop the 40+ skills-only entries that have no documented subagent path.

**`src/types.ts`** — update `AgentType` union and `AgentConfig` interface; add `Subagent` type (replaces `Skill`).

**`src/skills.ts` → `src/subagents.ts`** — rewrite `discoverSkills()` to `discoverSubagents()`. Discovery rule: any `*.md` file under common subagent dirs (`agents/`, `subagents/`, `droids/`, repo root) that has YAML frontmatter with `name` + `description`. Honor `internal: true` skip rule.

**`src/installer.ts`** — generalize `getAgentBaseDir()` to use `agentsDir`/`globalAgentsDir`. Symlink/copy logic is unchanged; targets are now files, not folders. Keep `--copy` flag because Factory's CLI re-reads files on every menu open (symlinks fine) but some Windows shells trip on symlinks.

**`src/cli.ts`** — same command surface (`add`, `list`, `find`, `remove`, `update`, `init`, `experimental_install`). Update `init` to scaffold `AGENT.md` instead of `SKILL.md`.

**`src/skill-lock.ts` → `src/subagent-lock.ts`** and **`src/local-lock.ts`** — rename fields (`skillFolderHash` → `subagentFileHash`, `skillPath` → `subagentPath`). Hash is per-file (subagents are single files), not per-folder.

**`src/providers/wellknown.ts`** — clear the well-known list; seed with one or two known good subagent collections (e.g., `VoltAgent/awesome-claude-code-subagents` aliased as `awesome-subagents`).

**`bin/cli.mjs`, `package.json`** — rename binaries, update `keywords`, update `repository`/`homepage` URLs (or remove if not yet decided).

**`tests/`** — port each existing test file to subagent semantics. The test patterns (vitest, fixture repos, mocked `simple-git`) all carry over. Add new tests:
- `agents-paths.test.ts` — verify each target's project/global path resolves correctly
- `subagent-discovery.test.ts` — verify `*.md` + frontmatter discovery (vs. `SKILL.md`)

**`README.md`, `AGENTS.md`** — rewrite for subagents. Document the canonical frontmatter and that the file is installed as-is to each target.

### Files to reuse without changes

- `src/git.ts` — git clone, auth tokens, LFS-disable
- `src/prompts/search-multiselect.ts` — TUI multiselect
- `src/source-parser.ts` — URL/path parsing
- `build.config.mjs`, `tsconfig.json`, `scripts/generate-licenses.ts`
- `scripts/sync-agents.ts` (may need minor README-template tweaks for new agent count)

### What not to build for v1

- Per-target frontmatter transformers (revisit after dogfooding)
- A custom registry server (ride on GitHub like skills does)
- A lock-file format change (v1 of local-lock; cosmetic field renames only)
- Plugin-manifest discovery (Claude `.claude-plugin/marketplace.json`) — only if subagent-marketplace manifests emerge in the wild

## Verification

1. `pnpm build && pnpm test` passes
2. End-to-end smoke test against a real repo (e.g., `VoltAgent/awesome-claude-code-subagents`):
   - `node dist/cli.mjs add VoltAgent/awesome-claude-code-subagents -a claude-code` → file lands at `.claude/agents/<name>.md`
   - `node dist/cli.mjs add VoltAgent/awesome-claude-code-subagents -a factory -g` → file lands at `~/.factory/droids/<name>.md`
   - `node dist/cli.mjs list` → shows installed subagents grouped by agent
   - `node dist/cli.mjs remove <name>` → removes file + lock entry
   - `node dist/cli.mjs update` → no-op when up to date; reinstalls when source SHA changes
3. Open Claude Code in a project with an installed subagent; confirm it appears in the agents list and can be invoked.
4. Repeat (3) in Factory CLI with `enableCustomDroids: true` set.

## Decisions (locked)

- **Agent registry, v1:** Core 6 only — `claude-code`, `factory`, `codex`, `opencode`, `cursor`, `amp`. Drop the other 40+ skills entries. Add more only when their subagent path is documented upstream.
- **Translation:** Install **verbatim**. Authoring format = Claude-style frontmatter. No per-target transformer in v1; revisit only if a target rejects a real subagent.
- **File extension:** `.md` — install as-is, no rename.

## Open question still pending

- npm package name (`subagents` may be taken). Decide before `pnpm publish`. Not blocking for build.
