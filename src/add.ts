import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { sep, join, dirname } from 'path';
import { parseSource, getOwnerRepo, parseOwnerRepo, isRepoPrivate } from './source-parser.ts';
import { stripTerminalEscapes } from './sanitize.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';

// Helper to check if a value is a cancel symbol (works with both clack and our custom prompts)
const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

/**
 * Check if a source identifier (owner/repo format) represents a private GitHub repo.
 * Returns true if private, false if public, null if unable to determine or not a GitHub repo.
 */
async function isSourcePrivate(source: string): Promise<boolean | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) {
    // Not in owner/repo format, assume not private (could be other providers)
    return false;
  }
  return isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
}
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { discoverSubagents, getSubagentDisplayName, filterSubagents } from './subagents.ts';
import {
  installSubagentForAgent,
  isSubagentInstalled,
  getCanonicalPath,
  type InstallMode,
} from './installer.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import {
  track,
  setVersion,
  fetchAuditData,
  type AuditResponse,
  type PartnerAudit,
} from './telemetry.ts';
import {
  addSkillToLock,
  getGitHubToken,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
} from './skill-lock.ts';
import { addSkillToLocalLock, computeSubagentFileHash } from './local-lock.ts';
import type { Subagent, AgentType } from './types.ts';
import { getSkillFolderHashFromTree, fetchRepoTree } from './blob.ts';
import packageJson from '../package.json' with { type: 'json' };
export function initTelemetry(version: string): void {
  setVersion(version);
}

// ─── Security Advisory ───

function riskLabel(risk: string): string {
  switch (risk) {
    case 'critical':
      return pc.red(pc.bold('Critical Risk'));
    case 'high':
      return pc.red('High Risk');
    case 'medium':
      return pc.yellow('Med Risk');
    case 'low':
      return pc.green('Low Risk');
    case 'safe':
      return pc.green('Safe');
    default:
      return pc.dim('--');
  }
}

function socketLabel(audit: PartnerAudit | undefined): string {
  if (!audit) return pc.dim('--');
  const count = audit.alerts ?? 0;
  return count > 0 ? pc.red(`${count} alert${count !== 1 ? 's' : ''}`) : pc.green('0 alerts');
}

/** Pad a string to a given visible width (ignoring ANSI escape codes). */
function padEnd(str: string, width: number): string {
  // Strip ANSI codes to measure visible length
  const visible = stripTerminalEscapes(str);
  const pad = Math.max(0, width - visible.length);
  return str + ' '.repeat(pad);
}

/**
 * Render a compact security table showing partner audit results.
 * Returns the lines to display, or empty array if no data.
 */
