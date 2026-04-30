#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runInstallFromLock } from './install.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { track, flushTelemetry } from './telemetry.ts';
import { fetchSkillFolderHash as fetchSubagentFileHash, getGitHubToken } from './skill-lock.ts';
import { readLocalLock, type LocalSubagentLockEntry } from './local-lock.ts';
import {
  buildUpdateInstallSource,
  buildLocalUpdateSource,
  formatSourceInput,
} from './update-source.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const LOGO_LINES = [
  '███████╗██╗   ██╗██████╗  █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗',
  '██╔════╝██║   ██║██╔══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝',
  '███████╗██║   ██║██████╔╝███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗',
  '╚════██║██║   ██║██╔══██╗██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║',
  '███████║╚██████╔╝██████╔╝██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║',
  '╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}The open subagent ecosystem${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents add ${DIM}<package>${RESET}        ${DIM}Add a new subagent${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents remove${RESET}               ${DIM}Remove installed subagents${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents list${RESET}                 ${DIM}List installed subagents${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents find ${DIM}[query]${RESET}         ${DIM}Search for subagents${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents update${RESET}               ${DIM}Update installed subagents${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents experimental_install${RESET} ${DIM}Restore from subagents-lock.json${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents init ${DIM}[name]${RESET}          ${DIM}Create a new subagent${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx get-subagents experimental_sync${RESET}    ${DIM}Sync subagents from node_modules${RESET}`
  );
  console.log();
  console.log(`${DIM}try:${RESET} npx get-subagents add VoltAgent/awesome-claude-code-subagents`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} get-subagents <command> [options]

${BOLD}Manage Subagents:${RESET}
  add <package>        Add a subagent package (alias: a)
                       e.g. VoltAgent/awesome-claude-code-subagents
                            https://github.com/VoltAgent/awesome-claude-code-subagents
  remove [subagents]   Remove installed subagents
  list, ls             List installed subagents
  find [query]         Search for subagents interactively

${BOLD}Updates:${RESET}
  update [subagents...] Update subagents to latest versions (alias: upgrade)

${BOLD}Update Options:${RESET}
  -g, --global           Update global subagents only
  -p, --project          Update project subagents only
  -y, --yes              Skip scope prompt (auto-detect: project if in a project, else global)

${BOLD}Project:${RESET}
  experimental_install Restore subagents from subagents-lock.json
  init [name]          Initialize a subagent (creates <name>.md or ./AGENT.md)
  experimental_sync    Sync subagents from node_modules into agent directories

${BOLD}Add Options:${RESET}
  -g, --global           Install subagent globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify subagent names to install (use '*' for all)
  -l, --list             List available subagents in the repository without installing
  -y, --yes              Skip confirmation prompts
  --copy                 Copy files instead of symlinking to agent directories
  --all                  Shorthand for --skill '*' --agent '*' -y
  --search-dir <dir>   Recursively search a directory for .md subagent files

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify subagents to remove (use '*' for all)
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  
${BOLD}Experimental Sync Options:${RESET}
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -y, --yes              Skip confirmation prompts

${BOLD}List Options:${RESET}
  -g, --global           List global subagents (default: project)
  -a, --agent <agents>   Filter by specific agents
  --json                 Output as JSON (machine-readable, no ANSI codes)

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} get-subagents add VoltAgent/awesome-claude-code-subagents
  ${DIM}$${RESET} get-subagents add VoltAgent/awesome-claude-code-subagents -g
  ${DIM}$${RESET} get-subagents add VoltAgent/awesome-claude-code-subagents --agent claude-code cursor
  ${DIM}$${RESET} get-subagents remove                        ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} get-subagents remove code-reviewer           ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} get-subagents rm --global my-subagent
  ${DIM}$${RESET} get-subagents list                          ${DIM}# list project subagents${RESET}
  ${DIM}$${RESET} get-subagents ls -g                         ${DIM}# list global subagents${RESET}
  ${DIM}$${RESET} get-subagents ls -a claude-code             ${DIM}# filter by agent${RESET}
  ${DIM}$${RESET} get-subagents ls --json                      ${DIM}# JSON output${RESET}
  ${DIM}$${RESET} get-subagents find                          ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} get-subagents find typescript               ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} get-subagents update
  ${DIM}$${RESET} get-subagents update my-subagent            ${DIM}# update a single subagent${RESET}
  ${DIM}$${RESET} get-subagents update -g                     ${DIM}# update global subagents only${RESET}
  ${DIM}$${RESET} get-subagents experimental_install            ${DIM}# restore from subagents-lock.json${RESET}
  ${DIM}$${RESET} get-subagents init my-subagent
  ${DIM}$${RESET} get-subagents experimental_sync              ${DIM}# sync from node_modules${RESET}
  ${DIM}$${RESET} get-subagents experimental_sync -y           ${DIM}# sync without prompts${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} get-subagents remove [subagents...] [options]

