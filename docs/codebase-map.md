# Codebase map

Where everything lives, and where to make a change. Read this before changing the library itself.

## The repository at a glance

```
ablecredit-telemetry/
├── package.json            JavaScript package: name, versions, entry points, the OpenTelemetry package lists
├── src/
│   ├── shared/             logic used by both browser and Node (no OpenTelemetry SDK needed)
│   │   ├── config.ts         reads options + environment variables into one settings object
│   │   ├── span.ts           setSpanAttributes, withSpan, getTraceId
│   │   └── types.ts          shared TypeScript types
│   ├── web/index.ts        browser entry: initWebTelemetry
│   ├── node/
│   │   ├── index.ts          Node entry: startTelemetry
│   │   └── register.ts       the file behind `node --require ...`
│   └── cli/                the `ablecredit-telemetry` command (install / check)
│       ├── index.ts          the logic (unit tested)
│       └── bin.ts            thin executable wrapper
├── tests/                  JavaScript tests (including an end-to-end export to a local receiver)
├── python/
│   ├── pyproject.toml      Python package definition and tool settings
│   ├── src/ablecredit_telemetry/
│   │   ├── config.py         options + environment variables
│   │   ├── setup.py          setup_telemetry: creates and registers the providers
│   │   ├── spans.py          set_span_attributes, span, get_trace_id
│   │   ├── propagation.py    carrying the trace over HTTP headers and SQS
│   │   └── instrumentation.py  FastAPI, httpx and botocore helpers
│   └── tests/
├── docs/                   all documentation
└── .github/workflows/ci.yml  the checks that must pass
```

## "I want to change X": where do I go?

| I want to... | Change | Also update |
|---|---|---|
| Add or rename an environment variable | `src/shared/config.ts` and `python/.../config.py` (keep them identical) | `docs/configuration.md`, tests in both languages |
| Change what the Node server tracks | `src/node/index.ts` (`getNodeAutoInstrumentations` options) | `docs/node.md` |
| Add a browser instrumentation | `src/web/index.ts` | `docs/web.md`; add the package to `package.json` (see next row) |
| Add or upgrade an OpenTelemetry package | `package.json`: `devDependencies`, `peerDependencies`, `peerDependenciesMeta`, and the matching list in `ablecredit.installSets` | `CHANGELOG.md`, run all tests |
| Add a helper function used in both browser and Node | `src/shared/span.ts`, then re-export from `src/web/index.ts` and `src/node/index.ts` | `docs/recipes.md` |
| Add a Python helper | the matching module in `python/src/ablecredit_telemetry/`, export it in `__init__.py` | `docs/python.md`, tests |
| Support another Python library (e.g. a database) | `python/.../instrumentation.py` and an extra in `pyproject.toml` | `docs/installing.md`, `docs/python.md` |
| Change a default (ignored paths, export interval) | the option's default in the entry file | `docs/configuration.md` |
| Change a convention (attribute names, privacy rules) | `docs/conventions.md` only | |

## Rules of thumb

- **Keep entry files thin.** Anything that can be tested without OpenTelemetry running goes in `src/shared` (or a
  Python module that does not import the SDK).
- **Both languages behave the same.** The same environment variables, the same defaults, the same "off unless an endpoint
  is set" rule.
- **Never throw into the host application.** Telemetry must not be able to break a service.
- **Tests that send data use a real local receiver,** not only mocks.
- **Docs are part of the change.** A change without a docs update is not finished.

## Running the checks

See [CONTRIBUTING.md](../CONTRIBUTING.md#checks-ci-runs-the-same).
