import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * `ablecredit-telemetry` command line helper.
 *
 *   ablecredit-telemetry install <node|web> [--print]   install the OpenTelemetry packages a runtime needs
 *   ablecredit-telemetry check   <node|web>             report which of them are missing
 *
 * The package list and versions live in this package's own package.json (`ablecredit.installSets` and
 * `peerDependencies`), so there is a single place to update them.
 */

export type Target = 'node' | 'web';

export interface PackageManifest {
  peerDependencies?: Record<string, string>;
  ablecredit?: { installSets?: Partial<Record<Target, string[]>> };
}

export const TARGETS: readonly Target[] = ['node', 'web'];

export function isTarget(value: string | undefined): value is Target {
  return TARGETS.includes(value as Target);
}

/** `name@range` for every package the runtime needs. Throws if the manifest is inconsistent. */
export function planInstall(manifest: PackageManifest, target: Target): string[] {
  const names = manifest.ablecredit?.installSets?.[target];
  if (!names?.length) throw new Error(`package.json has no install set for "${target}"`);
  const peers = manifest.peerDependencies ?? {};
  return names.map((name) => {
    const range = peers[name];
    if (!range) throw new Error(`"${name}" is in the "${target}" install set but missing from peerDependencies`);
    return `${name}@${range}`;
  });
}

/** True if `name` is installed in `startDir` or any parent directory's node_modules. */
export function isInstalled(name: string, startDir: string): boolean {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function findMissing(manifest: PackageManifest, target: Target, startDir: string): string[] {
  return planInstall(manifest, target)
    .map((spec) => spec.slice(0, spec.lastIndexOf('@')))
    .filter((name) => !isInstalled(name, startDir));
}

export interface Io {
  out(line: string): void;
  err(line: string): void;
  cwd: string;
  /** Runs a command and returns its exit code. */
  run(command: string, args: string[]): number;
}

const USAGE = `ablecredit-telemetry: set up OpenTelemetry packages for your project

Usage:
  ablecredit-telemetry install <node|web> [--print]
      Install the OpenTelemetry packages this library needs.
      node = a Node.js server (Fastify, Express, workers)
      web  = a browser app (React, Vite)
      --print shows the command instead of running it (use with pnpm or yarn).

  ablecredit-telemetry check <node|web>
      List which of those packages are missing from your project.
`;

export function main(argv: string[], manifest: PackageManifest, io: Io): number {
  const [command, target, ...flags] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.out(USAGE);
    return command ? 0 : 2;
  }
  if ((command !== 'install' && command !== 'check') || !isTarget(target)) {
    io.err(`Expected: ${command === 'check' ? 'check' : 'install'} <node|web>\n`);
    io.err(USAGE);
    return 2;
  }

  if (command === 'check') {
    const missing = findMissing(manifest, target, io.cwd);
    if (missing.length === 0) {
      io.out(`OK: every OpenTelemetry package needed for "${target}" is installed.`);
      return 0;
    }
    io.err(`Missing ${missing.length} package(s) for "${target}":\n  ${missing.join('\n  ')}`);
    io.err(`\nFix it with: npx ablecredit-telemetry install ${target}`);
    return 1;
  }

  const specs = planInstall(manifest, target);
  const printOnly = flags.includes('--print');
  const args = ['install', ...specs];
  if (printOnly) {
    io.out(`npm ${args.join(' ')}`);
    return 0;
  }
  io.out(`Installing ${specs.length} packages for "${target}"...`);
  const code = io.run('npm', args);
  if (code !== 0) io.err('\nnpm install failed. See docs/troubleshooting.md ("npm install reports ERESOLVE").');
  return code;
}
