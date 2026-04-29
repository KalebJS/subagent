import {
  mkdir,
  access,
  readdir,
  symlink,
  lstat,
  rm,
  readlink,
  writeFile,
  stat,
  realpath,
  readFile,
} from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, normalize, resolve, sep, relative, dirname } from 'path';
import { homedir, platform } from 'os';
import type { Subagent, AgentType, RemoteSubagent } from './types.ts';
import { agents, detectInstalledAgents } from './agents.ts';
import { AGENTS_DIR, SUBAGENTS_SUBDIR } from './constants.ts';
import { parseSubagentMd } from './subagents.ts';

export type InstallMode = 'symlink' | 'copy';

interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
}

/**
 * Sanitizes a filename to prevent path traversal attacks.
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
  return sanitized.substring(0, 251) || 'unnamed-subagent'; // 251 + ".md" = 255
}

function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

export function getCanonicalSubagentsDir(global: boolean, cwd?: string): string {
  const baseDir = global ? homedir() : cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, SUBAGENTS_SUBDIR);
}

export function getAgentBaseDir(agentType: AgentType, global: boolean, cwd?: string): string {
  const agent = agents[agentType];
  const baseDir = global ? homedir() : cwd || process.cwd();

  if (global) {
    if (agent.globalAgentsDir === undefined) {
      return join(baseDir, agent.agentsDir);
    }
    return agent.globalAgentsDir;
  }

  return join(baseDir, agent.agentsDir);
}

async function resolveParentSymlinks(path: string): Promise<string> {
  const resolved = resolve(path);
  const dir = dirname(resolved);
  const base = basename(resolved);
  try {
    const realDir = await realpath(dir);
    return join(realDir, base);
  } catch {
    return resolved;
  }
}

async function createFileSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    const [realTarget, realLinkPath] = await Promise.all([
      realpath(resolvedTarget).catch(() => resolvedTarget),
      realpath(resolvedLinkPath).catch(() => resolvedLinkPath),
    ]);

    if (realTarget === realLinkPath) return true;

    const realTargetWithParents = await resolveParentSymlinks(target);
    const realLinkPathWithParents = await resolveParentSymlinks(linkPath);
    if (realTargetWithParents === realLinkPathWithParents) return true;

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        const resolvedExisting = resolve(dirname(linkPath), existingTarget);
        if (resolvedExisting === resolvedTarget) return true;
        await rm(linkPath);
      } else {
        await rm(linkPath);
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        try {
          await rm(linkPath, { force: true });
        } catch {}
      }
    }

    await mkdir(dirname(linkPath), { recursive: true });

    const realLinkDir = await resolveParentSymlinks(dirname(linkPath));
    const relativePath = relative(realLinkDir, target);

    await symlink(relativePath, linkPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a local subagent .md file for an agent.
 * Writes to canonical location (.agents/agents/<name>.md) and symlinks to agent location.
 */
