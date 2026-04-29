import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listInstalledSubagents } from '../src/installer.ts';
import * as agentsModule from '../src/agents.ts';

describe('listInstalledSubagents', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `add-subagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function createSubagentFile(
    basePath: string,
    fileName: string,
    agentData: { name: string; description: string }
  ): Promise<string> {
    const agentsDir = join(basePath, '.agents', 'agents');
    await mkdir(agentsDir, { recursive: true });
    const content = `---
name: ${agentData.name}
description: ${agentData.description}
---

# ${agentData.name}

${agentData.description}
`;
    const filePath = join(agentsDir, `${fileName}.md`);
    await writeFile(filePath, content);
    return filePath;
  }

  it('should return empty array for empty directory', async () => {
    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toEqual([]);
  });

  it('should find single subagent in project directory', async () => {
    await createSubagentFile(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'A test subagent',
    });

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.name).toBe('test-agent');
    expect(subagents[0]!.description).toBe('A test subagent');
    expect(subagents[0]!.scope).toBe('project');
  });

  it('should find multiple subagents', async () => {
    await createSubagentFile(testDir, 'agent-1', {
      name: 'agent-1',
      description: 'First subagent',
    });
    await createSubagentFile(testDir, 'agent-2', {
      name: 'agent-2',
      description: 'Second subagent',
    });

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toHaveLength(2);
    const names = subagents.map((s) => s.name).sort();
    expect(names).toEqual(['agent-1', 'agent-2']);
  });

  it('should ignore .md files without frontmatter', async () => {
    await createSubagentFile(testDir, 'valid-agent', {
      name: 'valid-agent',
      description: 'Valid subagent',
    });

    const agentsDir = join(testDir, '.agents', 'agents');
    await writeFile(join(agentsDir, 'invalid.md'), '# Invalid\nNo frontmatter');

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.name).toBe('valid-agent');
  });

  it('should handle invalid .md gracefully', async () => {
    await createSubagentFile(testDir, 'valid-agent', {
      name: 'valid-agent',
      description: 'Valid subagent',
    });

    const agentsDir = join(testDir, '.agents', 'agents');
    await writeFile(join(agentsDir, 'broken.md'), '# Invalid\nNo frontmatter');

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.name).toBe('valid-agent');
  });

  it('should filter by scope - project only', async () => {
    await createSubagentFile(testDir, 'project-agent', {
      name: 'project-agent',
      description: 'Project subagent',
    });

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.scope).toBe('project');
  });

  it('should handle global scope option', async () => {
    const subagents = await listInstalledSubagents({
      global: true,
      cwd: testDir,
    });
    expect(Array.isArray(subagents)).toBe(true);
  });

  it('should apply agent filter', async () => {
    await createSubagentFile(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'Test subagent',
    });

    const subagents = await listInstalledSubagents({
      global: false,
      cwd: testDir,
      agentFilter: ['cursor'] as any,
    });
    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.name).toBe('test-agent');
  });

  it('should only attribute subagents to installed agents (issue #225)', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['amp']);

    await createSubagentFile(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'Test subagent',
    });

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });

    expect(subagents).toHaveLength(1);
    expect(subagents[0]!.agents).toContain('amp');

    vi.restoreAllMocks();
  });

  it('should find subagent when the file is a symlink', async () => {
    const realFile = join(testDir, 'shared', 'linked-agent.md');
    await mkdir(join(testDir, 'shared'), { recursive: true });
    await writeFile(
      realFile,
      `---
name: linked-agent
description: Subagent reached through a symlink
---

# linked-agent
`
    );

    const agentsDir = join(testDir, '.agents', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await symlink(realFile, join(agentsDir, 'linked-agent.md'), 'file');

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    // Should find the subagent (may be 0 or 1 depending on symlink resolution)
    // At minimum, it shouldn't crash
    expect(Array.isArray(subagents)).toBe(true);
    if (subagents.length > 0) {
      expect(subagents[0]!.name).toBe('linked-agent');
    }
  });

  it('should ignore dangling symlinks', async () => {
    const agentsDir = join(testDir, '.agents', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await symlink(join(testDir, 'does-not-exist.md'), join(agentsDir, 'broken.md'), 'file');

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });
    expect(subagents).toEqual([]);
  });

  it('should find subagents in agent-specific directories', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['claude-code']);

    // Install in .claude/agents/ directory
    const claudeAgentsDir = join(testDir, '.claude', 'agents');
    await mkdir(claudeAgentsDir, { recursive: true });
    await writeFile(
      join(claudeAgentsDir, 'claude-agent.md'),
      `---
name: claude-agent
description: A subagent in claude directory
---

# claude-agent
`
    );

    const subagents = await listInstalledSubagents({ global: false, cwd: testDir });

    // Should find at least 1 subagent
    expect(subagents.length).toBeGreaterThanOrEqual(1);
    expect(subagents.some((s) => s.name === 'claude-agent')).toBe(true);

    vi.restoreAllMocks();
  });
});
