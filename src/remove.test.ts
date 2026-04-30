import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliWithInput } from './test-utils.js';

describe('remove command', { timeout: 30000 }, () => {
  let testDir: string;
  let agentsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `get-subagents-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    agentsDir = join(testDir, '.agents', 'agents');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSubagent(name: string, description?: string) {
    writeFileSync(
      join(agentsDir, `${name}.md`),
      `---
name: ${name}
description: ${description || `A test subagent called ${name}`}
---

# ${name}

This is a test subagent.
`
    );
  }

  function createAgentDir(agentName: string) {
    const dir = join(testDir, agentName, 'agents');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function createSymlink(subagentFile: string, targetDir: string) {
    const sourcePath = join(agentsDir, subagentFile);
    const linkPath = join(targetDir, subagentFile);
    try {
      const { symlinkSync } = require('fs');
      const relativePath = join('..', '..', '.agents', 'agents', subagentFile);
      symlinkSync(relativePath, linkPath);
    } catch {
      // Skip if symlinks aren't supported
    }
  }

  describe('with no subagents installed', () => {
    it('should show message when no subagents found', () => {
      const result = runCli(['remove', '-y'], testDir);
      expect(result.stdout).toContain('No subagents found');
      expect(result.stdout).toContain('to remove');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for non-existent subagent name', () => {
      const result = runCli(['remove', 'non-existent', '-y'], testDir);
      expect(result.stdout).toContain('No subagents found');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with subagents installed', () => {
    beforeEach(() => {
      createTestSubagent('agent-one', 'First test subagent');
      createTestSubagent('agent-two', 'Second test subagent');
      createTestSubagent('agent-three', 'Third test subagent');

      const claudeDir = createAgentDir('.claude');
      createSymlink('agent-one.md', claudeDir);
      createSymlink('agent-two.md', claudeDir);

      const codexDir = createAgentDir('.codex');
      createSymlink('agent-one.md', codexDir);
      createSymlink('agent-three.md', codexDir);
    });

    it('should remove specific subagent by name with -y flag', () => {
      const result = runCli(['remove', 'agent-one', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 subagent');

      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-two.md'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-three.md'))).toBe(true);
    });

    it('should remove multiple subagents by name', () => {
      const result = runCli(['remove', 'agent-one', 'agent-two', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 subagent');

      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-two.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-three.md'))).toBe(true);
    });

    it('should remove all subagents with --all flag', () => {
      const result = runCli(['remove', '--all', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('3 subagent');

      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-two.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-three.md'))).toBe(false);
    });

    it('should show error for non-existent subagent name when subagents exist', () => {
      const result = runCli(['remove', 'non-existent', '-y'], testDir);
      expect(result.stdout).toContain('No matching subagents');
      expect(result.exitCode).toBe(0);
    });

    it('should be case-insensitive when matching subagent names', () => {
      const result = runCli(['remove', 'AGENT-ONE', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(false);
    });

    it('should remove only the specified subagent and leave others', () => {
      runCli(['remove', 'agent-two', '-y'], testDir);

      expect(existsSync(join(agentsDir, 'agent-two.md'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-three.md'))).toBe(true);
    });

    it('should list subagents to remove before confirmation', () => {
      const result = runCliWithInput(['remove', 'agent-one', 'agent-two'], 'n', testDir);

      expect(result.stdout).toContain('Subagents to remove');
      expect(result.stdout).toContain('agent-one');
      expect(result.stdout).toContain('agent-two');
      expect(result.stdout).toContain('uninstall');

      expect(existsSync(join(agentsDir, 'agent-one.md'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-two.md'))).toBe(true);
    });
  });

  describe('agent filtering', () => {
    beforeEach(() => {
      createTestSubagent('test-agent');
      createAgentDir('.claude');
    });

    it('should show error for invalid agent name', () => {
      const result = runCli(['remove', 'test-agent', '--agent', 'invalid-agent', '-y'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.stdout).toContain('Valid agents');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid agent names', () => {
      const result = runCli(['remove', 'test-agent', '--agent', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should accept multiple agent names', () => {
      const result = runCli(
        ['remove', 'test-agent', '--agent', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });

  describe('global flag', () => {
    beforeEach(() => {
      createTestSubagent('global-agent');
    });

    it('should accept --global flag without error', () => {
      const result = runCli(['remove', 'global-agent', '--global', '-y'], testDir);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('command aliases', () => {
    beforeEach(() => {
      createTestSubagent('alias-test-agent');
    });

    it('should support "rm" alias', () => {
      const result = runCli(['rm', 'alias-test-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });

    it('should support "r" alias', () => {
      const result = runCli(['r', 'alias-test-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle subagent names with special characters', () => {
      createTestSubagent('agent-with-dashes');

      const result = runCli(['remove', 'agent-with-dashes', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(agentsDir, 'agent-with-dashes.md'))).toBe(false);
    });

    it('should handle removing last remaining subagent', () => {
      createTestSubagent('last-agent');

      const result = runCli(['remove', 'last-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 subagent');

      const remaining = readdirSync(agentsDir);
      expect(remaining.length).toBe(0);
    });
  });

  describe('help and info', () => {
    it('should show help with --help', () => {
      const result = runCli(['remove', '--help'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('remove');
      expect(result.stdout).toContain('--global');
      expect(result.stdout).toContain('--agent');
      expect(result.stdout).toContain('--yes');
      expect(result.exitCode).toBe(0);
    });

    it('should show help with -h', () => {
      const result = runCli(['remove', '-h'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('option parsing', () => {
    beforeEach(() => {
      createTestSubagent('parse-test-agent');
    });

    it('should parse -g as global', () => {
      const result = runCli(['remove', 'parse-test-agent', '-g', '-y'], testDir);
      expect(result.stdout).not.toContain('error');
      expect(result.stdout).not.toContain('unrecognized');
    });

    it('should parse --yes flag', () => {
      const result = runCli(['remove', 'parse-test-agent', '--yes'], testDir);
      expect(result.exitCode).toBe(0);
    });

    it('should parse -a as agent', () => {
      const result = runCli(['remove', 'parse-test-agent', '-a', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should handle multiple values for --agent', () => {
      const result = runCli(
        ['remove', 'parse-test-agent', '--agent', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });
});
