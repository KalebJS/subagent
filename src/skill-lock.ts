import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.subagent-lock.json';
const CURRENT_VERSION = 1;

export interface SubagentLockEntry {
  /** Normalized source identifier (e.g., "owner/repo") */
  source: string;
  /** The provider/source type (e.g., "github", "local") */
  sourceType: string;
  /** The original URL used to install the subagent */
  sourceUrl: string;
  /** Branch or tag ref used for installation */
  ref?: string;
  /** Path to the subagent .md within the source repo */
  subagentPath?: string;
  /** GitHub tree SHA or file hash for update detection */
  subagentFileHash: string;
  /** ISO timestamp when the subagent was first installed */
  installedAt: string;
  /** ISO timestamp when the subagent was last updated */
  updatedAt: string;
}

export interface DismissedPrompts {
  findSubagentsPrompt?: boolean;
}

export interface SubagentLockFile {
  version: number;
  subagents: Record<string, SubagentLockEntry>;
  dismissed?: DismissedPrompts;
  lastSelectedAgents?: string[];
}

export function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'subagents', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

export async function readSkillLock(): Promise<SubagentLockFile> {
  const lockPath = getSkillLockPath();
  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SubagentLockFile;

    if (typeof parsed.version !== 'number' || !parsed.subagents) {
      return createEmptyLockFile();
    }
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLockFile();
    }
    return parsed;
  } catch {
    return createEmptyLockFile();
  }
}

export async function writeSkillLock(lock: SubagentLockFile): Promise<void> {
  const lockPath = getSkillLockPath();
  await mkdir(dirname(lockPath), { recursive: true });
  const content = JSON.stringify(lock, null, 2);
  await writeFile(lockPath, content, 'utf-8');
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) return token;
  } catch {
    // gh not installed or not authenticated
  }
  return null;
}

export async function fetchSkillFolderHash(
  ownerRepo: string,
  subagentPath: string,
  token?: string | null,
  ref?: string
): Promise<string | null> {
  const { fetchRepoTree, getSkillFolderHashFromTree } = await import('./blob.ts');
  const tree = await fetchRepoTree(ownerRepo, ref, token);
  if (!tree) return null;
  return getSkillFolderHashFromTree(tree, subagentPath);
}

export async function addSkillToLock(
  subagentName: string,
  entry: Omit<SubagentLockEntry, 'installedAt' | 'updatedAt'>
): Promise<void> {
  const lock = await readSkillLock();
  const now = new Date().toISOString();
  const existingEntry = lock.subagents[subagentName];
  lock.subagents[subagentName] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };
  await writeSkillLock(lock);
}

export async function removeSkillFromLock(subagentName: string): Promise<boolean> {
  const lock = await readSkillLock();
  if (!(subagentName in lock.subagents)) return false;
  delete lock.subagents[subagentName];
  await writeSkillLock(lock);
  return true;
}

export async function getSkillFromLock(subagentName: string): Promise<SubagentLockEntry | null> {
  const lock = await readSkillLock();
  return lock.subagents[subagentName] ?? null;
}

export async function getAllLockedSkills(): Promise<Record<string, SubagentLockEntry>> {
  const lock = await readSkillLock();
  return lock.subagents;
}

export async function getSkillsBySource(): Promise<
  Map<string, { skills: string[]; entry: SubagentLockEntry }>
> {
  const lock = await readSkillLock();
  const bySource = new Map<string, { skills: string[]; entry: SubagentLockEntry }>();
  for (const [name, entry] of Object.entries(lock.subagents)) {
    const existing = bySource.get(entry.source);
    if (existing) {
      existing.skills.push(name);
    } else {
      bySource.set(entry.source, { skills: [name], entry });
    }
  }
  return bySource;
}

function createEmptyLockFile(): SubagentLockFile {
  return { version: CURRENT_VERSION, subagents: {}, dismissed: {} };
}

export async function isPromptDismissed(promptKey: keyof DismissedPrompts): Promise<boolean> {
  const lock = await readSkillLock();
  return lock.dismissed?.[promptKey] === true;
}

export async function dismissPrompt(promptKey: keyof DismissedPrompts): Promise<void> {
  const lock = await readSkillLock();
  if (!lock.dismissed) lock.dismissed = {};
  lock.dismissed[promptKey] = true;
  await writeSkillLock(lock);
}

export async function getLastSelectedAgents(): Promise<string[] | undefined> {
  const lock = await readSkillLock();
  return lock.lastSelectedAgents;
}

export async function saveSelectedAgents(agentList: string[]): Promise<void> {
  const lock = await readSkillLock();
  lock.lastSelectedAgents = agentList;
  await writeSkillLock(lock);
}
