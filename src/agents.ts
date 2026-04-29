import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { AgentConfig, AgentType } from './types.ts';

const home = homedir();
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

export const agents: Record<AgentType, AgentConfig> = {
  amp: {
    name: 'amp',
    displayName: 'Amp',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'amp'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    agentsDir: '.claude/agents',
    globalAgentsDir: join(claudeHome, 'agents'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    agentsDir: '.codex/agents',
    globalAgentsDir: join(codexHome, 'agents'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    agentsDir: '.cursor/agents',
    globalAgentsDir: join(home, '.cursor/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
  factory: {
    name: 'factory',
    displayName: 'Factory (Droid)',
    agentsDir: '.factory/droids',
    globalAgentsDir: join(home, '.factory/droids'),
    detectInstalled: async () => {
      return existsSync(join(home, '.factory'));
    },
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    agentsDir: '.opencode/agents',
    globalAgentsDir: join(configHome, 'opencode/agents'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'opencode'));
    },
  },
};

export async function detectInstalledAgents(): Promise<AgentType[]> {
  const results = await Promise.all(
    (Object.keys(agents) as AgentType[]).map(async (agentType) => {
      const installed = await agents[agentType].detectInstalled();
      return installed ? agentType : null;
    })
  );
  return results.filter((a): a is AgentType => a !== null);
}