function buildSecurityLines(
  auditData: AuditResponse | null,
  skills: Array<{ slug: string; displayName: string }>,
  source: string
): string[] {
  if (!auditData) return [];

  // Check if we have any audit data at all
  const hasAny = skills.some((s) => {
    const data = auditData[s.slug];
    return data && Object.keys(data).length > 0;
  });
  if (!hasAny) return [];

  // Compute column width for skill names
  const nameWidth = Math.min(Math.max(...skills.map((s) => s.displayName.length)), 36);

  // Header
  const lines: string[] = [];
  const header =
    padEnd('', nameWidth + 2) +
    padEnd(pc.dim('Gen'), 18) +
    padEnd(pc.dim('Socket'), 18) +
    pc.dim('Snyk');
  lines.push(header);

  // Rows
  for (const skill of skills) {
    const data = auditData[skill.slug];
    const name =
      skill.displayName.length > nameWidth
        ? skill.displayName.slice(0, nameWidth - 1) + '\u2026'
        : skill.displayName;

    const ath = data?.ath ? riskLabel(data.ath.risk) : pc.dim('--');
    const socket = data?.socket ? socketLabel(data.socket) : pc.dim('--');
    const snyk = data?.snyk ? riskLabel(data.snyk.risk) : pc.dim('--');

    lines.push(padEnd(pc.cyan(name), nameWidth + 2) + padEnd(ath, 18) + padEnd(socket, 18) + snyk);
  }

  // Footer link
  lines.push('');
  lines.push(`${pc.dim('Details:')} ${pc.dim(`https://skills.sh/${source}`)}`);

  return lines;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 * Handles both Unix and Windows path separators.
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  // Ensure we match complete path segments by checking for separator after the prefix
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
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

function buildAgentSummaryLines(targetAgents: AgentType[], installMode: InstallMode): string[] {
  const allNames = targetAgents.map((a) => agents[a].displayName);
  if (installMode === 'symlink') {
    return [`  ${pc.dim('symlink →')} ${formatList(allNames)}`];
  }
  return [`  ${pc.dim('copy →')} ${formatList(allNames)}`];
}

function buildResultLines(
  results: Array<{ agent: string; symlinkFailed?: boolean }>,
  _targetAgents: AgentType[]
): string[] {
  const lines: string[] = [];
  const symlinked = results.filter((r) => !r.symlinkFailed).map((r) => r.agent);
  const copied = results.filter((r) => r.symlinkFailed).map((r) => r.agent);
  if (symlinked.length > 0) lines.push(`  ${pc.dim('symlinked:')} ${formatList(symlinked)}`);
  if (copied.length > 0) lines.push(`  ${pc.yellow('copied:')} ${formatList(copied)}`);
  return lines;
}

/**
 * Wrapper around p.multiselect that adds a hint for keyboard usage.
 * Accepts options with required labels (matching our usage pattern).
 */
function multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValues?: Value[];
  required?: boolean;
}) {
  return p.multiselect({
    ...opts,
    // Cast is safe: our options always have labels, which satisfies p.Option requirements
    options: opts.options as p.Option<Value>[],
    message: `${opts.message} ${pc.dim('(space to toggle)')}`,
  }) as Promise<Value[] | symbol>;
}

/**
 * Prompts the user to select agents using interactive search.
 * Pre-selects the last used agents if available.
 * Saves the selection for future use.
 */
export async function promptForAgents(
  message: string,
  choices: Array<{ value: AgentType; label: string; hint?: string }>
): Promise<AgentType[] | symbol> {
  // Get last selected agents to pre-select
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors reading lock file
  }

  const validAgents = choices.map((c) => c.value);

  // Default agents to pre-select when no valid history exists
  const defaultAgents: AgentType[] = ['claude-code', 'opencode', 'codex'];
  const defaultValues = defaultAgents.filter((a) => validAgents.includes(a));

  let initialValues: AgentType[] = [];

  if (lastSelected && lastSelected.length > 0) {
    // Filter stored agents against currently valid agents
    initialValues = lastSelected.filter((a) => validAgents.includes(a as AgentType)) as AgentType[];
  }

  // If no valid selection from history, use defaults
  if (initialValues.length === 0) {
    initialValues = defaultValues;
  }

  const selected = await searchMultiselect({
    message,
    items: choices,
    initialSelected: initialValues,
    required: true,
  });

  if (!isCancelled(selected)) {
    // Save selection for next time
    try {
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors writing lock file
    }
  }

  return selected as AgentType[] | symbol;
}

async function selectAgentsInteractive(options: {
  global?: boolean;
}): Promise<AgentType[] | symbol> {
  const supportsGlobalFilter = (a: AgentType) => !options.global || agents[a].globalAgentsDir;
  const allAgents = (Object.keys(agents) as AgentType[]).filter(supportsGlobalFilter);

  const choices = allAgents.map((a) => ({
    value: a,
    label: agents[a].displayName,
    hint: options.global ? agents[a].globalAgentsDir! : agents[a].agentsDir,
  }));

  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // ignore
  }

  const initialSelected = lastSelected
    ? (lastSelected.filter((a) => allAgents.includes(a as AgentType)) as AgentType[])
    : [];

  const selected = await searchMultiselect({
    message: 'Which agents do you want to install to?',
    items: choices,
    initialSelected,
  });

  if (!isCancelled(selected)) {
    try {
      await saveSelectedAgents(selected as string[]);
    } catch {
      // ignore
    }
  }

  return selected as AgentType[] | symbol;
}

