import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { agents } from './agents.ts';

/**
 * Install all subagents from the local subagents-lock.json.
 * Groups subagents by source and calls `runAdd` for each group.
 *
 * Only installs to .agents/agents/ -- the canonical project-level location.
 * Does not install to agent-specific directories.
 *
 * node_modules subagents are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.subagents);

  if (skillEntries.length === 0) {
    p.log.warn('No project subagents found in subagents-lock.json');
    p.log.info(
      `Add project-level subagents with ${pc.cyan('npx get-subagents add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Install to all known agents
  const allAgentNames = Object.keys(agents) as Array<keyof typeof agents>;

  // Separate node_modules subagents from remote subagents
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, { sourceType: string; skills: string[] }>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    const installSource = entry.ref ? `${entry.source}#${entry.ref}` : entry.source;
    const existing = bySource.get(installSource);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(installSource, {
        sourceType: entry.sourceType,
        skills: [skillName],
      });
    }
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} subagent${remoteCount !== 1 ? 's' : ''} from subagents-lock.json into ${pc.dim('.agents/agents/')}`
    );
  }

  // Install remote subagents grouped by source
  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        skill: skills,
        agent: allAgentNames,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Handle node_modules subagents via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} subagent${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      const { options: syncOptions } = parseSyncOptions(args);
      await runSync(args, { ...syncOptions, yes: true, agent: allAgentNames });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules subagents: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
