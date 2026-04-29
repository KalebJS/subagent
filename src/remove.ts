import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { agents, detectInstalledAgents } from './agents.ts';
import { track } from './telemetry.ts';
import { removeSkillFromLock, getSkillFromLock } from './skill-lock.ts';
import type { AgentType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSubagentsDir,
  sanitizeName,
} from './installer.ts';

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

export async function removeCommand(subagentNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed subagents...');
  const subagentNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          subagentNamesSet.add(entry.name.replace(/\.md$/, ''));
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    await scanDir(getCanonicalSubagentsDir(true, cwd));
    for (const agent of Object.values(agents)) {
      if (agent.globalAgentsDir !== undefined) {
        await scanDir(agent.globalAgentsDir);
      }
    }
  } else {
    await scanDir(getCanonicalSubagentsDir(false, cwd));
    for (const agent of Object.values(agents)) {
      await scanDir(join(cwd, agent.agentsDir));
    }
  }

  const installedSubagents = Array.from(subagentNamesSet).sort();
  spinner.stop(`Found ${installedSubagents.length} unique installed subagent(s)`);

  if (installedSubagents.length === 0) {
    p.outro(pc.yellow('No subagents found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for skill selection
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = installedSubagents;
  } else if (subagentNames.length > 0) {
    selectedSkills = installedSubagents.filter((s) =>
      subagentNames.some((name) => name.toLowerCase() === s.toLowerCase())
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching subagents found for: ${subagentNames.join(', ')}`);
      return;
    }
  } else {
    const choices = installedSubagents.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select subagents to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedSkills = selected as string[];
  }

  let targetAgents: AgentType[];
  if (options.agent && options.agent.length > 0) {
    targetAgents = options.agent as AgentType[];
  } else {
    // When removing, we should target all known agents to ensure
    // ghost symlinks are cleaned up, even if the agent is not detected.
    targetAgents = Object.keys(agents) as AgentType[];
    spinner.stop(`Targeting ${targetAgents.length} potential agent(s)`);
  }

  if (!options.yes) {
    console.log();
    p.log.info('Subagents to remove:');
    for (const skill of selectedSkills) {
      p.log.message(`  ${pc.red('•')} ${skill}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedSkills.length} subagent(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing subagents...');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

        const pathsToCleanup = new Set([skillPath]);
        const sanitizedName = sanitizeName(skillName);
        const fileName = `${sanitizedName}.md`;
        if (isGlobal && agent.globalAgentsDir) {
          pathsToCleanup.add(join(agent.globalAgentsDir, fileName));
        } else {
          pathsToCleanup.add(join(cwd, agent.agentsDir, fileName));
        }

        for (const pathToCleanup of pathsToCleanup) {
          if (pathToCleanup === canonicalPath) {
            continue;
          }

          try {
            const stats = await lstat(pathToCleanup).catch(() => null);
            if (stats) {
              await rm(pathToCleanup, { force: true });
            }
          } catch (err) {
            p.log.warn(
              `Could not remove subagent from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedAgents = await detectInstalledAgents();
      const remainingAgents = installedAgents.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const path = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const exists = await lstat(path).catch(() => null);
        if (exists) {
          isStillUsed = true;
          break;
        }
      }

      if (!isStillUsed) {
        await rm(canonicalPath, { force: true });
      }

      const lockEntry = isGlobal ? await getSkillFromLock(skillName) : null;
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      if (isGlobal) {
        await removeSkillFromLock(skillName);
      }

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal (grouped by source)
  if (successful.length > 0) {
    const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { skills: [] };
      existing.skills.push(r.skill);
      existing.sourceType = r.sourceType;
      bySource.set(source, existing);
    }

    for (const [source, data] of bySource) {
      track({
        event: 'remove',
        source,
        skills: data.skills.join(','),
        agents: targetAgents.join(','),
        ...(isGlobal && { global: '1' }),
        sourceType: data.sourceType,
      });
    }
  }

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} subagent(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} subagent(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
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
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}