const version = packageJson.version;
setVersion(version);

export interface AddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
  searchDir?: string;
  copy?: boolean;
}

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 * Discovers skills from /.well-known/agent-skills/index.json (preferred)
 * or /.well-known/skills/index.json (legacy fallback).
 */
export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  const showInstallTip = (): void => {
    if (installTipShown) return;
    p.log.message(
      pc.dim('Tip: use the --yes (-y) and --global (-g) flags to install without prompts.')
    );
    installTipShown = true;
  };

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(
      `    ${pc.cyan('npx get-subagents add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`
    );
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(
      `    ${pc.cyan('npx get-subagents add')} ${pc.yellow('VoltAgent/awesome-claude-code-subagents')}`
    );
    console.log();
    process.exit(1);
  }

  // --all implies --skill '*' and --agent '*' and -y
  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' get-subagents ')));

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.agentFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.agentFilter)}` : ''}`
    );

    // Kick off the repo privacy check early so it runs in parallel with
    // cloning/discovering/installing. The result is only needed later for
    // telemetry gating — it should never block user-visible output.
    const ownerRepoRaw = getOwnerRepo(parsed);
    const repoPrivacyPromise: Promise<boolean | null> = (() => {
      if (!ownerRepoRaw) return Promise.resolve(null);
      const ownerRepo = parseOwnerRepo(ownerRepoRaw);
      if (!ownerRepo) return Promise.resolve(null);
      return isRepoPrivate(ownerRepo.owner, ownerRepo.repo).catch(() => null);
    })();

    // If agentFilter is present from @agent syntax (e.g., owner/repo@agent-name),
    // merge it into options.skill
    if (parsed.agentFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.agentFilter)) {
        options.skill.push(parsed.agentFilter);
      }
    }

    const includeInternal = !!(options.skill && options.skill.length > 0);

    let subagents: Subagent[];

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      spinner.stop('Local path validated');

      spinner.start('Discovering subagents...');
      subagents = await discoverSubagents(parsed.localPath!, parsed.subpath, {
        includeInternal,
        searchDir: options.searchDir,
      });
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      spinner.stop('Repository cloned');

      spinner.start('Discovering subagents...');
      subagents = await discoverSubagents(tempDir, parsed.subpath, {
        includeInternal,
        searchDir: options.searchDir,
      });
    }

    if (subagents.length === 0) {
      spinner.stop(pc.red('No subagents found'));
      p.outro(
        pc.red(
          'No valid subagents found. Subagent .md files require name and description frontmatter.'
        )
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(subagents.length)} subagent${subagents.length > 1 ? 's' : ''}`);

    // alias so remaining code below refers to subagents as `skills` (minimises further edits)
    const skills = subagents;

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Subagents'));
      for (const s of skills) {
        p.log.message(`  ${pc.cyan(getSubagentDisplayName(s))}`);
        p.log.message(`    ${pc.dim(s.description)}`);
      }
      console.log();
      p.outro('Use --skill <name> to install specific subagents');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Subagent[];

    if (options.skill?.includes('*')) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} subagents`);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSubagents(skills, options.skill);

      if (selectedSkills.length === 0) {
        p.log.error(`No matching subagents found for: ${options.skill.join(', ')}`);
        p.log.info('Available subagents:');
        for (const s of skills) {
          p.log.message(`  - ${getSubagentDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} subagent${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSubagentDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Subagent: ${pc.cyan(getSubagentDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} subagents`);
    } else {
      const sortedSkills = [...skills].sort((a, b) =>
        getSubagentDisplayName(a).localeCompare(getSubagentDisplayName(b))
      );

      let selected: Subagent[] | symbol;

      {
        const skillChoices = sortedSkills.map((s) => ({
          value: s,
          label: getSubagentDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

        selected = await multiselect({
          message: 'Select subagents to install',
          options: skillChoices,
          required: true,
        });
      }

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Subagent[];
    }

    // Kick off security audit fetch early (non-blocking) so it runs
    // in parallel with agent selection, scope, and mode prompts.
    const ownerRepoForAudit = getOwnerRepo(parsed);
    const auditPromise = ownerRepoForAudit
      ? fetchAuditData(
          ownerRepoForAudit,
          selectedSkills.map((s) => getSubagentDisplayName(s))
        )
      : Promise.resolve(null);

    let targetAgents: AgentType[];
    const validAgents = Object.keys(agents);

    if (options.agent?.includes('*')) {
      // --agent '*' selects all agents
      targetAgents = validAgents as AgentType[];
      p.log.info(`Installing to all ${targetAgents.length} agents`);
    } else if (options.agent && options.agent.length > 0) {
      const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

      if (invalidAgents.length > 0) {
        p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
        p.log.info(`Valid agents: ${validAgents.join(', ')}`);
        await cleanup(tempDir);
        process.exit(1);
      }

      targetAgents = options.agent as AgentType[];
    } else {
      spinner.start('Loading agents...');
      const installedAgents = await detectInstalledAgents();
      const totalAgents = Object.keys(agents).length;
      spinner.stop(`${totalAgents} agents`);

      if (installedAgents.length === 0) {
        if (options.yes) {
          targetAgents = validAgents as AgentType[];
          p.log.info('Installing to all agents');
        } else {
          p.log.info('Select agents to install skills to');

          const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
            value: key as AgentType,
            label: config.displayName,
          }));

          // Use helper to prompt with search
          const selected = await promptForAgents(
            'Which agents do you want to install to?',
            allAgentChoices
          );

          if (p.isCancel(selected)) {
            p.cancel('Installation cancelled');
            await cleanup(tempDir);
            process.exit(0);
          }

          targetAgents = selected as AgentType[];
        }
      } else if (installedAgents.length === 1 || options.yes) {
        targetAgents = installedAgents;
        if (installedAgents.length === 1) {
          const firstAgent = installedAgents[0]!;
          p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
        } else {
          p.log.info(
            `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
          );
        }
      } else {
        const selected = await selectAgentsInteractive({ global: options.global });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanup(tempDir);
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    }

    let installGlobally = options.global ?? false;

    // Check if any selected agents support global installation
    const supportsGlobal = targetAgents.some((a) => agents[a].globalAgentsDir !== undefined);

    if (options.global === undefined && !options.yes && supportsGlobal) {
      const scope = await p.select({
        message: 'Installation scope',
        options: [
          {
            value: false,
            label: 'Project',
            hint: 'Install in current directory (committed with your project)',
          },
          {
            value: true,
            label: 'Global',
            hint: 'Install in home directory (available across all projects)',
          },
        ],
      });

      if (p.isCancel(scope)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installGlobally = scope as boolean;
    }

    // Determine install mode (symlink vs copy)
    let installMode: InstallMode = options.copy ? 'copy' : 'symlink';

    // Only prompt for install mode when there are multiple unique target directories.
    // When all selected agents share the same skillsDir, symlink vs copy is meaningless.
    const uniqueDirs = new Set(targetAgents.map((a) => agents[a].agentsDir));

    if (!options.copy && !options.yes && uniqueDirs.size > 1) {
      const modeChoice = await p.select({
        message: 'Installation method',
        options: [
          {
            value: 'symlink',
            label: 'Symlink (Recommended)',
            hint: 'Single source of truth, easy updates',
          },
          { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
        ],
      });

      if (p.isCancel(modeChoice)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installMode = modeChoice as InstallMode;
    } else if (uniqueDirs.size <= 1) {
      // Single target directory — default to copy (no symlink needed)
      installMode = 'copy';
    }

    const cwd = process.cwd();

    // Build installation summary
    const summaryLines: string[] = [];
    const agentNames = targetAgents.map((a) => agents[a].displayName);

    // Check if any skill will be overwritten (parallel)
    const overwriteChecks = await Promise.all(
      selectedSkills.flatMap((skill) =>
        targetAgents.map(async (agent) => ({
          skillName: skill.name,
          agent,
          installed: await isSubagentInstalled(skill.name, agent, { global: installGlobally }),
        }))
      )
    );
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const { skillName, agent, installed } of overwriteChecks) {
      if (!overwriteStatus.has(skillName)) {
        overwriteStatus.set(skillName, new Map());
      }
      overwriteStatus.get(skillName)!.set(agent, installed);
    }

    for (const skill of selectedSkills) {
      if (summaryLines.length > 0) summaryLines.push('');
      const canonicalPath = getCanonicalPath(skill.name, { global: installGlobally });
      summaryLines.push(`${pc.cyan(shortenPath(canonicalPath, cwd))}`);
      summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));
      const skillOverwrites = overwriteStatus.get(skill.name);
      const overwriteAgents = targetAgents
        .filter((a) => skillOverwrites?.get(a))
        .map((a) => agents[a].displayName);
      if (overwriteAgents.length > 0) {
        summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
      }
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    // Await and display security audit results (started earlier in parallel)
    // Wrapped in try/catch so a failed audit fetch never blocks installation.
    try {
      const auditData = await auditPromise;
      if (auditData && ownerRepoForAudit) {
        const securityLines = buildSecurityLines(
          auditData,
          selectedSkills.map((s) => ({
            slug: getSubagentDisplayName(s),
            displayName: getSubagentDisplayName(s),
          })),
          ownerRepoForAudit
        );
        if (securityLines.length > 0) {
          p.note(securityLines.join('\n'), 'Security Risk Assessments');
        }
      }
    } catch {
      // Silently skip — security info is advisory only
    }

    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    spinner.start('Installing subagents...');

    const results: {
      skill: string;
      agent: string;
      success: boolean;
      path: string;
      canonicalPath?: string;
      mode: InstallMode;
      symlinkFailed?: boolean;
      error?: string;
    }[] = [];

    for (const skill of selectedSkills) {
      for (const agent of targetAgents) {
        const result = await installSubagentForAgent(skill, agent, {
          global: installGlobally,
          mode: installMode,
        });
        results.push({
          skill: getSubagentDisplayName(skill),
          agent: agents[agent].displayName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Build subagent files map for telemetry/lock: { name: repo-relative path }
    const subagentFilePaths: Record<string, string> = {};
    for (const skill of selectedSkills) {
      if (tempDir && skill.filePath.startsWith(tempDir + sep)) {
        subagentFilePaths[skill.name] = skill.filePath
          .slice(tempDir.length + 1)
          .split(sep)
          .join('/');
      }
    }

    const normalizedSource = getOwnerRepo(parsed);
    const isSSH = parsed.url.startsWith('git@');
    const lockSource = isSSH ? parsed.url : normalizedSource;

    if (normalizedSource) {
      const ownerRepo = parseOwnerRepo(normalizedSource);
      const isPrivate = await repoPrivacyPromise;
      if (isPrivate === false) {
        track({
          event: 'install',
          source: normalizedSource,
          skills: selectedSkills.map((s) => s.name).join(','),
          agents: targetAgents.join(','),
          ...(installGlobally && { global: '1' }),
          skillFiles: JSON.stringify(subagentFilePaths),
          ...(ownerRepo ? {} : { sourceType: parsed.type }),
        });
      }
    }

    // Update global lock file (for update tracking)
    if (successful.length > 0 && installGlobally && normalizedSource) {
      const successfulNames = new Set(successful.map((r) => r.skill));
      let cachedTree: Awaited<ReturnType<typeof fetchRepoTree>> | undefined;
      if (parsed.type === 'github') {
        const token = getGitHubToken();
        cachedTree = await fetchRepoTree(normalizedSource, parsed.ref, token);
      }

      for (const skill of selectedSkills) {
        if (!successfulNames.has(getSubagentDisplayName(skill))) continue;
        try {
          let subagentFileHash = '';
          const filePath = subagentFilePaths[skill.name];
          if (parsed.type === 'github' && filePath && cachedTree) {
            const hash = getSkillFolderHashFromTree(cachedTree, filePath);
            if (hash) subagentFileHash = hash;
          } else if (filePath && tempDir) {
            subagentFileHash = await computeSubagentFileHash(skill.filePath);
          }
          await addSkillToLock(skill.name, {
            source: lockSource || normalizedSource,
            sourceType: parsed.type,
            sourceUrl: parsed.url,
            ref: parsed.ref,
            subagentPath: filePath,
            subagentFileHash,
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }

    // Update local lock file (project-scoped installs)
    if (successful.length > 0 && !installGlobally) {
      const successfulNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        if (!successfulNames.has(getSubagentDisplayName(skill))) continue;
        try {
          const computedHash = await computeSubagentFileHash(skill.filePath);
          const filePath = subagentFilePaths[skill.name];
          await addSkillToLocalLock(
            skill.name,
            {
              source: lockSource || parsed.url,
              ref: parsed.ref,
              sourceType: parsed.type,
              ...(filePath && { subagentPath: filePath }),
              computedHash,
            },
            cwd
          );
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }

    if (successful.length > 0) {
      const bySkill = new Map<string, typeof results>();
      for (const r of successful) {
        const skillResults = bySkill.get(r.skill) || [];
        skillResults.push(r);
        bySkill.set(r.skill, skillResults);
      }

      const skillCount = bySkill.size;
      const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
      const copiedAgents = symlinkFailures.map((r) => r.agent);
      const resultLines: string[] = [];

      for (const [skillName, skillResults] of bySkill) {
        const firstResult = skillResults[0]!;
        if (firstResult.mode === 'copy') {
          resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim('(copied)')}`);
          for (const r of skillResults) {
            resultLines.push(`  ${pc.dim('→')} ${shortenPath(r.path, cwd)}`);
          }
        } else {
          resultLines.push(
            `${pc.green('✓')} ${firstResult.canonicalPath ? shortenPath(firstResult.canonicalPath, cwd) : skillName}`
          );
          resultLines.push(...buildResultLines(skillResults, targetAgents));
        }
      }

      const title = pc.green(`Installed ${skillCount} subagent${skillCount !== 1 ? 's' : ''}`);
      p.note(resultLines.join('\n'), title);

      if (symlinkFailures.length > 0) {
        p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
        p.log.message(
          pc.dim(
            '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
          )
        );
      }
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to install ${failed.length}`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(
      pc.green('Done!') +
        pc.dim('  Review subagents before use; they run with full agent permissions.')
    );

    await promptForFindSkills(options, targetAgents);
  } catch (error) {
    if (error instanceof GitCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      // Print each line of the error message separately for better formatting
      for (const line of error.message.split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    showInstallTip();
    p.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanup(tempDir);
  }
}

// Cleanup helper
async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Prompt user to install the find-skills subagent after their first installation.
 */
async function promptForFindSkills(
  options?: AddOptions,
  targetAgents?: AgentType[]
): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (options?.yes) return;

  try {
    const dismissed = await isPromptDismissed('findSubagentsPrompt');
    if (dismissed) return;

    // Check if find-subagents is already installed
    const findInstalled = await isSubagentInstalled('find-subagents', 'claude-code', {
      global: true,
    });
    if (findInstalled) {
      await dismissPrompt('findSubagentsPrompt');
      return;
    }

    console.log();
    p.log.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-subagents')} subagent? It helps your agent discover and suggest subagents.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findSubagentsPrompt');
      return;
    }

    if (install) {
      await dismissPrompt('findSubagentsPrompt');

      if (!targetAgents || targetAgents.length === 0) {
        return;
      }

      console.log();
      p.log.step('Installing find-subagents subagent...');

      try {
        await runAdd(['VoltAgent/awesome-claude-code-subagents'], {
          skill: ['find-subagents'],
          global: true,
          yes: true,
          agent: targetAgents,
        });
      } catch {
        p.log.warn('Failed to install find-subagents.');
      }
    } else {
      await dismissPrompt('findSubagentsPrompt');
    }
  } catch {
    // Don't fail the main installation if prompt fails
  }
}

// Parse command line options from args array
export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.skill.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '--search-dir') {
      i++;
      const dir = args[i];
      if (dir && !dir.startsWith('-')) {
        options.searchDir = dir;
      }
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
