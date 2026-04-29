#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { agents } from '../src/agents.ts';

const ROOT = join(import.meta.dirname, '..');
const README_PATH = join(ROOT, 'README.md');
const PACKAGE_PATH = join(ROOT, 'package.json');

function generateAgentList(): string {
  const agentList = Object.values(agents);
  const count = agentList.length;
  return `Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [${count - 4} more](#supported-agents).`;
}

function generateAgentNames(): string {
  return 'Target specific agents (e.g., `claude-code`, `codex`). See [Supported Agents](#supported-agents)';
}

function generateAvailableAgentsTable(): string {
  // Group agents by their paths
  const pathGroups = new Map<
    string,
    {
      keys: string[];
      displayNames: string[];
      agentsDir: string;
      globalAgentsDir: string | undefined;
    }
  >();

  for (const [key, a] of Object.entries(agents)) {
    const pathKey = `${a.agentsDir}|${a.globalAgentsDir}`;
    if (!pathGroups.has(pathKey)) {
      pathGroups.set(pathKey, {
        keys: [],
        displayNames: [],
        agentsDir: a.agentsDir,
        globalAgentsDir: a.globalAgentsDir,
      });
    }
    const group = pathGroups.get(pathKey)!;
    group.keys.push(key);
    group.displayNames.push(a.displayName);
  }

  const rows = Array.from(pathGroups.values()).map((group) => {
    const globalPath = group.globalAgentsDir
      ? `\`${group.globalAgentsDir.replace(homedir(), '~')}/\``
      : 'N/A (project-only)';
    const names = group.displayNames.join(', ');
    const keys = group.keys.map((k) => `\`${k}\``).join(', ');
    return `| ${names} | ${keys} | \`${group.agentsDir}/\` | ${globalPath} |`;
  });
  return [
    '| Agent | `--agent` | Project Path | Global Path |',
    '|-------|-----------|--------------|-------------|',
    ...rows,
  ].join('\n');
}

function generateSubagentDiscoveryPaths(): string {
  const standardPaths = [
    '- Root directory (any `.md` file with valid frontmatter)',
    '- `agents/`',
    '- `subagents/`',
    '- `droids/`',
  ];

  const agentPaths = [...new Set(Object.values(agents).map((a) => a.agentsDir))].map(
    (p) => `- \`${p}/\``
  );

  return [...standardPaths, ...agentPaths].join('\n');
}

function generateKeywords(): string[] {
  const baseKeywords = ['cli', 'agent-subagents', 'subagents', 'ai-agents'];
  const agentKeywords = Object.keys(agents);
  return [...baseKeywords, ...agentKeywords];
}

function replaceSection(
  content: string,
  marker: string,
  replacement: string,
  inline = false
): string {
  const regex = new RegExp(`(<!-- ${marker}:start -->)[\\s\\S]*?(<!-- ${marker}:end -->)`, 'g');
  if (inline) {
    return content.replace(regex, `$1${replacement}$2`);
  }
  return content.replace(regex, `$1\n${replacement}\n$2`);
}

function main() {
  let readme = readFileSync(README_PATH, 'utf-8');

  readme = replaceSection(readme, 'agent-list', generateAgentList());
  readme = replaceSection(readme, 'agent-names', generateAgentNames(), true);
  readme = replaceSection(readme, 'supported-agents', generateAvailableAgentsTable());
  readme = replaceSection(readme, 'subagent-discovery', generateSubagentDiscoveryPaths());

  writeFileSync(README_PATH, readme);
  console.log('README.md updated');

  const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8'));
  pkg.keywords = generateKeywords();
  writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log('package.json updated');
}

main();
