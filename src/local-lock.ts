import { readFile, writeFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const LOCAL_LOCK_FILE = 'subagents-lock.json';
const CURRENT_VERSION = 1;

export interface LocalSubagentLockEntry {
  /** Where the subagent came from: owner/repo, local path, etc. */
  source: string;
  /** Branch or tag ref used for installation */
  ref?: string;
  /** The provider/source type (e.g., "github", "local") */
  sourceType: string;
  /** Path to the subagent .md within the source repo */
  subagentPath?: string;
  /** SHA-256 hash of the subagent .md file contents */
  computedHash: string;
}

export interface LocalSubagentLockFile {
  version: number;
  subagents: Record<string, LocalSubagentLockEntry>;
}

export function getLocalLockPath(cwd?: string): string {
  return join(cwd || process.cwd(), LOCAL_LOCK_FILE);
}

export async function readLocalLock(cwd?: string): Promise<LocalSubagentLockFile> {
  const lockPath = getLocalLockPath(cwd);
  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as LocalSubagentLockFile;
    if (typeof parsed.version !== 'number' || !parsed.subagents) {
      return createEmptyLocalLock();
    }
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLocalLock();
    }
    return parsed;
  } catch {
    return createEmptyLocalLock();
  }
}

export async function writeLocalLock(lock: LocalSubagentLockFile, cwd?: string): Promise<void> {
  const lockPath = getLocalLockPath(cwd);
  const sortedSubagents: Record<string, LocalSubagentLockEntry> = {};
  for (const key of Object.keys(lock.subagents).sort()) {
    sortedSubagents[key] = lock.subagents[key]!;
  }
  const sorted: LocalSubagentLockFile = { version: lock.version, subagents: sortedSubagents };
  const content = JSON.stringify(sorted, null, 2) + '\n';
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Compute a SHA-256 hash from a single subagent .md file.
 */
export async function computeSubagentFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/** Backward-compat alias used by add.ts */
export async function computeSkillFolderHash(filePath: string): Promise<string> {
  return computeSubagentFileHash(filePath);
}

export async function addSkillToLocalLock(
  subagentName: string,
  entry: LocalSubagentLockEntry,
  cwd?: string
): Promise<void> {
  const lock = await readLocalLock(cwd);
  lock.subagents[subagentName] = entry;
  await writeLocalLock(lock, cwd);
}

export async function removeSkillFromLocalLock(
  subagentName: string,
  cwd?: string
): Promise<boolean> {
  const lock = await readLocalLock(cwd);
  if (!(subagentName in lock.subagents)) return false;
  delete lock.subagents[subagentName];
  await writeLocalLock(lock, cwd);
  return true;
}

function createEmptyLocalLock(): LocalSubagentLockFile {
  return { version: CURRENT_VERSION, subagents: {} };
}
