import { homedir } from 'os';
import type { AgentType } from './types.ts';
import { agents } from './agents.ts';
import { listInstalledSubagents, type InstalledSubagent } from './installer.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { getAllLockedSkills } from './skill-lock.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

interface ListOptions {
  global?: boolean;
  agent?: string[];
  json?: boolean;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Formats a list of items, truncating if too many
 */
function formatList(items: string[], maxShow: number = 5): string {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(`${YELLOW}Invalid agents: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid agents: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }

    agentFilter = options.agent as AgentType[];
  }

  const installedSkills = await listInstalledSubagents({
    global: scope,
    agentFilter,
  });

  // JSON output mode: structured, no ANSI, untruncated agent lists
  if (options.json) {
    const jsonOutput = installedSkills.map((skill) => ({
      name: skill.name,
      path: skill.canonicalPath,
      scope: skill.scope,
      agents: skill.agents.map((a) => agents[a].displayName),
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Fetch lock entries to get source grouping info
  const lockedSkills = await getAllLockedSkills();

  const cwd = process.cwd();
  const scopeLabel = scope ? 'Global' : 'Project';

  if (installedSkills.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(`${DIM}No ${scopeLabel.toLowerCase()} subagents found.${RESET}`);
    if (scope) {
      console.log(`${DIM}Try listing project subagents without -g${RESET}`);
    } else {
      console.log(`${DIM}Try listing global subagents with -g${RESET}`);
    }
    return;
  }

  function printSubagent(subagent: InstalledSubagent, indent: boolean = false): void {
    const prefix = indent ? '  ' : '';
    const shortPath = shortenPath(subagent.canonicalPath, cwd);
    const agentNames = subagent.agents.map((a) => agents[a].displayName);
    const agentInfo =
      subagent.agents.length > 0 ? formatList(agentNames) : `${YELLOW}not linked${RESET}`;
    console.log(
      `${prefix}${CYAN}${sanitizeMetadata(subagent.name)}${RESET} ${DIM}${shortPath}${RESET}`
    );
    console.log(`${prefix}  ${DIM}Agents:${RESET} ${agentInfo}`);
  }

  console.log(`${BOLD}${scopeLabel} Subagents${RESET}`);
  console.log();

  // Group subagents by source
  const groupedSkills: Record<string, InstalledSubagent[]> = {};
  const ungroupedSkills: InstalledSubagent[] = [];

  for (const sub of installedSkills) {
    const lockEntry = lockedSkills[sub.name];
    const group = lockEntry?.source;
    if (group) {
      if (!groupedSkills[group]) {
        groupedSkills[group] = [];
      }
      groupedSkills[group].push(sub);
    } else {
      ungroupedSkills.push(sub);
    }
  }

  const hasGroups = Object.keys(groupedSkills).length > 0;

  if (hasGroups) {
    // Print groups sorted alphabetically
    const sortedGroups = Object.keys(groupedSkills).sort();
    for (const group of sortedGroups) {
      // Convert kebab-case to Title Case for display header
      const title = group
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      console.log(`${BOLD}${title}${RESET}`);
      const skills = groupedSkills[group];
      if (skills) {
        for (const sub of skills) {
          printSubagent(sub, true);
        }
      }
      console.log();
    }

    // Print ungrouped skills if any exist
    if (ungroupedSkills.length > 0) {
      console.log(`${BOLD}General${RESET}`);
      for (const sub of ungroupedSkills) {
        printSubagent(sub, true);
      }
      console.log();
    }
  } else {
    // No groups, print flat list as before
    for (const sub of installedSkills) {
      printSubagent(sub);
    }
    console.log();
  }
}
