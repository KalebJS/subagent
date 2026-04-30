import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { shouldInstallInternalSubagents } from './subagents.ts';
import { parseAddOptions } from './add.ts';

function writeSubagentMd(dir: string, name: string, description: string, extra?: string): string {
  const filePath = join(dir, `${name}.md`);
  writeFileSync(
    filePath,
    `---
name: ${name}
description: ${description}
${extra || ''}
---

# ${name}

Instructions here.
`
  );
  return filePath;
}

describe('add command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `subagents-add-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show error when no source provided', () => {
    const result = runCli(['add'], testDir);
    expect(result.stdout).toContain('ERROR');
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('should show error for non-existent local path', () => {
    const result = runCli(['add', './non-existent-path', '-y'], testDir);
    expect(result.stdout).toContain('Local path does not exist');
    expect(result.exitCode).toBe(1);
  });

  it('should list subagents from local path with --list flag', () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeSubagentMd(agentsDir, 'test-agent', 'A test subagent for testing');

    const result = runCli(['add', testDir, '--list'], testDir);
    expect(result.stdout).toContain('test-agent');
    expect(result.stdout).toContain('A test subagent for testing');
    expect(result.exitCode).toBe(0);
  });

  it('should show no subagents found for empty directory', () => {
    const result = runCli(['add', testDir, '-y'], testDir);
    expect(result.stdout).toContain('No subagents found');
    expect(result.stdout).toContain('No valid subagents found');
    expect(result.exitCode).toBe(1);
  });

  it('should install subagent from local path with -y flag', () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeSubagentMd(agentsDir, 'my-agent', 'My test subagent');

    const targetDir = join(testDir, 'project');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(['add', testDir, '-y', '-g', '--agent', 'claude-code'], targetDir);
    expect(result.stdout).toContain('my-agent');
    expect(result.stdout).toContain('Done!');
    expect(result.exitCode).toBe(0);
  });

  it('should filter subagents by name with --skill flag', () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeSubagentMd(agentsDir, 'agent-one', 'First subagent');
    writeSubagentMd(agentsDir, 'agent-two', 'Second subagent');

    const result = runCli(['add', testDir, '--list', '--skill', 'agent-one'], testDir);
    expect(result.stdout).toContain('agent-one');
  });

  it('should show error for invalid agent name', () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeSubagentMd(agentsDir, 'test-agent', 'Test');

    const result = runCli(['add', testDir, '-y', '--agent', 'invalid-agent'], testDir);
    expect(result.stdout).toContain('Invalid agents');
    expect(result.exitCode).toBe(1);
  });

  it('should support add command aliases (a, i, install)', () => {
    const resultA = runCli(['a'], testDir);
    const resultI = runCli(['i'], testDir);
    const resultInstall = runCli(['install'], testDir);

    expect(resultA.stdout).toContain('Missing required argument: source');
    expect(resultI.stdout).toContain('Missing required argument: source');
    expect(resultInstall.stdout).toContain('Missing required argument: source');
  });

  it('should restore from lock file with experimental_install', () => {
    const result = runCli(['experimental_install'], testDir);
    expect(result.stdout).toContain('No project subagents found in subagents-lock.json');
  });

  describe('internal subagents', () => {
    it('should skip internal subagents by default', () => {
      const agentsDir = join(testDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeSubagentMd(
        agentsDir,
        'internal-agent',
        'An internal subagent',
        'metadata:\n  internal: true'
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).not.toContain('internal-agent');
    });

    it('should show internal subagents when INSTALL_INTERNAL_SUBAGENTS=1', () => {
      const agentsDir = join(testDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeSubagentMd(
        agentsDir,
        'internal-agent',
        'An internal subagent',
        'metadata:\n  internal: true'
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SUBAGENTS: '1',
      });
      expect(result.stdout).toContain('internal-agent');
      expect(result.stdout).toContain('An internal subagent');
    });

    it('should show internal subagents when INSTALL_INTERNAL_SUBAGENTS=true', () => {
      const agentsDir = join(testDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeSubagentMd(
        agentsDir,
        'internal-agent',
        'An internal subagent',
        'metadata:\n  internal: true'
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SUBAGENTS: 'true',
      });
      expect(result.stdout).toContain('internal-agent');
    });

    it('should show non-internal subagents alongside internal when env var is set', () => {
      const agentsDir = join(testDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeSubagentMd(
        agentsDir,
        'internal-agent',
        'An internal subagent',
        'metadata:\n  internal: true'
      );
      writeSubagentMd(agentsDir, 'public-agent', 'A public subagent');

      const resultWithout = runCli(['add', testDir, '--list'], testDir);
      expect(resultWithout.stdout).toContain('public-agent');
      expect(resultWithout.stdout).not.toContain('internal-agent');

      const resultWith = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_SUBAGENTS: '1',
      });
      expect(resultWith.stdout).toContain('public-agent');
      expect(resultWith.stdout).toContain('internal-agent');
    });

    it('should not treat metadata.internal: false as internal', () => {
      const agentsDir = join(testDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeSubagentMd(
        agentsDir,
        'not-internal-agent',
        'Explicitly not internal',
        'metadata:\n  internal: false'
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).toContain('not-internal-agent');
    });
  });
});

