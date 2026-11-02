import { defineConfig } from 'tsup';

// Peer dependencies are external by default, so nothing from OpenTelemetry is bundled.
export default defineConfig([
  {
    entry: {
      web: 'src/web/index.ts',
      node: 'src/node/index.ts',
      register: 'src/node/register.ts',
    },
    format: ['esm', 'cjs'],
    // tsup injects `baseUrl` for its type build, which TypeScript 6 flags as deprecated.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    sourcemap: true,
    clean: false,
    target: 'es2022',
    splitting: true,
  },
  {
    // The command line helper only runs as a script, so a single ES module is enough.
    entry: { cli: 'src/cli/bin.ts' },
    format: ['esm'],
    sourcemap: true,
    clean: false,
    target: 'es2022',
  },
]);
