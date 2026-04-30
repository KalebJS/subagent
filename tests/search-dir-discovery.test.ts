/**
 * Tests for the --search-dir option in subagent discovery.
 *
 * When --search-dir is provided, discoverSubagents recursively searches the
 * specified directory for .md files with name + description frontmatter,
 * running after the priority dirs scan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSubagents } from '../src/subagents.ts';

describe('discoverSubagents with searchDir option', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `get-subagents-search-dir-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should only scan priority dirs when searchDir is not provided', async () => {
    // Create subagent in priority dir (agents/)
    mkdirSync(join(testDir, 'agents'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'priority-agent.md'),
      `---
name: priority-agent
description: Agent in priority dir
---

# Priority Agent
`
    );

    // Create nested agent outside priority dirs
    mkdirSync(join(testDir, 'custom', 'deep'), { recursive: true });
    writeFileSync(
      join(testDir, 'custom', 'deep', 'nested-agent.md'),
      `---
name: nested-agent
description: Deeply nested agent
---

# Nested Agent
`
    );

    const subagents = await discoverSubagents(testDir);
    expect(subagents).toHaveLength(1);
    expect(subagents[0].name).toBe('priority-agent');
  });

  it('should recursively discover .md files in searchDir', async () => {
    mkdirSync(join(testDir, 'my-agents', 'category'), { recursive: true });

    writeFileSync(
      join(testDir, 'my-agents', 'top-agent.md'),
      `---
name: top-agent
description: Top level agent
---

# Top Agent
`
    );

    writeFileSync(
      join(testDir, 'my-agents', 'category', 'nested-agent.md'),
      `---
name: nested-agent
description: Nested agent
---

# Nested Agent
`
    );

    const subagents = await discoverSubagents(testDir, undefined, { searchDir: 'my-agents' });
    expect(subagents).toHaveLength(2);
    const names = subagents.map((s) => s.name).sort();
    expect(names).toEqual(['nested-agent', 'top-agent']);
  });

  it('should skip node_modules, .git, dist, build, __pycache__ during recursion', async () => {
    mkdirSync(join(testDir, 'src', 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(testDir, 'src', '.git'), { recursive: true });
    mkdirSync(join(testDir, 'src', 'valid'), { recursive: true });

    writeFileSync(
      join(testDir, 'src', 'node_modules', 'pkg', 'pkg-agent.md'),
      `---
name: pkg-agent
description: Should not be found
---

# Pkg Agent
`
    );

    writeFileSync(
      join(testDir, 'src', '.git', 'git-agent.md'),
      `---
name: git-agent
description: Should not be found
---

# Git Agent
`
    );

    writeFileSync(
      join(testDir, 'src', 'valid', 'valid-agent.md'),
      `---
name: valid-agent
description: Should be found
---

# Valid Agent
`
    );

    const subagents = await discoverSubagents(testDir, undefined, { searchDir: 'src' });
    expect(subagents).toHaveLength(1);
    expect(subagents[0].name).toBe('valid-agent');
  });

  it('should respect max recursion depth', async () => {
    // MAX_RECURSION_DEPTH is 5, so files 6+ levels deep should not be found
    // d1(0) -> d2(1) -> d3(2) -> d4(3) -> d5(4) -> d6(5) -> d7(6+)
    const deepPath = join(testDir, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7');
    mkdirSync(deepPath, { recursive: true });

    mkdirSync(join(testDir, 'd1'), { recursive: true });
    writeFileSync(
      join(testDir, 'd1', 'shallow-agent.md'),
      `---
name: shallow-agent
description: Shallow agent
---

# Shallow
`
    );

    writeFileSync(
      join(deepPath, 'deep-agent.md'),
      `---
name: deep-agent
description: Too deep to find
---

# Deep
`
    );

    const subagents = await discoverSubagents(testDir, undefined, { searchDir: 'd1' });
    expect(subagents).toHaveLength(1);
    expect(subagents[0].name).toBe('shallow-agent');
  });

  it('should deduplicate by name with priority dirs winning', async () => {
    // Create agent in priority dir (agents/)
    mkdirSync(join(testDir, 'agents'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'my-agent.md'),
      `---
name: my-agent
description: Priority version
---

# Priority
`
    );

    // Create same-named agent in searchDir
    mkdirSync(join(testDir, 'custom'), { recursive: true });
    writeFileSync(
      join(testDir, 'custom', 'my-agent.md'),
      `---
name: my-agent
description: Custom version
---

# Custom
`
    );

    const subagents = await discoverSubagents(testDir, undefined, { searchDir: 'custom' });
    expect(subagents).toHaveLength(1);
    expect(subagents[0].description).toBe('Priority version');
  });

  it('should resolve searchDir relative to subpath when both are provided', async () => {
    mkdirSync(join(testDir, 'packages', 'core', 'agents'), { recursive: true });
    mkdirSync(join(testDir, 'other-agents'), { recursive: true });

    writeFileSync(
      join(testDir, 'packages', 'core', 'agents', 'core-agent.md'),
      `---
name: core-agent
description: Core agent
---

# Core Agent
`
    );

    writeFileSync(
      join(testDir, 'other-agents', 'other-agent.md'),
      `---
name: other-agent
description: Should not be found
---

# Other Agent
`
    );

    // subpath = packages/core, searchDir = agents
    // Should search packages/core/agents/, not top-level other-agents/
    const subagents = await discoverSubagents(testDir, 'packages/core', {
      searchDir: 'agents',
    });
    expect(subagents).toHaveLength(1);
    expect(subagents[0].name).toBe('core-agent');
  });

  it('should throw when searchDir resolves outside basePath', async () => {
    await expect(
      discoverSubagents(testDir, undefined, { searchDir: '../../../etc' })
    ).rejects.toThrow('Invalid --search-dir');
  });

  it('should silently skip when searchDir does not exist', async () => {
    const subagents = await discoverSubagents(testDir, undefined, {
      searchDir: 'nonexistent-dir',
    });
    expect(subagents).toHaveLength(0);
  });

  it('should find agents at multiple nesting levels with searchDir', async () => {
    mkdirSync(join(testDir, 'src', 'review'), { recursive: true });
    mkdirSync(join(testDir, 'src', 'test'), { recursive: true });

    writeFileSync(
      join(testDir, 'src', 'root-agent.md'),
      `---
name: root-agent
description: Root
---

# Root
`
    );

    writeFileSync(
      join(testDir, 'src', 'review', 'reviewer.md'),
      `---
name: reviewer
description: Code reviewer
---

# Reviewer
`
    );

    writeFileSync(
      join(testDir, 'src', 'test', 'tester.md'),
      `---
name: tester
description: Test runner
---

# Tester
`
    );

    const subagents = await discoverSubagents(testDir, undefined, { searchDir: 'src' });
    expect(subagents).toHaveLength(3);
    const names = subagents.map((s) => s.name).sort();
    expect(names).toEqual(['reviewer', 'root-agent', 'tester']);
  });
});