${BOLD}Description:${RESET}
  Remove installed subagents from agents. If no subagent names are provided,
  an interactive selection menu will be shown.

${BOLD}Arguments:${RESET}
  subagents          Optional subagent names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --agent        Remove from specific agents (use '*' for all agents)
  -s, --skill        Specify subagents to remove (use '*' for all)
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --agent '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} get-subagents remove                           ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} get-subagents remove my-subagent                ${DIM}# remove specific subagent${RESET}
  ${DIM}$${RESET} get-subagents remove sub1 sub2 -y               ${DIM}# remove multiple subagents${RESET}
  ${DIM}$${RESET} get-subagents remove --global my-subagent       ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} get-subagents rm --agent claude-code my-subagent ${DIM}# remove from specific agent${RESET}
  ${DIM}$${RESET} get-subagents remove --all                      ${DIM}# remove all subagents${RESET}
  ${DIM}$${RESET} get-subagents remove --skill '*' -a cursor      ${DIM}# remove all subagents from cursor${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const agentName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const agentFile = join(cwd, `${agentName}.md`);
  const displayPath = hasName ? `${agentName}.md` : 'AGENT.md';

  if (existsSync(agentFile)) {
    console.log(`${TEXT}Subagent already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  const agentContent = `---
name: ${agentName}
description: A brief description of what this subagent does
tools: [Read, Grep, Glob]
model: inherit
---

# ${agentName}

Instructions for the agent to follow when this subagent is activated.

## When to use

Describe when this subagent should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(agentFile, agentContent);

  console.log(`${TEXT}Initialized subagent: ${DIM}${agentName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  1. Edit ${TEXT}${displayPath}${RESET} to define your subagent instructions`);
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx get-subagents add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx get-subagents add https://example.com/${displayPath}${RESET}`
  );
  console.log();
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.subagent-lock.json';
const CURRENT_LOCK_VERSION = 1;

interface SubagentLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  subagentPath?: string;
  /** GitHub tree SHA or file hash for update detection */
  subagentFileHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SubagentLockFile {
  version: number;
  subagents: Record<string, SubagentLockEntry>;
}

function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'subagents', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SubagentLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SubagentLockFile;
    if (typeof parsed.version !== 'number' || !parsed.subagents) {
      return { version: CURRENT_LOCK_VERSION, subagents: {} };
    }
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, subagents: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, subagents: {} };
  }
}

// ============================================
// Scope Detection and Prompt
// ============================================

type UpdateScope = 'project' | 'global' | 'both';

interface UpdateCheckOptions {
  global?: boolean;
  project?: boolean;
  yes?: boolean;
  /** Optional skill name(s) to filter on (positional args) */
  skills?: string[];
}

function parseUpdateOptions(args: string[]): UpdateCheckOptions {
  const options: UpdateCheckOptions = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    options.skills = positional;
  }
  return options;
}

/**
 * Check whether the current working directory has project-level skills.
 * Returns true if either:
 * - skills-lock.json exists in cwd, OR
 * - .agents/skills/ contains at least one subdirectory with a SKILL.md
 */
function hasProjectSkills(cwd?: string): boolean {
  const dir = cwd || process.cwd();

  // Check 1: subagents-lock.json exists
  const lockPath = join(dir, 'subagents-lock.json');
  if (existsSync(lockPath)) {
    return true;
  }

  // Check 2: .agents/agents/ has at least one .md file
  const agentsDir = join(dir, '.agents', 'agents');
  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        return true;
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return false;
}

