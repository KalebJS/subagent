import { describe, it, expect } from 'vitest';
import {
  buildLocalUpdateSource,
  buildUpdateInstallSource,
  formatSourceInput,
} from './update-source.ts';

describe('update-source', () => {
  describe('formatSourceInput', () => {
    it('appends ref fragment when provided', () => {
      expect(formatSourceInput('https://github.com/owner/repo.git', 'feature/install')).toBe(
        'https://github.com/owner/repo.git#feature/install'
      );
    });

    it('returns source unchanged when ref is missing', () => {
      expect(formatSourceInput('https://github.com/owner/repo.git')).toBe(
        'https://github.com/owner/repo.git'
      );
    });
  });

  describe('buildUpdateInstallSource', () => {
    it('builds root-level install source for root-level subagent', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        subagentPath: 'code-reviewer.md',
      });
      expect(result).toBe('owner/repo#feature/install');
    });

    it('builds nested subagent install source with ref', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        subagentPath: 'agents/code-reviewer.md',
      });
      expect(result).toBe('owner/repo/agents#feature/install');
    });

    it('falls back to sourceUrl when subagentPath is missing', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
      });
      expect(result).toBe('https://github.com/owner/repo.git#feature/install');
    });
  });

  describe('buildLocalUpdateSource', () => {
    it('appends subagent folder from subagentPath with ref', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        ref: 'main',
        subagentPath: 'agents/code-reviewer.md',
      });
      expect(result).toBe('owner/repo/agents#main');
    });

    it('appends subagent folder from subagentPath without ref', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        subagentPath: 'agents/code-reviewer.md',
      });
      expect(result).toBe('owner/repo/agents');
    });

    it('keeps root-level subagentPath from collapsing to trailing slash', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        subagentPath: 'code-reviewer.md',
      });
      expect(result).toBe('owner/repo');
    });

    it('falls back to bare source when subagentPath is missing', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        ref: 'main',
      });
      expect(result).toBe('owner/repo#main');
    });
  });
});