describe('shouldInstallInternalSubagents', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return false when INSTALL_INTERNAL_SUBAGENTS is not set', () => {
    delete process.env.INSTALL_INTERNAL_SUBAGENTS;
    expect(shouldInstallInternalSubagents()).toBe(false);
  });

  it('should return true when INSTALL_INTERNAL_SUBAGENTS=1', () => {
    process.env.INSTALL_INTERNAL_SUBAGENTS = '1';
    expect(shouldInstallInternalSubagents()).toBe(true);
  });

  it('should return true when INSTALL_INTERNAL_SUBAGENTS=true', () => {
    process.env.INSTALL_INTERNAL_SUBAGENTS = 'true';
    expect(shouldInstallInternalSubagents()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.INSTALL_INTERNAL_SUBAGENTS = '0';
    expect(shouldInstallInternalSubagents()).toBe(false);

    process.env.INSTALL_INTERNAL_SUBAGENTS = 'false';
    expect(shouldInstallInternalSubagents()).toBe(false);

    process.env.INSTALL_INTERNAL_SUBAGENTS = 'yes';
    expect(shouldInstallInternalSubagents()).toBe(false);
  });
});

describe('parseAddOptions', () => {
  it('should parse --all flag', () => {
    const result = parseAddOptions(['source', '--all']);
    expect(result.source).toEqual(['source']);
    expect(result.options.all).toBe(true);
  });

  it('should parse --skill with wildcard', () => {
    const result = parseAddOptions(['source', '--skill', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
  });

  it('should parse --agent with wildcard', () => {
    const result = parseAddOptions(['source', '--agent', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
  });

  it('should parse --skill wildcard with specific agents', () => {
    const result = parseAddOptions(['source', '--skill', '*', '--agent', 'claude-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.agent).toEqual(['claude-code']);
  });

  it('should parse --agent wildcard with specific skills', () => {
    const result = parseAddOptions(['source', '--agent', '*', '--skill', 'my-agent']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
    expect(result.options.skill).toEqual(['my-agent']);
  });

  it('should parse combined flags with wildcards', () => {
    const result = parseAddOptions(['source', '-g', '--skill', '*', '-y']);
    expect(result.source).toEqual(['source']);
    expect(result.options.global).toBe(true);
    expect(result.options.skill).toEqual(['*']);
    expect(result.options.yes).toBe(true);
  });

  it('should parse --search-dir flag', () => {
    const result = parseAddOptions(['source', '--search-dir', 'my-dir']);
    expect(result.source).toEqual(['source']);
    expect(result.options.searchDir).toBe('my-dir');
  });

  it('should parse --search-dir with other flags', () => {
    const result = parseAddOptions(['source', '--search-dir', 'custom/agents', '--list', '-g']);
    expect(result.source).toEqual(['source']);
    expect(result.options.searchDir).toBe('custom/agents');
    expect(result.options.list).toBe(true);
    expect(result.options.global).toBe(true);
  });
});

describe('find-subagents prompt with -y flag', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `subagents-yes-flag-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip find-subagents prompt when -y flag is passed', () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeSubagentMd(agentsDir, 'yes-flag-test-agent', 'A test subagent for -y flag testing');

    const result = runCli(['add', testDir, '-g', '-y', '--skill', 'yes-flag-test-agent'], testDir);

    expect(result.stdout).not.toContain('Install the find-subagents subagent');
    expect(result.stdout).not.toContain("One-time prompt - you won't be asked again");
    expect(result.exitCode).toBe(0);
  });
});
