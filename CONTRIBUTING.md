# Contributing

## Setup

```bash
npm ci                                   # JavaScript
cd python && uv venv && uv pip install -e ".[dev]"
```

## Checks (CI runs the same)

```bash
npm run lint && npm run typecheck && npm run build && npm test
cd python && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy && .venv/bin/pytest -q
```

Before changing code, read the [codebase map](docs/codebase-map.md): it says which file to edit for each kind of change.

## Standards

- Shared logic goes in `src/shared` (JavaScript) with unit tests; runtime entry points stay thin.
- Anything that sends data is tested against a local OTLP receiver, not only mocked.
- Both runtimes must read the same environment variables and behave the same way: update
  [docs/configuration.md](docs/configuration.md) with any change.
- Never add `--legacy-peer-deps`. If a peer range conflicts, fix the range.
- Defaults must be safe: off without an endpoint, no personal data, never throw into the host application.
- Keep dependency versions in a tested set. Raise them together and run the end-to-end tests. The package list for
  `npx ablecredit-telemetry install` lives in `package.json` (`ablecredit.installSets` + `peerDependencies`); a test fails
  if the two drift apart.
- Write docs for a beginner: say what the thing is, where to put the code, and how, with a copy-paste example.

## Releasing

1. Update [CHANGELOG.md](CHANGELOG.md) and the version in `package.json` and `python/pyproject.toml`.
2. Merge to `main` with CI green.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
4. Services upgrade by changing the tag in their dependency line.

Breaking changes (renamed options or environment variables, raised peer ranges) bump the major version.
