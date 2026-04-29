/**
 * Blob-based skill download utilities.
 *
 * Enables fast skill installation by fetching pre-built skill snapshots
 * from the skills.sh download API instead of cloning git repos.
 *
 * Flow:
 *   1. GitHub Trees API → discover SKILL.md locations
 *   2. raw.githubusercontent.com → fetch frontmatter to get skill names
 *   3. skills.sh/api/download → fetch full file contents from cached blob
 */

import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata } from './sanitize.ts';
import type { Subagent } from './types.ts';

// ─── Types ───

export interface SkillSnapshotFile {
  path: string;
  contents: string;
}

export interface SkillDownloadResponse {
  files: SkillSnapshotFile[];
  hash: string; // skillsComputedHash
}

/**
 * A skill resolved from blob storage, carrying file contents in memory
 * instead of referencing a directory on disk.
 */
export interface BlobSubagent extends Subagent {
  /** Files from the blob snapshot */
  files: SkillSnapshotFile[];
  /** skillsComputedHash from the blob snapshot */
  snapshotHash: string;
  /** Path of the .md within the repo (e.g., "agents/code-reviewer.md") */
  repoPath: string;
}

// ─── Constants ───

const DOWNLOAD_BASE_URL = process.env.SKILLS_DOWNLOAD_URL || 'https://skills.sh';

/** Timeout for individual HTTP fetches (ms) */
const FETCH_TIMEOUT = 10_000;

// ─── Slug computation ───

/**
 * Convert a skill name to a URL-safe slug.
 * Must match the server-side toSkillSlug() exactly.
 */
export function toSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── GitHub Trees API ───

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface RepoTree {
  sha: string;
  branch: string;
  tree: TreeEntry[];
}

/**
 * Fetch the full recursive tree for a GitHub repo.
 * Returns the tree data including all entries, or null on failure.
 * Tries branches in order: ref (if specified), then main, then master.
 */
export async function fetchRepoTree(
  ownerRepo: string,
  ref?: string,
  token?: string | null
): Promise<RepoTree | null> {
  const branches = ref ? [ref] : ['HEAD', 'main', 'master'];

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skills-cli',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        sha: string;
        tree: TreeEntry[];
      };

      return { sha: data.sha, branch, tree: data.tree };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Extract the tree SHA for a specific subagent path from a repo tree.
 */
export function getSkillFolderHashFromTree(tree: RepoTree, subagentPath: string): string | null {
  let filePath = subagentPath.replace(/\\/g, '/');

  // Remove filename to get directory path
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash >= 0) {
    filePath = filePath.slice(0, lastSlash);
  } else {
    filePath = '';
  }
  if (filePath.endsWith('/')) {
    filePath = filePath.slice(0, -1);
  }

  // Root-level file
  if (!filePath) {
    return tree.sha;
  }

  const entry = tree.tree.find((e) => e.type === 'tree' && e.path === filePath);
  return entry?.sha ?? null;
}

// ─── Skill discovery from tree ───

/** Known directories where subagent .md files are commonly found (relative to repo root) */
const PRIORITY_PREFIXES = [
  '',
  'agents/',
  'subagents/',
  'droids/',
  '.claude/agents/',
  '.codex/agents/',
  '.opencode/agents/',
  '.cursor/agents/',
  '.factory/droids/',
  '.agents/agents/',
];

/**
 * Find all .md subagent files in a repo tree that have frontmatter.
 * If subpath is set, only searches within that subtree.
 */
export function findSubagentMdPaths(tree: RepoTree, subpath?: string): string[] {
  // Find all blob entries that are .md files
  const allMds = tree.tree
    .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
    .map((e) => e.path);

  // Apply subpath filter
  const prefix = subpath ? (subpath.endsWith('/') ? subpath : subpath + '/') : '';
  const filtered = prefix ? allMds.filter((p) => p.startsWith(prefix)) : allMds;

  if (filtered.length === 0) return [];

  // Check priority directories first
  const priorityResults: string[] = [];
  const seen = new Set<string>();

  for (const priorityPrefix of PRIORITY_PREFIXES) {
    const fullPrefix = prefix + priorityPrefix;
    for (const mdFile of filtered) {
      if (!mdFile.startsWith(fullPrefix)) continue;
      if (!seen.has(mdFile)) {
        priorityResults.push(mdFile);
        seen.add(mdFile);
      }
    }
  }

  if (priorityResults.length > 0) return priorityResults;

  // Fallback: return all .md files found (limited to 5 levels deep)
  return filtered.filter((p) => {
    const depth = p.split('/').length;
    return depth <= 6;
  });
}

// ─── Fetching skill content ───

/**
 * Fetch a single SKILL.md from raw.githubusercontent.com to get frontmatter.
 * Returns the raw content string, or null on failure.
 */
