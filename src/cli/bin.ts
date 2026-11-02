#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './index.js';
import type { PackageManifest } from './index.js';

// Thin executable wrapper: all behaviour lives in ./index.ts so it can be unit tested.
// dist/cli.js sits one level below the package root, next to package.json.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;

process.exitCode = main(process.argv.slice(2), manifest, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  cwd: process.cwd(),
  run: (command, args) => spawnSync(command, args, { stdio: 'inherit' }).status ?? 1,
});
