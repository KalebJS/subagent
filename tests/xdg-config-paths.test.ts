/**
 * Tests for XDG config path handling (cross-platform).
 *
 * These tests verify that agents using XDG Base Directory specification
 * (OpenCode, Amp) use ~/.config paths consistently across all platforms.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents } from '../src/agents.ts';

describe('XDG config paths', () => {
  const home = homedir();

  describe('OpenCode', () => {
    it('uses ~/.config/opencode/agents for global agents', () => {
      const expected = join(home, '.config', 'opencode', 'agents');
      expect(agents.opencode.globalAgentsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.opencode.globalAgentsDir).not.toContain('Library');
      expect(agents.opencode.globalAgentsDir).not.toContain('Preferences');
      expect(agents.opencode.globalAgentsDir).not.toContain('AppData');
    });
  });

  describe('Amp', () => {
    it('uses ~/.config/agents/agents for global agents', () => {
      const expected = join(home, '.config', 'agents', 'agents');
      expect(agents.amp.globalAgentsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.amp.globalAgentsDir).not.toContain('Library');
      expect(agents.amp.globalAgentsDir).not.toContain('Preferences');
      expect(agents.amp.globalAgentsDir).not.toContain('AppData');
    });
  });

  describe('subagent lock file path', () => {
    function getSubagentLockPath(xdgStateHome: string | undefined, homeDir: string): string {
      if (xdgStateHome) {
        return join(xdgStateHome, 'subagents', '.subagent-lock.json');
      }
      return join(homeDir, '.agents', '.subagent-lock.json');
    }

    it('uses XDG_STATE_HOME when set', () => {
      const result = getSubagentLockPath('/custom/state', home);
      expect(result).toBe(join('/custom/state', 'subagents', '.subagent-lock.json'));
    });

    it('falls back to ~/.agents when XDG_STATE_HOME is not set', () => {
      const result = getSubagentLockPath(undefined, home);
      expect(result).toBe(join(home, '.agents', '.subagent-lock.json'));
    });
  });

  describe('non-XDG agents', () => {
    it('cursor uses ~/.cursor/agents (home-based, not XDG)', () => {
      const expected = join(home, '.cursor', 'agents');
      expect(agents.cursor.globalAgentsDir).toBe(expected);
    });
  });
});