export async function installSubagentForAgent(
  subagent: Subagent,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

  if (isGlobal && agent.globalAgentsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global installation`,
    };
  }

  const rawName = subagent.name || basename(subagent.filePath, '.md');
  const subagentName = sanitizeName(rawName);
  const fileName = `${subagentName}.md`;

  const canonicalBase = getCanonicalSubagentsDir(isGlobal, cwd);
  const canonicalFile = join(canonicalBase, fileName);

  const agentBase = getAgentBaseDir(agentType, isGlobal, cwd);
  const agentFile = join(agentBase, fileName);

  if (!isPathSafe(canonicalBase, canonicalFile)) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: 'Invalid subagent name: path traversal detected',
    };
  }
  if (!isPathSafe(agentBase, agentFile)) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: 'Invalid subagent name: path traversal detected',
    };
  }

  const content = subagent.rawContent ?? (await readFile(subagent.filePath, 'utf-8'));

  try {
    if (installMode === 'copy') {
      await mkdir(agentBase, { recursive: true });
      await writeFile(agentFile, content, 'utf-8');
      return { success: true, path: agentFile, mode: 'copy' };
    }

    // Symlink mode: canonical file + symlink to agent location
    await mkdir(canonicalBase, { recursive: true });
    await writeFile(canonicalFile, content, 'utf-8');

    const symlinkCreated = await createFileSymlink(canonicalFile, agentFile);

    if (!symlinkCreated) {
      await mkdir(agentBase, { recursive: true });
      await writeFile(agentFile, content, 'utf-8');
      return {
        success: true,
        path: agentFile,
        canonicalPath: canonicalFile,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return { success: true, path: agentFile, canonicalPath: canonicalFile, mode: 'symlink' };
  } catch (error) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a remote subagent (content already fetched) for an agent.
 */
export async function installRemoteSubagentForAgent(
  subagent: RemoteSubagent,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

  if (isGlobal && agent.globalAgentsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global installation`,
    };
  }

  const subagentName = sanitizeName(subagent.installName);
  const fileName = `${subagentName}.md`;

  const canonicalBase = getCanonicalSubagentsDir(isGlobal, cwd);
  const canonicalFile = join(canonicalBase, fileName);

  const agentBase = getAgentBaseDir(agentType, isGlobal, cwd);
  const agentFile = join(agentBase, fileName);

  if (!isPathSafe(canonicalBase, canonicalFile)) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: 'Invalid subagent name: path traversal detected',
    };
  }
  if (!isPathSafe(agentBase, agentFile)) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: 'Invalid subagent name: path traversal detected',
    };
  }

  try {
    if (installMode === 'copy') {
      await mkdir(agentBase, { recursive: true });
      await writeFile(agentFile, subagent.content, 'utf-8');
      return { success: true, path: agentFile, mode: 'copy' };
    }

    await mkdir(canonicalBase, { recursive: true });
    await writeFile(canonicalFile, subagent.content, 'utf-8');

    const symlinkCreated = await createFileSymlink(canonicalFile, agentFile);

    if (!symlinkCreated) {
      await mkdir(agentBase, { recursive: true });
      await writeFile(agentFile, subagent.content, 'utf-8');
      return {
        success: true,
        path: agentFile,
        canonicalPath: canonicalFile,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return { success: true, path: agentFile, canonicalPath: canonicalFile, mode: 'symlink' };
  } catch (error) {
    return {
      success: false,
      path: agentFile,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function isSubagentInstalled(
  subagentName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const agent = agents[agentType];
  if (options.global && agent.globalAgentsDir === undefined) return false;

  const sanitized = sanitizeName(subagentName);
  const fileName = `${sanitized}.md`;
  const targetBase = options.global
    ? agent.globalAgentsDir!
    : join(options.cwd || process.cwd(), agent.agentsDir);
  const filePath = join(targetBase, fileName);

  if (!isPathSafe(targetBase, filePath)) return false;

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getInstallPath(
  subagentName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const sanitized = sanitizeName(subagentName);
  const fileName = `${sanitized}.md`;
  const targetBase = getAgentBaseDir(agentType, options.global ?? false, options.cwd);
  const installPath = join(targetBase, fileName);

  if (!isPathSafe(targetBase, installPath)) {
    throw new Error('Invalid subagent name: path traversal detected');
  }

  return installPath;
}

export function getCanonicalPath(
  subagentName: string,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const sanitized = sanitizeName(subagentName);
  const fileName = `${sanitized}.md`;
  const canonicalBase = getCanonicalSubagentsDir(options.global ?? false, options.cwd);
  const canonicalPath = join(canonicalBase, fileName);

  if (!isPathSafe(canonicalBase, canonicalPath)) {
    throw new Error('Invalid subagent name: path traversal detected');
  }

  return canonicalPath;
}

export interface InstalledSubagent {
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  scope: 'project' | 'global';
  agents: AgentType[];
}

/**
 * Lists all installed subagents from canonical and agent-specific locations.
 */
export async function listInstalledSubagents(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
  } = {}
): Promise<InstalledSubagent[]> {
  const cwd = options.cwd || process.cwd();
  const subagentsMap: Map<string, InstalledSubagent> = new Map();

  const detectedAgents = await detectInstalledAgents();
  const agentFilter = options.agentFilter;
  const agentsToCheck = agentFilter
    ? detectedAgents.filter((a) => agentFilter.includes(a))
    : detectedAgents;

  const scopeTypes: Array<{ global: boolean }> = [];
  if (options.global === undefined) {
    scopeTypes.push({ global: false }, { global: true });
  } else {
    scopeTypes.push({ global: options.global });
  }

  for (const { global: isGlobal } of scopeTypes) {
    const scopeKey = isGlobal ? 'global' : 'project';

    // Scan canonical dir first
    const canonicalBase = getCanonicalSubagentsDir(isGlobal, cwd);
    await scanDirForSubagents(canonicalBase, isGlobal, cwd, scopeKey, agentsToCheck, subagentsMap);

    // Scan each agent's dir
    for (const agentType of agentsToCheck) {
      const agent = agents[agentType];
      if (isGlobal && agent.globalAgentsDir === undefined) continue;

      const agentBase = isGlobal ? agent.globalAgentsDir! : join(cwd, agent.agentsDir);
      if (agentBase === canonicalBase) continue;

      await scanAgentDirForSubagents(agentBase, agentType, isGlobal, scopeKey, subagentsMap);
    }

    // Also scan dirs for agents not currently detected (may have been installed previously)
    const allAgentTypes = Object.keys(agents) as AgentType[];
    for (const agentType of allAgentTypes) {
      if (agentsToCheck.includes(agentType)) continue;
      const agent = agents[agentType];
      if (isGlobal && agent.globalAgentsDir === undefined) continue;
      const agentBase = isGlobal ? agent.globalAgentsDir! : join(cwd, agent.agentsDir);
      if (!existsSync(agentBase)) continue;

      await scanAgentDirForSubagents(agentBase, agentType, isGlobal, scopeKey, subagentsMap);
    }
  }

  return Array.from(subagentsMap.values());
}

async function scanDirForSubagents(
  dir: string,
  isGlobal: boolean,
  cwd: string,
  scopeKey: string,
  agentsToCheck: AgentType[],
  subagentsMap: Map<string, InstalledSubagent>
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));

    for (const entry of mdFiles) {
      const filePath = join(dir, entry.name);
      const subagent = await parseSubagentMd(filePath);
      if (!subagent) continue;

      const subagentKey = `${scopeKey}:${subagent.name}`;

      // Detect which agents have this subagent
      const installedAgents: AgentType[] = [];
      for (const agentType of agentsToCheck) {
        const agent = agents[agentType];
        if (isGlobal && agent.globalAgentsDir === undefined) continue;

        const agentBase = isGlobal ? agent.globalAgentsDir! : join(cwd, agent.agentsDir);
        const agentFile = join(agentBase, entry.name);
        if (!isPathSafe(agentBase, agentFile)) continue;

        try {
          await access(agentFile);
          installedAgents.push(agentType);
        } catch {
          // not installed for this agent
        }
      }

      if (subagentsMap.has(subagentKey)) {
        const existing = subagentsMap.get(subagentKey)!;
        for (const a of installedAgents) {
          if (!existing.agents.includes(a)) existing.agents.push(a);
        }
      } else {
        subagentsMap.set(subagentKey, {
          name: subagent.name,
          description: subagent.description,
          path: filePath,
          canonicalPath: filePath,
          scope: scopeKey as 'project' | 'global',
          agents: installedAgents,
        });
      }
    }
  } catch {
    // dir doesn't exist
  }
}

async function scanAgentDirForSubagents(
  dir: string,
  agentType: AgentType,
  isGlobal: boolean,
  scopeKey: string,
  subagentsMap: Map<string, InstalledSubagent>
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));

    for (const entry of mdFiles) {
      const filePath = join(dir, entry.name);
      const subagent = await parseSubagentMd(filePath);
      if (!subagent) continue;

      const subagentKey = `${scopeKey}:${subagent.name}`;

      if (subagentsMap.has(subagentKey)) {
        const existing = subagentsMap.get(subagentKey)!;
        if (!existing.agents.includes(agentType)) existing.agents.push(agentType);
      } else {
        subagentsMap.set(subagentKey, {
          name: subagent.name,
          description: subagent.description,
          path: filePath,
          canonicalPath: filePath,
          scope: scopeKey as 'project' | 'global',
          agents: [agentType],
        });
      }
    }
  } catch {
    // dir doesn't exist
  }
}
