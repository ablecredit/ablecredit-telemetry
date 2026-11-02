# Changelog

All notable changes are recorded here. Versions follow [semver](https://semver.org); consumers pin a git tag
(for example `#v0.1.0`).

## 0.1.0

Initial release.

- `@ablecredit/telemetry/web`: browser tracing (document load, fetch, XHR, uncaught errors).
- `@ablecredit/telemetry/node`: Node.js traces, metrics and logs, plus `node/register` for `--require`.
- `ablecredit-telemetry` command: `install <node|web>` installs the tested OpenTelemetry peer packages, `check` lists missing ones.
- Node: the last batch is flushed on SIGTERM/SIGINT and when the process finishes by itself.
- `ablecredit-telemetry` (Python): traces, metrics and logs, FastAPI/httpx/botocore helpers, SQS trace propagation,
  extra exporters for dual export (for example Axiom during a migration).
