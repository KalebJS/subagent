import { readdir, readFile, stat } from 'fs/promises';
import { join, normalize, resolve, sep } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata } from './sanitize.ts';
import type { Subagent } from './types.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];
const MAX_RECURSION_DEPTH = 5;

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
 * Recursively walk a directory, collecting all .md file paths.
 * Skips SKIP_DIRS and respects MAX_RECURSION_DEPTH.
 */
async function findMdFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_RECURSION_DEPTH) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  const subDirs: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name));
    } else if (entry.isDirectory() && !SKIP_DIRS.includes(entry.name)) {
      subDirs.push(join(dir, entry.name));
    }
  }

  const subResults = await Promise.all(subDirs.map((d) => findMdFiles(d, depth + 1)));
  return [...files, ...subResults.flat()];
}

export interface DiscoverSubagentsOptions {
  includeInternal?: boolean;
  /** Directory to recursively search for .md files (relative to searchPath). */
  searchDir?: string;
}

/**
 * Discover subagent .md files in a cloned/local repo.
 *
 * Search order:
 * 1. Priority directories — common collection dirs (agents/, subagents/, droids/)
 *    and agent-specific dirs (.claude/agents/, .codex/agents/, etc.)
 * 2. Subpath .md file (when subpath points directly at a .md file)
 * 3. Recursive search (when searchDir is provided) — walks the specified
 *    directory tree for .md files with valid frontmatter
 *
 * Any .md file with name + description frontmatter is accepted.
 * Duplicates by name are resolved in priority order: earlier matches win.
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

  // 1. Priority search dirs — common subagent collection conventions + agent-specific dirs
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

  // 2. If pointing at a specific .md file via subpath
  if (subpath && subpath.endsWith('.md')) {
    await tryFile(searchPath);
  }

  // 3. Recursive search when searchDir is provided
  if (options?.searchDir) {
    const recursiveDir = join(searchPath, options.searchDir);

    // Validate searchDir stays within basePath
    const normalizedBase = normalize(resolve(basePath));
    const normalizedTarget = normalize(resolve(recursiveDir));
    if (!normalizedTarget.startsWith(normalizedBase + sep) && normalizedTarget !== normalizedBase) {
      throw new Error(
        `Invalid --search-dir: "${options.searchDir}" resolves outside the repository directory.`
      );
    }

    try {
      const dirStat = await stat(recursiveDir);
      if (dirStat.isDirectory()) {
        const mdFiles = await findMdFiles(recursiveDir);
        await Promise.all(mdFiles.map(tryFile));
      }
    } catch {
      // searchDir doesn't exist — skip silently
    }
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
