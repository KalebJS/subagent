import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('experimental_sync command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `get-subagents-sync-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('node_modules discovery', () => {
    it('should find .md subagent at package root', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-agent-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'root-agent.md'),
        `---
name: root-agent
description: A subagent at package root
tools: [Read, Grep]
---

# Root Agent
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('root-agent');
      expect(result.stdout).toContain('my-agent-pkg');
    });

    it('should find subagents in agents/ subdirectory', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-lib', 'agents');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'helper-agent.md'),
        `---
name: helper-agent
description: A helper subagent in agents/ dir
tools: [Read, Grep]
---

# Helper
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('helper-agent');
      expect(result.stdout).toContain('my-lib');
    });

    it('should show no subagents found when node_modules is empty', () => {
      mkdirSync(join(testDir, 'node_modules'), { recursive: true });

      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No subagents found');
    });

    it('should show no subagents found when no node_modules exists', () => {
      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No subagents found');
    });
  });

  describe('subagents-lock.json', () => {
    it('should write subagents-lock.json after sync', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'lock-test-agent.md'),
        `---
name: lock-test-agent
description: Test lock file writing
tools: [Read]
---

# Lock Test
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lockPath = join(testDir, 'subagents-lock.json');
      expect(existsSync(lockPath)).toBe(true);

      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(lock.version).toBe(1);
      expect(lock.subagents['lock-test-agent']).toBeDefined();
      expect(lock.subagents['lock-test-agent'].source).toBe('my-pkg');
      expect(lock.subagents['lock-test-agent'].sourceType).toBe('node_modules');
      expect(lock.subagents['lock-test-agent'].computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not have timestamps in lock entries', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'no-timestamp-agent.md'),
        `---
name: no-timestamp-agent
description: No timestamps
tools: [Read]
---

# Test
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'subagents-lock.json'), 'utf-8'));
      const entry = lock.subagents['no-timestamp-agent'];
      expect(entry.installedAt).toBeUndefined();
      expect(entry.updatedAt).toBeUndefined();
    });
  });

  describe('CLI routing', () => {
    it('should show experimental_sync in help output', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('experimental_sync');
    });

    it('should show experimental_sync in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('experimental_sync');
    });
  });
});
