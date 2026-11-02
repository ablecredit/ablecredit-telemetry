# Documentation

Pick the row that matches what you are doing.

## I am new

1. [Getting started](getting-started.md): what monitoring is, the words you will see, what happens when you turn it on.
2. The guide for your language: [Node.js server](node.md), [Browser frontend](web.md), [Python service](python.md).
3. [Recipes](recipes.md): copy-paste answers to "how do I...".

## I need to do something specific

| Task | Where |
|---|---|
| Install the package (HTTPS or SSH, Docker, CI) | [installing.md](installing.md) |
| Add telemetry to a Node.js server | [node.md](node.md) |
| Add telemetry to the React frontend | [web.md](web.md) |
| Add telemetry to a Python service | [python.md](python.md) |
| Find traces for one application in SigNoz | [recipes.md](recipes.md#find-every-trace-for-one-application) |
| Connect frontend and backend into one trace | [recipes.md](recipes.md#connect-the-browser-and-the-backend-into-one-trace) |
| Follow a job across a queue | [recipes.md](recipes.md#follow-a-background-job-across-a-queue) |
| Turn telemetry off | [recipes.md](recipes.md#turn-telemetry-off) |
| Send to Axiom and SigNoz at once | [python.md](python.md#dual-export-axiom-and-signoz) |
| Upgrade to a new version | [installing.md](installing.md#upgrading) |

## Reference

- [Configuration](configuration.md): every environment variable and option.
- [Conventions](conventions.md): naming rules, and what must never be recorded.
- [Troubleshooting](troubleshooting.md): symptoms and fixes.

## For maintainers

- [Architecture and decisions](architecture.md): why it is built this way.
- [Codebase map](codebase-map.md): which file does what, and where to make a change.
- [Contributing](../CONTRIBUTING.md): running checks and releasing.
