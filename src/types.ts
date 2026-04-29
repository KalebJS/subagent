export type AgentType = 'amp' | 'claude-code' | 'codex' | 'cursor' | 'factory' | 'opencode';

export interface Subagent {
  name: string;
  description: string;
  /** Full path to the .md file */
  filePath: string;
  /** Raw .md content for hashing */
  rawContent?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  /** Relative project-level agents directory (e.g. ".claude/agents") */
  agentsDir: string;
  /** Absolute global agents directory. Undefined if agent doesn't support global install. */
  globalAgentsDir: string | undefined;
  detectInstalled: () => Promise<boolean>;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Subagent name extracted from @agent syntax (e.g., owner/repo@agent-name) */
  agentFilter?: string;
}

/**
 * Represents a subagent fetched from a remote host provider.
 */
export interface RemoteSubagent {
  /** Display name of the subagent (from frontmatter) */
  name: string;
  /** Description of the subagent (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation filename */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** The provider that fetched this subagent */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
}
