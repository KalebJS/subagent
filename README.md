# get-subagents

A CLI for installing cross-agent subagent definitions from git repos, URLs, or local paths into target agent directories.

<!-- agent-list:start -->
Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [2 more](#supported-agents).
<!-- agent-list:end -->

## Install a Subagent

```bash
npx @superkut/get-subagents add VoltAgent/awesome-claude-code-subagents
```

### Source Formats

```bash
# GitHub shorthand (owner/repo)
npx @superkut/get-subagents add VoltAgent/awesome-claude-code-subagents

# Full GitHub URL
npx @superkut/get-subagents add https://github.com/VoltAgent/awesome-claude-code-subagents

# Direct path to a subagent in a repo
npx @superkut/get-subagents add https://github.com/owner/repo/tree/main/agents/my-subagent

# GitLab URL
npx @superkut/get-subagents add https://gitlab.com/org/repo

# Any git URL
npx @superkut/get-subagents add git@github.com:owner/repo.git

# Local path
npx @superkut/get-subagents add ./my-local-subagents

# Install a specific subagent by name
npx @superkut/get-subagents add owner/repo@subagent-name
```

### Options

| Option                    | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | Install to user directory instead of project                                                                                                       |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Supported Agents](#supported-agents)<!-- agent-names:end --> |
| `-s, --skill <names...>`  | Install specific subagents by name (use `'*'` for all)                                                                                             |
| `-l, --list`              | List available subagents without installing                                                                                                         |
| `--copy`                  | Copy files instead of symlinking to agent directories                                                                                              |
| `-y, --yes`               | Skip all confirmation prompts                                                                                                                      |
| `--all`                   | Install all subagents to all agents without prompts                                                                                                   |

### Examples

```bash
# List subagents in a repository
npx get-subagents add VoltAgent/awesome-claude-code-subagents --list

# Install specific subagents
npx get-subagents add owner/repo --skill code-reviewer --skill test-runner

# Install to specific agents
npx get-subagents add owner/repo -a claude-code -a opencode

# Non-interactive installation (CI/CD friendly)
npx get-subagents add owner/repo --skill code-reviewer -g -a claude-code -y

# Install all subagents from a repo to all agents
npx get-subagents add owner/repo --all

# Install all subagents to specific agents
npx get-subagents add owner/repo --skill '*' -a claude-code

# Install specific subagents to all agents
npx get-subagents add owner/repo --agent '*' --skill code-reviewer
```

### Installation Scope

| Scope       | Flag      | Location             | Use Case                                      |
| ----------- | --------- | -------------------- | --------------------------------------------- |
| **Project** | (default) | `./<agent>/agents/`  | Committed with your project, shared with team |
| **Global**  | `-g`      | `~/<agent>/agents/`  | Available across all projects                 |

### Installation Methods

When installing interactively, you can choose:

| Method                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| **Symlink** (Recommended) | Creates symlinks from each agent to a canonical copy. Single source of truth, easy updates. |
| **Copy**                  | Creates independent copies for each agent. Use when symlinks aren't supported.              |

## Other Commands

| Command                      | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `npx @superkut/get-subagents list`         | List installed subagents (alias: `ls`)             |
| `npx @superkut/get-subagents find [query]` | Search for subagents interactively or by keyword |
| `npx @superkut/get-subagents remove [name]` | Remove installed subagents from agents           |
| `npx @superkut/get-subagents update [names]` | Update installed subagents to latest versions    |
| `npx @superkut/get-subagents init [name]` | Create a new AGENT.md template                    |

### `get-subagents list`

List all installed subagents. Similar to `npm ls`.

```bash
# List all installed subagents (project and global)
npx get-subagents list

# List only global subagents
npx get-subagents ls -g

# Filter by specific agents
npx get-subagents ls -a claude-code -a cursor
```

### `get-subagents find`

Search for subagents interactively or by keyword.

```bash
# Interactive search (fzf-style)
npx get-subagents find

# Search by keyword
npx get-subagents find typescript
```

### `get-subagents update`

```bash
# Update all subagents (interactive scope prompt)
npx get-subagents update

# Update a single subagent by name
npx get-subagents update my-subagent

# Update multiple specific subagents
npx get-subagents update code-reviewer test-runner

# Update only global or project subagents
npx get-subagents update -g
npx get-subagents update -p

# Non-interactive (auto-detects scope: project if in a project, else global)
npx get-subagents update -y
```

| Option          | Description                                                               |
| --------------- | ------------------------------------------------------------------------- |
| `-g, --global`  | Only update global subagents                                              |
| `-p, --project` | Only update project subagents                                             |
| `-y, --yes`     | Skip scope prompt (auto-detect: project if in a project dir, else global) |
| `[names...]`    | Update specific subagents by name instead of all                           |

### `get-subagents init`

```bash
# Create AGENT.md in current directory
npx get-subagents init

# Create a new subagent in a subdirectory
npx get-subagents init my-subagent
```

### `get-subagents remove`

Remove installed subagents from agents.

```bash
# Remove interactively (select from installed subagents)
npx get-subagents remove

# Remove specific subagent by name
npx get-subagents remove my-subagent

# Remove multiple subagents
npx get-subagents remove code-reviewer test-runner

# Remove from global scope
npx get-subagents remove --global my-subagent

# Remove from specific agents only
npx get-subagents remove --agent claude-code cursor my-subagent

# Remove all installed subagents without confirmation
npx get-subagents remove --all

# Remove all subagents from a specific agent
npx get-subagents remove --skill '*' -a cursor

# Remove a specific subagent from all agents
npx get-subagents remove my-subagent --agent '*'

# Use 'rm' alias
npx get-subagents rm my-subagent
```

| Option         | Description                                      |
| -------------- | ------------------------------------------------ |
| `-g, --global` | Remove from global scope (~/) instead of project |
| `-a, --agent`  | Remove from specific agents (use `'*'` for all)  |
| `-s, --skill`  | Specify subagents to remove (use `'*'` for all)   |
| `-y, --yes`    | Skip confirmation prompts                        |
| `--all`        | Shorthand for `--skill '*' --agent '*' -y`       |

## What are Subagents?

Subagents are named, isolated agent personas defined in single Markdown files with YAML frontmatter. Each file contains a `name` and `description` (required), plus optional fields like `tools`, `model`, and `mode`. The body of the file is the agent's system prompt.

```markdown
---
name: code-reviewer
description: Reviews diffs for correctness and risks
tools: [Read, Grep, Glob, Bash]
model: inherit
---

You are a focused code reviewer. …
```

Subagents are installed **verbatim** to each target agent's directory — no per-target frontmatter translation in v1.

### Subagent Discovery

The CLI discovers subagents by scanning for `*.md` files with `name` + `description` YAML frontmatter. It searches these locations within a repository:

<!-- subagent-discovery:start -->
- Root directory (any `.md` file with valid frontmatter)
- `agents/`
- `subagents/`
- `droids/`
- `.agents/agents/`
- `.claude/agents/`
- `.codex/agents/`
- `.cursor/agents/`
- `.factory/droids/`
- `.opencode/agents/`
<!-- subagent-discovery:end -->

If no subagents are found in standard locations, a recursive search is performed.

## Supported Agents

Subagents can be installed to any of these agents:

<!-- supported-agents:start -->
| Agent | `--agent` | Project Path | Global Path |
|-------|-----------|--------------|-------------|
| Amp | `amp` | `.agents/agents/` | `~/.config/agents/agents/` |
| Claude Code | `claude-code` | `.claude/agents/` | `~/.claude/agents/` |
| Codex | `codex` | `.codex/agents/` | `~/.codex/agents/` |
| Cursor | `cursor` | `.cursor/agents/` | `~/.cursor/agents/` |
| Factory (Droid) | `factory` | `.factory/droids/` | `~/.factory/droids/` |
| OpenCode | `opencode` | `.opencode/agents/` | `~/.config/opencode/agents/` |
<!-- supported-agents:end -->

The CLI automatically detects which coding agents you have installed. If none are detected, you'll be prompted to select which agents to install to.

## Creating Subagents

Subagents are Markdown files with YAML frontmatter:

```markdown
---
name: my-subagent
description: What this subagent does and when to use it
---

# My Subagent

Instructions for the agent to follow when this subagent is activated.

## When to Use

Describe the scenarios where this subagent should be used.

## Steps

1. First, do this
2. Then, do that
```

### Required Fields

- `name`: Unique identifier (lowercase, hyphens allowed)
- `description`: Brief explanation of what the subagent does

### Optional Fields

- `tools`: Array of tool names the subagent can use (e.g., `[Read, Grep, Glob, Bash]`)
- `model`: Model specification (e.g., `inherit` to use the parent agent's model)
- `mode`: Agent mode (e.g., `subagent`)
- `metadata.internal`: Set to `true` to hide the subagent from normal discovery. Internal subagents are only visible and installable when `INSTALL_INTERNAL_SKILLS=1` is set.

```markdown
---
name: my-internal-subagent
description: An internal subagent not shown by default
metadata:
  internal: true
---
```

## Troubleshooting

### "No subagents found"

Ensure the repository contains valid `.md` files with both `name` and `description` in the YAML frontmatter.

### Subagent not loading in agent

- Verify the subagent was installed to the correct path
- Check the agent's documentation for subagent/agent loading requirements
- Ensure the YAML frontmatter is valid

### Permission errors

Ensure you have write access to the target directory.

## Environment Variables

| Variable                  | Description                                                                   |
| ------------------------- | ----------------------------------------------------------------------------- |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` or `true` to show and install subagents marked as `internal: true` |
| `DISABLE_TELEMETRY`       | Set to disable anonymous usage telemetry                                      |
| `DO_NOT_TRACK`            | Alternative way to disable telemetry                                          |
| `GITHUB_TOKEN`            | GitHub API token for higher rate limits                                       |
| `GH_TOKEN`                | Alternative GitHub API token                                                  |

```bash
# Install internal subagents
INSTALL_INTERNAL_SKILLS=1 npx @superkut/get-subagents add owner/repo --list

# Use a GitHub token for higher rate limits
GITHUB_TOKEN=ghp_xxx npx @superkut/get-subagents add owner/repo
```

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

Telemetry is automatically disabled in CI environments.

## Related Links

- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) — curated collection of Claude Code subagents
- [VoltAgent/awesome-codex-subagents](https://github.com/VoltAgent/awesome-codex-subagents) — curated collection of Codex subagents

## License

MIT
