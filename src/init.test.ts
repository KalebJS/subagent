import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCliOutput, stripLogo } from './test-utils.ts';

describe('init command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `get-subagents-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should initialize a subagent and create .md file', () => {
    const output = stripLogo(runCliOutput(['init', 'my-test-agent'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Initialized subagent: my-test-agent

      Created:
        my-test-agent.md

      Next steps:
        1. Edit my-test-agent.md to define your subagent instructions
        2. Update the name and description in the frontmatter

      Publishing:
        GitHub:  Push to a repo, then npx get-subagents add <owner>/<repo>
        URL:     Host the file, then npx get-subagents add https://example.com/my-test-agent.md

      "
    `);

    const agentPath = join(testDir, 'my-test-agent.md');
    expect(existsSync(agentPath)).toBe(true);

    const content = readFileSync(agentPath, 'utf-8');
    expect(content).toMatchInlineSnapshot(`
      "---
      name: my-test-agent
      description: A brief description of what this subagent does
      tools: [Read, Grep, Glob]
      model: inherit
      ---

      # my-test-agent

      Instructions for the agent to follow when this subagent is activated.

      ## When to use

      Describe when this subagent should be used.

      ## Instructions

      1. First step
      2. Second step
      3. Additional steps as needed
      "
    `);
  });

  it('should allow multiple subagents in same directory', () => {
    runCliOutput(['init', 'hydration-fix'], testDir);
    runCliOutput(['init', 'waterfall-data-fetching'], testDir);

    expect(existsSync(join(testDir, 'hydration-fix.md'))).toBe(true);
    expect(existsSync(join(testDir, 'waterfall-data-fetching.md'))).toBe(true);
  });

  it('should init with directory name when no name provided', () => {
    const output = stripLogo(runCliOutput(['init'], testDir));

    expect(output).toContain('Initialized subagent:');
    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:');
    expect(output).toContain('npx get-subagents add <owner>/<repo>');
    expect(output).toContain('URL:');
    expect(output).toContain('npx get-subagents add https://example.com/');
  });

  it('should show publishing hints with subagent path', () => {
    const output = stripLogo(runCliOutput(['init', 'my-agent'], testDir));

    expect(output).toContain('Publishing:');
    expect(output).toContain('GitHub:  Push to a repo, then npx get-subagents add <owner>/<repo>');
    expect(output).toContain(
      'URL:     Host the file, then npx get-subagents add https://example.com/my-agent.md'
    );
  });

  it('should show error if subagent already exists', () => {
    runCliOutput(['init', 'existing-agent'], testDir);
    const output = stripLogo(runCliOutput(['init', 'existing-agent'], testDir));
    expect(output).toMatchInlineSnapshot(`
      "Subagent already exists at existing-agent.md
      "
    `);
  });
});
