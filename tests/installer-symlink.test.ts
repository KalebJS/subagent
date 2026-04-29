/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readFile,
  readlink,
  symlink,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSubagentForAgent } from '../src/installer.ts';

async function makeSubagentSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-agent');
  await mkdir(dir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, `${name}.md`), content, 'utf-8');
  return dir;
}

describe('installer symlink regression', () => {
  it('does not create self-loop when canonical and agent paths match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-subagent-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const agentName = 'self-loop-agent';
    const sourceDir = await makeSubagentSource(root, agentName);

    try {
      const result = await installSubagentForAgent(
        {
          name: agentName,
          description: 'test',
          filePath: join(sourceDir, `${agentName}.md`),
          rawContent: `---\nname: ${agentName}\ndescription: test\n---\n`,
        },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const installedPath = join(projectDir, '.agents/agents', `${agentName}.md`);
      const stats = await lstat(installedPath);
      expect(stats.isFile()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans pre-existing broken symlink in canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-subagent-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const agentName = 'broken-symlink-agent';
    const sourceDir = await makeSubagentSource(root, agentName);
    const canonicalDir = join(projectDir, '.agents', 'agents');

    try {
      await mkdir(canonicalDir, { recursive: true });
      // Create a broken symlink pointing to nonexistent target
      const canonicalFile = join(canonicalDir, `${agentName}.md`);
      await symlink('/nonexistent/path.md', canonicalFile);

      const result = await installSubagentForAgent(
        {
          name: agentName,
          description: 'test',
          filePath: join(sourceDir, `${agentName}.md`),
          rawContent: `---\nname: ${agentName}\ndescription: test\n---\n`,
        },
        'claude-code',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      // Copy mode should succeed even with broken symlink present
      expect(result.success).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('handles agent agents dir being a symlink to canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-subagent-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const agentName = 'symlinked-dir-agent';
    const sourceDir = await makeSubagentSource(root, agentName);

    const canonicalBase = join(projectDir, '.agents', 'agents');
    await mkdir(canonicalBase, { recursive: true });

    const claudeDir = join(projectDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const claudeAgentsDir = join(claudeDir, 'agents');
    await symlink(canonicalBase, claudeAgentsDir);

    try {
      const result = await installSubagentForAgent(
        {
          name: agentName,
          description: 'test',
          filePath: join(sourceDir, `${agentName}.md`),
          rawContent: `---\nname: ${agentName}\ndescription: test\n---\n`,
        },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const canonicalFile = join(canonicalBase, `${agentName}.md`);
      const stats = await lstat(canonicalFile);
      expect(stats.isFile()).toBe(true);

      const contents = await readFile(canonicalFile, 'utf-8');
      expect(contents).toContain(`name: ${agentName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