async function fetchSkillMdContent(
  ownerRepo: string,
  branch: string,
  skillMdPath: string
): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${skillMdPath}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Fetch a skill's full file contents from the skills.sh download API.
 * Returns the files array and content hash, or null on failure.
 */
async function fetchSkillDownload(
  source: string,
  slug: string
): Promise<SkillDownloadResponse | null> {
  try {
    const [owner, repo] = source.split('/');
    const url = `${DOWNLOAD_BASE_URL}/api/download/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    return (await response.json()) as SkillDownloadResponse;
  } catch {
    return null;
  }
}

// ─── Main entry point ───

export interface BlobInstallResult {
  subagents: BlobSubagent[];
  tree: RepoTree;
}

/**
 * Attempt to resolve subagents from blob storage instead of cloning.
 *
 * @param ownerRepo - e.g., "VoltAgent/awesome-claude-code-subagents"
 * @param options - subpath, skillFilter, ref, token
 */
export async function tryBlobInstall(
  ownerRepo: string,
  options: {
    subpath?: string;
    skillFilter?: string;
    ref?: string;
    token?: string | null;
    includeInternal?: boolean;
  } = {}
): Promise<BlobInstallResult | null> {
  // 1. Fetch the full repo tree
  const tree = await fetchRepoTree(ownerRepo, options.ref, options.token);
  if (!tree) return null;

  // 2. Discover .md paths in the tree
  let mdPaths = findSubagentMdPaths(tree, options.subpath);
  if (mdPaths.length === 0) return null;

  // 3. If a skill filter is set, try to narrow down
  if (options.skillFilter) {
    const filterSlug = toSkillSlug(options.skillFilter);
    const filtered = mdPaths.filter((p) => {
      const parts = p.split('/');
      const fileName = parts[parts.length - 1]!;
      const baseName = fileName.replace(/\.md$/, '');
      return toSkillSlug(baseName) === filterSlug;
    });
    if (filtered.length > 0) {
      mdPaths = filtered;
    }
  }

  // 4. Fetch .md content from raw.githubusercontent.com in parallel
  const mdFetches = await Promise.all(
    mdPaths.map(async (mdPath) => {
      const content = await fetchSkillMdContent(ownerRepo, tree.branch, mdPath);
      return { mdPath, content };
    })
  );

  // Parse frontmatter to get subagent names
  const parsedSkills: Array<{
    mdPath: string;
    name: string;
    description: string;
    content: string;
    slug: string;
    metadata?: Record<string, unknown>;
  }> = [];

  for (const { mdPath, content } of mdFetches) {
    if (!content) continue;

    const { data } = parseFrontmatter(content);
    if (!data.name || !data.description) continue;
    if (typeof data.name !== 'string' || typeof data.description !== 'string') continue;

    const isInternal = (data.metadata as Record<string, unknown>)?.internal === true;
    if (isInternal && !options.includeInternal) continue;

    const safeName = sanitizeMetadata(data.name);
    const safeDescription = sanitizeMetadata(data.description);

    parsedSkills.push({
      mdPath,
      name: safeName,
      description: safeDescription,
      content,
      slug: toSkillSlug(safeName),
      metadata: data.metadata as Record<string, unknown> | undefined,
    });
  }

  if (parsedSkills.length === 0) return null;

  // Apply skill filter by name if not already filtered
  let filteredSkills = parsedSkills;
  if (options.skillFilter) {
    const filterSlug = toSkillSlug(options.skillFilter);
    const nameFiltered = parsedSkills.filter((s) => s.slug === filterSlug);
    if (nameFiltered.length > 0) {
      filteredSkills = nameFiltered;
    }
    if (filteredSkills.length === 0) return null;
  }

  // 5. Fetch full snapshots from skills.sh download API in parallel
  const source = ownerRepo.toLowerCase();
  const downloads = await Promise.all(
    filteredSkills.map(async (skill) => {
      const download = await fetchSkillDownload(source, skill.slug);
      return { skill, download };
    })
  );

  const allSucceeded = downloads.every((d) => d.download !== null);
  if (!allSucceeded) return null;

  // 6. Convert to BlobSubagent objects
  const blobSubagents: BlobSubagent[] = downloads.map(({ skill, download }) => {
    const lastSlash = skill.mdPath.lastIndexOf('/');
    const dirPath = lastSlash >= 0 ? skill.mdPath.slice(0, lastSlash) : '';

    return {
      name: skill.name,
      description: skill.description,
      filePath: '',
      rawContent: skill.content,
      metadata: skill.metadata,
      files: download!.files,
      snapshotHash: download!.hash,
      repoPath: skill.mdPath,
    };
  });

  return { subagents: blobSubagents, tree };
}