/**
 * Determine the update/check scope via interactive prompt or auto-detection.
 *
 * Interactive mode (default):
 *   Shows a prompt with Project / Global / Both options.
 *
 * Non-interactive mode (-y flag or non-TTY):
 *   If cwd has project-level skills → 'project'
 *   Otherwise → 'global'
 *
 * Explicit flags override everything:
 *   -g → 'global'
 *   -p → 'project'
 *   -g -p → 'both'
 */
async function resolveUpdateScope(options: UpdateCheckOptions): Promise<UpdateScope> {
  // When targeting specific skills, search both scopes to find them
  if (options.skills && options.skills.length > 0) {
    if (options.global) return 'global';
    if (options.project) return 'project';
    return 'both';
  }

  // Explicit flags take precedence
  if (options.global && options.project) {
    return 'both';
  }
  if (options.global) {
    return 'global';
  }
  if (options.project) {
    return 'project';
  }

  // Non-interactive auto-detection
  if (options.yes || !process.stdin.isTTY) {
    return hasProjectSkills() ? 'project' : 'global';
  }

  // Interactive prompt
  const scope = await p.select({
    message: 'Update scope',
    options: [
      {
        value: 'project' as UpdateScope,
        label: 'Project',
        hint: 'Update skills in current directory',
      },
      {
        value: 'global' as UpdateScope,
        label: 'Global',
        hint: 'Update skills in home directory',
      },
      {
        value: 'both' as UpdateScope,
        label: 'Both',
        hint: 'Update all skills',
      },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return scope as UpdateScope;
}

/**
 * Check if a skill name matches any of the filter names (case-insensitive).
 * Returns true if no filter is set (match all).
 */
function matchesSkillFilter(name: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const lower = name.toLowerCase();
  return filter.some((f) => f.toLowerCase() === lower);
}

interface SkippedSubagent {
  name: string;
  reason: string;
  sourceUrl: string;
  sourceType: string;
  ref?: string;
}

/**
 * Determine why a subagent cannot be checked for updates automatically.
 */
function getSkipReason(entry: SubagentLockEntry): string {
  if (entry.sourceType === 'local') {
    return 'Local path';
  }
  if (entry.sourceType === 'git') {
    return 'Git URL';
  }
  if (entry.sourceType === 'well-known') {
    return 'Well-known subagent';
  }
  if (!entry.subagentFileHash) {
    return 'Private or deleted repo';
  }
  if (!entry.subagentPath) {
    return 'No subagent path recorded';
  }
  return 'No version tracking';
}

function getInstallSource(subagent: SkippedSubagent): string {
  let url = subagent.sourceUrl;
  if (subagent.sourceType === 'well-known') {
    const idx = url.indexOf('/.well-known/');
    if (idx !== -1) {
      url = url.slice(0, idx);
    }
  }
  return formatSourceInput(url, subagent.ref);
}

/**
 * Print a list of subagents that cannot be checked automatically.
 */
function printSkippedSkills(skipped: SkippedSubagent[]): void {
  if (skipped.length === 0) return;
  console.log();
  console.log(`${DIM}${skipped.length} subagent(s) cannot be checked automatically:${RESET}`);

  const grouped = new Map<string, SkippedSubagent[]>();
  for (const sub of skipped) {
    const source = getInstallSource(sub);
    const existing = grouped.get(source) || [];
    existing.push(sub);
    grouped.set(source, existing);
  }

  for (const [source, subs] of grouped) {
    if (subs.length === 1) {
      const sub = subs[0]!;
      console.log(`  ${TEXT}•${RESET} ${sanitizeMetadata(sub.name)} ${DIM}(${sub.reason})${RESET}`);
    } else {
      const reason = subs[0]!.reason;
      const names = subs.map((s) => sanitizeMetadata(s.name)).join(', ');
      console.log(`  ${TEXT}•${RESET} ${names} ${DIM}(${reason})${RESET}`);
    }
    console.log(`    ${DIM}To update: ${TEXT}npx get-subagents add ${source} -g -y${RESET}`);
  }
}

// ============================================
// Project Skills Discovery
// ============================================

async function getProjectSkillsForUpdate(
  skillFilter?: string[]
): Promise<Array<{ name: string; source: string; entry: LocalSubagentLockEntry }>> {
  const localLock = await readLocalLock();
  const skills: Array<{ name: string; source: string; entry: LocalSubagentLockEntry }> = [];

  for (const [name, entry] of Object.entries(localLock.subagents)) {
    if (!matchesSkillFilter(name, skillFilter)) continue;
    if (entry.sourceType === 'node_modules' || entry.sourceType === 'local') {
      continue;
    }
    skills.push({ name, source: entry.source, entry });
  }

  return skills;
}

// ============================================
// Update: Global Skills
// ============================================

async function updateGlobalSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; checkedCount: number }> {
  const lock = readSkillLock();
  const subagentNames = Object.keys(lock.subagents);
  let successCount = 0;
  let failCount = 0;

  if (subagentNames.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}No global subagents tracked in lock file.${RESET}`);
      console.log(
        `${DIM}Install subagents with${RESET} ${TEXT}npx get-subagents add <package> -g${RESET}`
      );
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  const token = getGitHubToken();
  const updates: Array<{ name: string; source: string; entry: SubagentLockEntry }> = [];
  const skipped: SkippedSubagent[] = [];
  const checkable: Array<{ name: string; entry: SubagentLockEntry }> = [];

  for (const subagentName of subagentNames) {
    if (!matchesSkillFilter(subagentName, skillFilter)) continue;

    const entry = lock.subagents[subagentName];
    if (!entry) continue;

    if (!entry.subagentFileHash || !entry.subagentPath) {
      skipped.push({
        name: subagentName,
        reason: getSkipReason(entry),
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref,
      });
      continue;
    }

    checkable.push({ name: subagentName, entry });
  }

  for (let i = 0; i < checkable.length; i++) {
    const { name: subagentName, entry } = checkable[i]!;
    process.stdout.write(
      `\r${DIM}Checking global subagent ${i + 1}/${checkable.length}: ${sanitizeMetadata(subagentName)}${RESET}\x1b[K`
    );

    try {
      const latestHash = await fetchSubagentFileHash(
        entry.source,
        entry.subagentPath!,
        token,
        entry.ref
      );
      if (latestHash && latestHash !== entry.subagentFileHash) {
        updates.push({ name: subagentName, source: entry.source, entry });
      }
    } catch {
      // Skip subagents that fail to check
    }
  }

  if (checkable.length > 0) {
    process.stdout.write('\r\x1b[K');
  }

  const checkedCount = checkable.length + skipped.length;

  if (checkable.length === 0 && skipped.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}No global subagents to check.${RESET}`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  if (checkable.length === 0 && skipped.length > 0) {
    printSkippedSkills(skipped);
    return { successCount, failCount, checkedCount };
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All global subagents are up to date${RESET}`);
    return { successCount, failCount, checkedCount };
  }

  console.log(`${TEXT}Found ${updates.length} global update(s)${RESET}`);
  console.log();

  for (const update of updates) {
    const safeName = sanitizeMetadata(update.name);
    console.log(`${TEXT}Updating ${safeName}...${RESET}`);
    const installUrl = buildUpdateInstallSource(update.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${safeName}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }
    const result = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${safeName}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${safeName}${RESET}`);
    }
  }

  printSkippedSkills(skipped);
  return { successCount, failCount, checkedCount };
}

// ============================================
// Update: Project Skills
// ============================================

async function updateProjectSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; foundCount: number }> {
  const projectSkills = await getProjectSkillsForUpdate(skillFilter);
  let successCount = 0;
  let failCount = 0;

  if (projectSkills.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}No project subagents to update.${RESET}`);
      console.log(
        `${DIM}Install project subagents with${RESET} ${TEXT}npx get-subagents add <package>${RESET}`
      );
    }
    return { successCount, failCount, foundCount: 0 };
  }

  const updatable = projectSkills.filter((s) => s.entry.subagentPath);
  const legacy = projectSkills.filter((s) => !s.entry.subagentPath);

  if (updatable.length === 0) {
    console.log(`${DIM}No project subagents can be updated in place.${RESET}`);
    printLegacyProjectSkills(legacy);
    return { successCount, failCount, foundCount: projectSkills.length };
  }

  console.log(`${TEXT}Refreshing ${updatable.length} project subagent(s)...${RESET}`);
  console.log();

  for (const skill of updatable) {
    const safeName = sanitizeMetadata(skill.name);
    console.log(`${TEXT}Updating ${safeName}...${RESET}`);
    const installUrl = buildLocalUpdateSource(skill.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${safeName}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }

    const result = spawnSync(
      process.execPath,
      [cliEntry, 'add', installUrl, '--skill', skill.name, '-y'],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      }
    );

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${safeName}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${safeName}${RESET}`);
    }
  }

  printLegacyProjectSkills(legacy);
  return { successCount, failCount, foundCount: projectSkills.length };
}

