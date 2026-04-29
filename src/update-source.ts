export interface UpdateSourceEntry {
  source: string;
  sourceUrl: string;
  ref?: string;
  subagentPath?: string;
}

export interface LocalUpdateSourceEntry {
  source: string;
  ref?: string;
  subagentPath?: string;
}

export function formatSourceInput(sourceUrl: string, ref?: string): string {
  if (!ref) {
    return sourceUrl;
  }
  return `${sourceUrl}#${ref}`;
}

/**
 * Derive the subagent's directory path from a .md file path.
 * Returns '' when the subagent lives at the repo root.
 */
function deriveSubagentFolder(subagentPath: string): string {
  let folder = subagentPath;
  // Remove the filename (e.g., "agents/code-reviewer.md" -> "agents")
  const lastSlash = folder.lastIndexOf('/');
  if (lastSlash >= 0) {
    folder = folder.slice(0, lastSlash);
  } else {
    folder = '';
  }
  if (folder.endsWith('/')) {
    folder = folder.slice(0, -1);
  }
  return folder;
}

function appendFolderAndRef(source: string, subagentPath: string, ref?: string): string {
  const folder = deriveSubagentFolder(subagentPath);
  const withFolder = folder ? `${source}/${folder}` : source;
  return ref ? `${withFolder}#${ref}` : withFolder;
}

/**
 * Build the source argument for `subagents add` during update.
 */
export function buildUpdateInstallSource(entry: UpdateSourceEntry): string {
  if (!entry.subagentPath) {
    return formatSourceInput(entry.sourceUrl, entry.ref);
  }
  return appendFolderAndRef(entry.source, entry.subagentPath, entry.ref);
}

/**
 * Build the source argument for `subagents add` during project-level update.
 */
export function buildLocalUpdateSource(entry: LocalUpdateSourceEntry): string {
  if (!entry.subagentPath) {
    return formatSourceInput(entry.source, entry.ref);
  }
  return appendFolderAndRef(entry.source, entry.subagentPath, entry.ref);
}
