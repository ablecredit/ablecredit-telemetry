import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMissing, isTarget, main, planInstall } from '../src/cli/index.js';
import type { Io, PackageManifest } from '../src/cli/index.js';

const realManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageManifest;

const manifest: PackageManifest = {
  peerDependencies: { 'a-pkg': '^1.0.0', 'b-pkg': '~2.0.0' },
  ablecredit: { installSets: { node: ['a-pkg', 'b-pkg'], web: ['a-pkg'] } },
};

function fakeIo(cwd = process.cwd(), exitCode = 0) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<[string, string[]]> = [];
  const io: Io = {
    cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    run: (command, args) => {
      calls.push([command, args]);
      return exitCode;
    },
  };
  return { io, out, err, calls };
}

describe('the real package.json', () => {
  it.each(['node', 'web'] as const)('has a consistent "%s" install set (every package has a peer range)', (target) => {
    expect(() => planInstall(realManifest, target)).not.toThrow();
    expect(planInstall(realManifest, target).length).toBeGreaterThan(5);
  });

  it('declares every install-set package as an optional peer, except the OpenTelemetry API', () => {
    const optional = (realManifest as { peerDependenciesMeta?: Record<string, { optional?: boolean }> })
      .peerDependenciesMeta;
    const names = new Set([
      ...(realManifest.ablecredit?.installSets?.node ?? []),
      ...(realManifest.ablecredit?.installSets?.web ?? []),
    ]);
    for (const name of names) {
      if (name === '@opentelemetry/api') continue;
      expect(optional?.[name]?.optional, `${name} should be an optional peer`).toBe(true);
    }
  });
});

describe('planInstall', () => {
  it('pairs each package with its peer range', () => {
    expect(planInstall(manifest, 'node')).toEqual(['a-pkg@^1.0.0', 'b-pkg@~2.0.0']);
  });

  it('fails clearly when a package has no peer range', () => {
    const broken: PackageManifest = { peerDependencies: {}, ablecredit: { installSets: { node: ['x'] } } };
    expect(() => planInstall(broken, 'node')).toThrow(/missing from peerDependencies/);
  });

  it('fails clearly when the install set is missing', () => {
    expect(() => planInstall({}, 'web')).toThrow(/no install set/);
  });
});

describe('findMissing', () => {
  it('reports packages that are not in node_modules of the project or its parents', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-test-'));
    mkdirSync(join(root, 'node_modules', 'a-pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'a-pkg', 'package.json'), '{}');
    const nested = join(root, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(findMissing(manifest, 'node', nested)).toEqual(['b-pkg']);
  });
});

describe('main', () => {
  it('prints usage and exits 2 with no arguments', () => {
    const { io, out } = fakeIo();
    expect(main([], manifest, io)).toBe(2);
    expect(out.join('\n')).toContain('Usage:');
  });

  it('rejects an unknown target', () => {
    const { io, err } = fakeIo();
    expect(main(['install', 'deno'], manifest, io)).toBe(2);
    expect(err.join('\n')).toContain('<node|web>');
    expect(isTarget('deno')).toBe(false);
  });

  it('runs npm install with the planned packages', () => {
    const { io, calls } = fakeIo();
    expect(main(['install', 'node'], manifest, io)).toBe(0);
    expect(calls).toEqual([['npm', ['install', 'a-pkg@^1.0.0', 'b-pkg@~2.0.0']]]);
  });

  it('--print shows the command without running it', () => {
    const { io, out, calls } = fakeIo();
    expect(main(['install', 'web', '--print'], manifest, io)).toBe(0);
    expect(out).toEqual(['npm install a-pkg@^1.0.0']);
    expect(calls).toEqual([]);
  });

  it('passes through a failing npm exit code and points at troubleshooting', () => {
    const { io, err } = fakeIo(process.cwd(), 1);
    expect(main(['install', 'node'], manifest, io)).toBe(1);
    expect(err.join('\n')).toContain('troubleshooting');
  });

  it('check exits 1 and names missing packages, 0 when all present', () => {
    const empty = mkdtempSync(join(tmpdir(), 'cli-empty-'));
    const missing = fakeIo(empty);
    expect(main(['check', 'node'], manifest, missing.io)).toBe(1);
    expect(missing.err.join('\n')).toContain('a-pkg');

    const root = mkdtempSync(join(tmpdir(), 'cli-full-'));
    for (const name of ['a-pkg']) {
      mkdirSync(join(root, 'node_modules', name), { recursive: true });
      writeFileSync(join(root, 'node_modules', name, 'package.json'), '{}');
    }
    const ok = fakeIo(root);
    expect(main(['check', 'web'], manifest, ok.io)).toBe(0);
  });
});
