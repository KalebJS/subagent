import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';

describe('list command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `get-subagents-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -g flag', () => {
      const options = parseListOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseListOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -a flag with single agent', () => {
      const options = parseListOptions(['-a', 'claude-code']);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should parse --agent flag with single agent', () => {
      const options = parseListOptions(['--agent', 'cursor']);
      expect(options.agent).toEqual(['cursor']);
    });

    it('should parse -a flag with multiple agents', () => {
      const options = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
      expect(options.agent).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-a', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
    });

    it('should parse --json flag', () => {
      const options = parseListOptions(['--json']);
      expect(options.json).toBe(true);
    });

    it('should parse combined --json and -g flags', () => {
      const options = parseListOptions(['-g', '--json']);
      expect(options.global).toBe(true);
      expect(options.json).toBe(true);
    });

    it('should stop collecting agents at next flag', () => {
      const options = parseListOptions(['-a', 'claude-code', '-g']);
      expect(options.agent).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project subagents found');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No project subagents found');
      expect(result.exitCode).toBe(0);
    });

    it('should output empty JSON array when no subagents', () => {
      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([]);
    });

    it('should output valid JSON with --json flag', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'json-agent.md'),
        `---
name: json-agent
description: A subagent for JSON testing
---

# JSON Agent
`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('json-agent');
      expect(parsed[0].path).toContain('json-agent');
      expect(parsed[0].scope).toBe('project');
      expect(Array.isArray(parsed[0].agents)).toBe(true);
      expect(result.stdout).not.toMatch(/\x1b\[/);
    });

    it('should output multiple subagents as JSON array', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(agentsDir, 'agent-alpha.md'),
        `---\nname: agent-alpha\ndescription: Alpha\n---\n# Alpha\n`
      );
      writeFileSync(
        join(agentsDir, 'agent-beta.md'),
        `---\nname: agent-beta\ndescription: Beta\n---\n# Beta\n`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('agent-alpha');
      expect(names).toContain('agent-beta');
    });

    it('should show message when no project subagents found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project subagents found');
      expect(result.stdout).toContain('Try listing global subagents with -g');
      expect(result.exitCode).toBe(0);
    });

    it('should list project subagents', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'test-agent.md'),
        `---
name: test-agent
description: A test subagent for listing
---

# Test Agent
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-agent');
      expect(result.stdout).toContain('Project Subagents');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple subagents', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(agentsDir, 'agent-one.md'),
        `---\nname: agent-one\ndescription: First\n---\n# Agent One\n`
      );
      writeFileSync(
        join(agentsDir, 'agent-two.md'),
        `---\nname: agent-two\ndescription: Second\n---\n# Agent Two\n`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('agent-one');
      expect(result.stdout).toContain('agent-two');
      expect(result.stdout).toContain('Project Subagents');
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'project-agent.md'),
        `---\nname: project-agent\ndescription: A project subagent\n---\n# Project Agent\n`
      );

      const result = runCli(['list', '-g'], testDir);
      expect(result.stdout).not.toContain('project-agent');
      expect(result.stdout).toContain('Global Subagents');
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'test-agent.md'),
        `---\nname: test-agent\ndescription: A test subagent\n---\n# Test Agent\n`
      );

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-agent');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore .md files without frontmatter', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(agentsDir, 'valid-agent.md'),
        `---\nname: valid-agent\ndescription: Valid\n---\n# Valid\n`
      );
      writeFileSync(join(agentsDir, 'invalid.md'), '# Not a subagent\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-agent');
      expect(result.stdout).not.toContain('invalid');
      expect(result.exitCode).toBe(0);
    });

    it('should handle .md with missing frontmatter', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(agentsDir, 'valid-agent.md'),
        `---\nname: valid-agent\ndescription: Valid\n---\n# Valid\n`
      );
      writeFileSync(join(agentsDir, 'broken.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-agent');
      expect(result.stdout).not.toContain('broken');
      expect(result.exitCode).toBe(0);
    });

    it('should show subagent path', () => {
      const agentsDir = join(testDir, '.agents', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'test-agent.md'),
        `---\nname: test-agent\ndescription: A test subagent\n---\n# Test Agent\n`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toMatch(/\.agents[/\\]agents[/\\]test-agent\.md/);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed subagents');
    });

    it('should include list options in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('List Options:');
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-a, --agent');
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('get-subagents list');
      expect(result.stdout).toContain('get-subagents ls -g');
      expect(result.stdout).toContain('get-subagents ls -a claude-code');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx @superkut/get-subagents list');
      expect(result.stdout).toContain('List installed subagents');
    });
  });
});