/**
 * Print a hint for each legacy project subagent entry that predates subagentPath
 * tracking.
 */
function printLegacyProjectSkills(
  legacy: Array<{ name: string; source: string; entry: LocalSubagentLockEntry }>
): void {
  if (legacy.length === 0) return;
  console.log();
  console.log(
    `${DIM}${legacy.length} project subagent(s) cannot be updated automatically (installed before subagentPath tracking):${RESET}`
  );
  for (const skill of legacy) {
    const reinstall = formatSourceInput(skill.entry.source, skill.entry.ref);
    console.log(`  ${TEXT}•${RESET} ${sanitizeMetadata(skill.name)}`);
    console.log(`    ${DIM}To refresh: ${TEXT}npx get-subagents add ${reinstall} -y${RESET}`);
  }
}

// ============================================
// runUpdate
// ============================================

async function runUpdate(args: string[] = []): Promise<void> {
  const options = parseUpdateOptions(args);
  const scope = await resolveUpdateScope(options);

  if (options.skills) {
    console.log(`${TEXT}Updating ${options.skills.join(', ')}...${RESET}`);
  } else {
    console.log(`${TEXT}Checking for subagent updates...${RESET}`);
  }
  console.log();

  let totalSuccess = 0;
  let totalFail = 0;
  let totalFound = 0;

  // ---- Global update ----
  if (scope === 'global' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Global Subagents${RESET}`);
    }
    const { successCount, failCount, checkedCount } = await updateGlobalSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += checkedCount;
    if (scope === 'both' && !options.skills) {
      console.log();
    }
  }

  // ---- Project update ----
  if (scope === 'project' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Project Subagents${RESET}`);
    }
    const { successCount, failCount, foundCount } = await updateProjectSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += foundCount;
  }

  // If filtering by name and nothing was found anywhere, tell the user
  if (options.skills && totalFound === 0) {
    console.log(
      `${DIM}No installed subagents found matching: ${options.skills.join(', ')}${RESET}`
    );
  }

  console.log();
  if (totalSuccess > 0) {
    console.log(`${TEXT}✓ Updated ${totalSuccess} subagent(s)${RESET}`);
  }
  if (totalFail > 0) {
    console.log(`${DIM}Failed to update ${totalFail} subagent(s)${RESET}`);
  }
  if (totalSuccess === 0 && totalFail === 0) {
    // No updates found/attempted - the sub-functions already printed their messages
  }

  // Track telemetry
  track({
    event: 'update',
    scope,
    skillCount: String(totalSuccess + totalFail),
    successCount: String(totalSuccess),
    failCount: String(totalFail),
  });

  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'experimental_install': {
      showLogo();
      await runInstallFromLock(restArgs);
      break;
    }
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source: addSource, options: addOpts } = parseAddOptions(restArgs);
      await runAdd(addSource, addOpts);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    case 'experimental_sync': {
      showLogo();
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, syncOptions);
      break;
    }
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
    case 'update':
    case 'upgrade':
      await runUpdate(restArgs);
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}get-subagents --help${RESET} for usage.`);
  }
}

main().finally(() => flushTelemetry().then(() => process.exit(0)));
