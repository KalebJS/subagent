import { readdir, readFile } from 'fs/promises';
import { join, normalize, resolve, sep } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata } from './sanitize.ts';
import type { Subagent } from './types.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

export function shouldInstallInternalSubagents(): boolean {
  const envValue = process.env.INSTALL_INTERNAL_SUBAGENTS;
  return envValue === '1' || envValue === 'true';
}

/**
 * Validates that a resolved subpath stays within the base directory.
 */
export function isSubpathSafe(basePath: string, subpath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(join(basePath, subpath)));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Try to parse a .md file as a subagent definition.
 * Returns null if it doesn't have the required frontmatter (name + description).
 */
export async function parseSubagentMd(
  filePath: string,
  options?: { includeInternal?: boolean }
): Promise<Subagent | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const { data } = parseFrontmatter(content);

    if (!data.name || !data.description) {
      return null;
    }

    if (typeof data.name !== 'string' || typeof data.description !== 'string') {
      return null;
    }

    const metadata =
      typeof data.metadata === 'object' && data.metadata !== null
        ? (data.metadata as Record<string, unknown>)
        : undefined;
    const isInternal = metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSubagents() && !options?.includeInternal) {
      return null;
    }

    return {
      name: sanitizeMetadata(data.name),
      description: sanitizeMetadata(data.description),
      filePath,
      rawContent: content,
      metadata,
    };
  } catch {
    return null;
  }
}

/**
 * Scan a directory for *.md files that are valid subagent definitions.
 */
async function findSubagentMds(dir: string, depth = 0, maxDepth = 3): Promise<string[]> {
  if (depth > maxDepth) return [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const mdFiles: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.includes(entry.name)) {
        const sub = await findSubagentMds(join(dir, entry.name), depth + 1, maxDepth);
        mdFiles.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        mdFiles.push(join(dir, entry.name));
      }
    }

    return mdFiles;
  } catch {
    return [];
  }
}

export interface DiscoverSubagentsOptions {
  includeInternal?: boolean;
}

/**
 * Discover subagent .md files in a cloned/local repo.
 *
 * Search order:
 * 1. Common subagent collection directories (agents/, subagents/, droids/)
 * 2. Agent-specific directories (.claude/agents/, .codex/agents/, etc.)
 * 3. Repo root (for single-subagent repos)
 * 4. Recursive fallback if nothing found
 *
 * Any .md file with name + description frontmatter is accepted.
 */
export async function discoverSubagents(
  basePath: string,
  subpath?: string,
  options?: DiscoverSubagentsOptions
): Promise<Subagent[]> {
  if (subpath && !isSubpathSafe(basePath, subpath)) {
    throw new Error(`Invalid subpath: "${subpath}" resolves outside the repository directory.`);
  }

  const searchPath = subpath ? join(basePath, subpath) : basePath;
  const seenNames = new Set<string>();
  const subagents: Subagent[] = [];

  async function tryFile(filePath: string): Promise<void> {
    const agent = await parseSubagentMd(filePath, options);
    if (agent && !seenNames.has(agent.name)) {
      subagents.push(agent);
      seenNames.add(agent.name);
    }
  }

  async function tryDir(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((e) => e.isFile() && e.name.endsWith('.md'))
          .map((e) => tryFile(join(dir, e.name)))
      );
    } catch {
      // dir doesn't exist
    }
  }

  // Priority search dirs — common subagent collection conventions
  const priorityDirs = [
    join(searchPath, 'agents'),
    join(searchPath, 'subagents'),
    join(searchPath, 'droids'),
    join(searchPath, '.claude/agents'),
    join(searchPath, '.codex/agents'),
    join(searchPath, '.opencode/agents'),
    join(searchPath, '.cursor/agents'),
    join(searchPath, '.factory/droids'),
    join(searchPath, '.agents/agents'),
  ];

  await Promise.all(priorityDirs.map(tryDir));

  // If pointing at a specific .md file via subpath
  if (subpath && subpath.endsWith('.md')) {
    await tryFile(searchPath);
  }

  // Try root-level .md files (single-subagent repos)
  if (subagents.length === 0) {
    await tryDir(searchPath);
  }

  // Recursive fallback
  if (subagents.length === 0) {
    const allMds = await findSubagentMds(searchPath);
    await Promise.all(allMds.map(tryFile));
  }

  return subagents;
}

export function getSubagentDisplayName(subagent: Subagent): string {
  return subagent.name;
}

export function filterSubagents(subagents: Subagent[], inputNames: string[]): Subagent[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());
  return subagents.filter((s) => {
    const name = s.name.toLowerCase();
    return normalizedInputs.some((input) => input === name);
  });
}
