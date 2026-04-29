import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSubagentForAgent } from '../src/installer.ts';

describe('installer copy mode', () => {
  it('installs subagent .md file via copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-subagent-copy-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const agentName = 'copy-test-agent';
    const content = `---\nname: ${agentName}\ndescription: test\n---\n\n# ${agentName}\n`;

    try {
      const result = await installSubagentForAgent(
        {
          name: agentName,
          description: 'test',
          filePath: join(root, 'source.md'),
          rawContent: content,
        },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedFile = join(projectDir, '.codex', 'agents', `${agentName}.md`);
      const installed = await readFile(installedFile, 'utf-8');
      expect(installed).toContain(`name: ${agentName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
