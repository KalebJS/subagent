import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLocalLock,
  writeLocalLock,
  addSkillToLocalLock,
  removeSkillFromLocalLock,
  computeSubagentFileHash,
  getLocalLockPath,
} from '../src/local-lock.ts';

describe('local-lock', () => {
  describe('getLocalLockPath', () => {
    it('returns subagents-lock.json in given directory', () => {
      const result = getLocalLockPath('/some/project');
      expect(result).toBe(join('/some/project', 'subagents-lock.json'));
    });

    it('uses cwd when no directory given', () => {
      const result = getLocalLockPath();
      expect(result).toBe(join(process.cwd(), 'subagents-lock.json'));
    });
  });

  describe('readLocalLock', () => {
    it('returns empty lock when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, subagents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('reads a valid lock file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const content = {
          version: 1,
          subagents: {
            'my-agent': {
              source: 'org/repo',
              sourceType: 'github',
              computedHash: 'abc123',
            },
          },
        };
        await writeFile(join(dir, 'subagents-lock.json'), JSON.stringify(content), 'utf-8');

        const lock = await readLocalLock(dir);
        expect(lock.version).toBe(1);
        expect(lock.subagents['my-agent']).toEqual({
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'abc123',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns empty lock for corrupted JSON (merge conflict markers)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const conflicted = `{
  "version": 1,
  "subagents": {
<<<<<<< HEAD
    "agent-a": { "source": "org/repo-a", "sourceType": "github", "computedHash": "aaa" }
=======
    "agent-b": { "source": "org/repo-b", "sourceType": "github", "computedHash": "bbb" }
>>>>>>> feature-branch
  }
}`;
        await writeFile(join(dir, 'subagents-lock.json'), conflicted, 'utf-8');

        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, subagents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns empty lock for invalid structure (missing subagents key)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await writeFile(join(dir, 'subagents-lock.json'), '{"version": 1}', 'utf-8');
        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, subagents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('writeLocalLock', () => {
    it('writes sorted JSON with trailing newline', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await writeLocalLock(
          {
            version: 1,
            subagents: {
              'zebra-agent': {
                source: 'org/z',
                sourceType: 'github',
                computedHash: 'zzz',
              },
              'alpha-agent': {
                source: 'org/a',
                sourceType: 'github',
                computedHash: 'aaa',
              },
              'middle-agent': {
                source: 'org/m',
                sourceType: 'github',
                computedHash: 'mmm',
              },
            },
          },
          dir
        );

        const raw = await readFile(join(dir, 'subagents-lock.json'), 'utf-8');
        expect(raw.endsWith('\n')).toBe(true);

        const parsed = JSON.parse(raw);
        const keys = Object.keys(parsed.subagents);
        expect(keys).toEqual(['alpha-agent', 'middle-agent', 'zebra-agent']);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('addSkillToLocalLock', () => {
    it('adds a new subagent to an empty lock', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'new-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'hash123' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(lock.subagents['new-agent']).toEqual({
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'hash123',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('updates an existing subagent hash', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'old-hash' },
          dir
        );
        await addSkillToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'new-hash' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(lock.subagents['my-agent']!.computedHash).toBe('new-hash');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('preserves other subagents when adding', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );
        await addSkillToLocalLock(
          'agent-b',
          { source: 'org/b', sourceType: 'github', computedHash: 'bbb' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(Object.keys(lock.subagents)).toHaveLength(2);
        expect(lock.subagents['agent-a']!.computedHash).toBe('aaa');
        expect(lock.subagents['agent-b']!.computedHash).toBe('bbb');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('stores optional ref when present', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'branch-agent',
          {
            source: 'org/repo',
            ref: 'feature/install',
            sourceType: 'github',
            computedHash: 'hash123',
          },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(lock.subagents['branch-agent']).toEqual({
          source: 'org/repo',
          ref: 'feature/install',
          sourceType: 'github',
          computedHash: 'hash123',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('removeSkillFromLocalLock', () => {
    it('removes an existing subagent', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'hash' },
          dir
        );

        const removed = await removeSkillFromLocalLock('my-agent', dir);
        expect(removed).toBe(true);

        const lock = await readLocalLock(dir);
        expect(lock.subagents['my-agent']).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns false for non-existent subagent', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const removed = await removeSkillFromLocalLock('no-such-agent', dir);
        expect(removed).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('computeSubagentFileHash', () => {
    it('produces a deterministic SHA-256 hash', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const filePath = join(dir, 'my-agent.md');
        await writeFile(filePath, '---\nname: test\ndescription: test\n---\n# Test\n', 'utf-8');

        const hash1 = await computeSubagentFileHash(filePath);
        const hash2 = await computeSubagentFileHash(filePath);
        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('changes when file content changes', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const filePath = join(dir, 'my-agent.md');
        await writeFile(filePath, 'version 1', 'utf-8');

        const hash1 = await computeSubagentFileHash(filePath);

        await writeFile(filePath, 'version 2', 'utf-8');

        const hash2 = await computeSubagentFileHash(filePath);
        expect(hash1).not.toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('merge conflict friendliness', () => {
    it('should sort subagents alphabetically in lock file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );

        const raw = await readFile(join(dir, 'subagents-lock.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        const keys = Object.keys(parsed.subagents);
        expect(keys).toEqual([...keys].sort());
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should not have timestamps in lock entries', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );

        const raw = await readFile(join(dir, 'subagents-lock.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        expect(parsed.subagents['agent-a'].installedAt).toBeUndefined();
        expect(parsed.subagents['agent-a'].updatedAt).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('produces no-conflict output when two subagents are added independently', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addSkillToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );
        const branchA = await readFile(join(dir, 'subagents-lock.json'), 'utf-8');

        await writeFile(join(dir, 'subagents-lock.json'), '{"version":1,"subagents":{}}', 'utf-8');

        await addSkillToLocalLock(
          'agent-b',
          { source: 'org/b', sourceType: 'github', computedHash: 'bbb' },
          dir
        );
        const branchB = await readFile(join(dir, 'subagents-lock.json'), 'utf-8');

        const parsedA = JSON.parse(branchA);
        const parsedB = JSON.parse(branchB);
        expect(parsedA.subagents['agent-a']).toBeDefined();
        expect(parsedA.subagents['agent-a'].computedHash).toBeDefined();
        expect(parsedB.subagents['agent-b']).toBeDefined();
        expect(parsedB.subagents['agent-b'].computedHash).toBeDefined();

        expect(parsedA.subagents['agent-a'].installedAt).toBeUndefined();
        expect(parsedA.subagents['agent-a'].updatedAt).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
