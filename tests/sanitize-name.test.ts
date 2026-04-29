/**
 * Unit tests for sanitizeName function in installer.ts
 *
 * These tests verify the sanitization logic for subagent names to ensure:
 * - Path traversal attacks are prevented
 * - Names follow kebab-case convention
 * - Special characters are handled safely
 */

import { describe, it, expect } from 'vitest';
import { sanitizeName } from '../src/installer.ts';

describe('sanitizeName', () => {
  describe('basic transformations', () => {
    it('converts to lowercase', () => {
      expect(sanitizeName('MyAgent')).toBe('myagent');
      expect(sanitizeName('UPPERCASE')).toBe('uppercase');
    });

    it('replaces spaces with hyphens', () => {
      expect(sanitizeName('my agent')).toBe('my-agent');
      expect(sanitizeName('Code Review Agent')).toBe('code-review-agent');
    });

    it('replaces multiple spaces with single hyphen', () => {
      expect(sanitizeName('my   agent')).toBe('my-agent');
    });

    it('preserves dots and underscores', () => {
      expect(sanitizeName('bun.sh')).toBe('bun.sh');
      expect(sanitizeName('my_agent')).toBe('my_agent');
      expect(sanitizeName('agent.v2_beta')).toBe('agent.v2_beta');
    });

    it('preserves numbers', () => {
      expect(sanitizeName('agent123')).toBe('agent123');
      expect(sanitizeName('v2.0')).toBe('v2.0');
    });
  });

  describe('special character handling', () => {
    it('replaces special characters with hyphens', () => {
      expect(sanitizeName('agent@name')).toBe('agent-name');
      expect(sanitizeName('agent#name')).toBe('agent-name');
      expect(sanitizeName('agent$name')).toBe('agent-name');
      expect(sanitizeName('agent!name')).toBe('agent-name');
    });

    it('collapses multiple special chars into single hyphen', () => {
      expect(sanitizeName('agent@#$name')).toBe('agent-name');
      expect(sanitizeName('a!!!b')).toBe('a-b');
    });
  });

  describe('path traversal prevention', () => {
    it('prevents path traversal with ../', () => {
      expect(sanitizeName('../etc/passwd')).toBe('etc-passwd');
      expect(sanitizeName('../../secret')).toBe('secret');
    });

    it('prevents path traversal with backslashes', () => {
      expect(sanitizeName('..\\..\\secret')).toBe('secret');
    });

    it('handles absolute paths', () => {
      expect(sanitizeName('/etc/passwd')).toBe('etc-passwd');
      expect(sanitizeName('C:\\Windows\\System32')).toBe('c-windows-system32');
    });
  });

  describe('leading/trailing cleanup', () => {
    it('removes leading dots', () => {
      expect(sanitizeName('.hidden')).toBe('hidden');
      expect(sanitizeName('..hidden')).toBe('hidden');
      expect(sanitizeName('...agent')).toBe('agent');
    });

    it('removes trailing dots', () => {
      expect(sanitizeName('agent.')).toBe('agent');
      expect(sanitizeName('agent..')).toBe('agent');
    });

    it('removes leading hyphens', () => {
      expect(sanitizeName('-agent')).toBe('agent');
      expect(sanitizeName('--agent')).toBe('agent');
    });

    it('removes trailing hyphens', () => {
      expect(sanitizeName('agent-')).toBe('agent');
      expect(sanitizeName('agent--')).toBe('agent');
    });

    it('removes mixed leading dots and hyphens', () => {
      expect(sanitizeName('.-.-agent')).toBe('agent');
      expect(sanitizeName('-.-.agent')).toBe('agent');
    });
  });

  describe('edge cases', () => {
    it('returns unnamed-subagent for empty string', () => {
      expect(sanitizeName('')).toBe('unnamed-subagent');
    });

    it('returns unnamed-subagent when only special chars', () => {
      expect(sanitizeName('...')).toBe('unnamed-subagent');
      expect(sanitizeName('---')).toBe('unnamed-subagent');
      expect(sanitizeName('@#$%')).toBe('unnamed-subagent');
    });

    it('handles very long names (truncates to 251 chars + .md extension)', () => {
      const longName = 'a'.repeat(300);
      const result = sanitizeName(longName);
      expect(result.length).toBe(251);
      expect(result).toBe('a'.repeat(251));
    });

    it('handles unicode characters', () => {
      expect(sanitizeName('agent日本語')).toBe('agent');
      expect(sanitizeName('émoji🎉agent')).toBe('moji-agent');
    });
  });

  describe('real-world examples', () => {
    it('handles GitHub repo style names', () => {
      expect(sanitizeName('vercel/next.js')).toBe('vercel-next.js');
      expect(sanitizeName('owner/repo-name')).toBe('owner-repo-name');
    });

    it('handles URLs', () => {
      expect(sanitizeName('https://example.com')).toBe('https-example.com');
    });

    it('handles mintlify style names', () => {
      expect(sanitizeName('docs.example.com')).toBe('docs.example.com');
      expect(sanitizeName('bun.sh')).toBe('bun.sh');
    });
  });
});
