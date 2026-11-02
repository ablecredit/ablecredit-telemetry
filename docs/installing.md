# Installing

This package is **not** on the npm or PyPI registries. You install it straight from its GitHub repository, so there is
no registry account and no npm token.

Replace `ablecredit/ablecredit-telemetry` below if the repository lives somewhere else.

## Step 0: choose HTTPS or SSH

Both work. Which one you can use depends on who can see the GitHub repository:

| Repository is... | HTTPS (`git+https://...`) | SSH (`git+ssh://...`) |
|---|---|---|
| **Public** | Works, no credentials at all. | Works if the machine has a GitHub SSH key. |
| **Private** | Needs a credential (a token or a configured credential helper). | Works with an SSH key added to GitHub. **No token.** |

So, if you do not want tokens:

- **Public repository:** use HTTPS. Nothing else to set up.
- **Private repository:** use SSH. Your own machine already has a key. For Docker and CI, use a read-only *deploy key*
  (an SSH key, not a token), see [Docker](#docker) and [CI](#github-actions).

The package contains setup code only (no secrets, no customer data), so keeping it public is a reasonable choice if your
organisation allows it.

## Step 1: install the package

Always pin a **tag** (`v0.1.0`), never a branch, so everyone builds the same code. The tag must exist in GitHub; until
the first release is tagged you can use `#main` for experiments (not for production).

### JavaScript (Node.js server or frontend)

```bash
# HTTPS
npm install "git+https://github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"

# SSH
npm install "git+ssh://git@github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"
```

The package builds itself during install (you will see a short build step). Commit the changed `package.json` and
`package-lock.json`.

> Use the **same form (HTTPS or SSH) across your team and your build servers.** `package-lock.json` remembers the exact
> URL, so a machine that can only reach GitHub one way will fail on a lockfile written the other way.

### Step 2 (JavaScript only): install the OpenTelemetry packages

The library needs the official OpenTelemetry packages next to it. One command installs the exact, tested versions:

```bash
npx ablecredit-telemetry install node    # for a Node.js server
npx ablecredit-telemetry install web     # for a browser app
```

Check it worked:

```bash
npx ablecredit-telemetry check node      # prints OK, or lists what is missing
```

Using pnpm or yarn? Print the command and run it with your tool:

```bash
npx ablecredit-telemetry install node --print
```

Why is this a separate step? A browser app and a server need different packages, and OpenTelemetry must exist only once
in your project. Making them "peer dependencies" gives you exactly the ones you need. If `npm` complains about
conflicting versions, see [Troubleshooting](troubleshooting.md#npm-install-reports-eresolve--peer-dependency-conflict).
**Do not** use `--legacy-peer-deps`.

A frontend and a backend in the same repository can run both commands (`node` and `web`); they do not conflict.

### Python

```bash
# HTTPS, with uv
uv add "ablecredit-telemetry[fastapi,httpx,botocore] @ git+https://github.com/ablecredit/ablecredit-telemetry.git@v0.1.0#subdirectory=python"

# SSH, with uv
uv add "ablecredit-telemetry[fastapi,httpx,botocore] @ git+ssh://git@github.com/ablecredit/ablecredit-telemetry.git@v0.1.0#subdirectory=python"

# pip: same string
pip install "ablecredit-telemetry[fastapi,httpx,botocore] @ git+https://github.com/ablecredit/ablecredit-telemetry.git@v0.1.0#subdirectory=python"
```

The part in square brackets chooses optional features. Keep only what you use:

| Extra | Adds |
|---|---|
| `fastapi` | Tracing of every FastAPI request |
| `httpx` | Tracing of outgoing `httpx` calls |
| `botocore` | Tracing of AWS calls (S3, SQS, ...) |

`#subdirectory=python` is needed because the Python package lives in the `python/` folder of the repository.
Python 3.10 or newer.

## Docker

Installs happen at image build time, so the build needs the same access as your machine.

**Public repository + HTTPS:** nothing special, but the build stage needs `git`. The full `node:` image has it;
`node:*-slim` does not, so install dependencies in a full-image build stage (the `collector` Dockerfile already does,
in its `builder` stage).

**Private repository + SSH:**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24 AS builder
RUN mkdir -p -m 0700 ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts
COPY package*.json ./
RUN --mount=type=ssh npm ci --omit=dev
```

```bash
docker build --ssh default .
```

`--omit=dev` is fine: the package builds itself with its own tools.

### Building on your own machine (private repository)

If you build and push images from your laptop (for example with a deploy script that runs `docker build`), you do not need
a deploy key or a token. Docker can borrow the SSH key your machine already uses for GitHub.

1. Check that GitHub accepts your key and that it is loaded in the agent:
   ```bash
   ssh -T git@github.com      # "Hi <you>! You've successfully authenticated..."
   ssh-add -l                 # lists your key; if empty: eval "$(ssh-agent)" && ssh-add
   ```
2. Install the dependency with the **SSH** form, so `package-lock.json` records an SSH address (the build cannot use HTTPS
   for a private repository):
   ```bash
   npm install "git+ssh://git@github.com/ablecredit/ablecredit-telemetry.git#v0.1.0"
   ```
3. In the Dockerfile, add the syntax line, trust GitHub's host key, and mount the SSH agent for the install step only:
   ```dockerfile
   # syntax=docker/dockerfile:1
   FROM node:24 AS builder
   WORKDIR /app
   RUN mkdir -p -m 0700 /root/.ssh && ssh-keyscan github.com >> /root/.ssh/known_hosts
   COPY package.json package-lock.json ./
   RUN --mount=type=ssh npm ci --omit=dev
   ```
4. Add `--ssh default` to the build command:
   ```bash
   docker build --ssh default --platform linux/amd64 -t my-image:tag .
   ```

Your key is never copied into the image: `--mount=type=ssh` exists only while that one `RUN` step executes, and the
`known_hosts` file sits in a build stage that a multi-stage Dockerfile discards. This needs BuildKit, which current Docker
versions use by default.

**Remember:** this only works where your key is available. A build that runs somewhere else (a CI server, a teammate's
machine without a key) fails with `Permission denied (publickey)` until it has its own access; see
[GitHub Actions](#github-actions).

## GitHub Actions

**Public repository + HTTPS:** no setup.

**Private repository + SSH:** add a read-only deploy key to the telemetry repository, store its private half as a
secret in the service's repository, and load it before building:

```yaml
- uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.TELEMETRY_DEPLOY_KEY }}
- run: docker build --ssh default .
```

## Upgrading

1. Read [CHANGELOG.md](../CHANGELOG.md) for the new version.
2. JavaScript:
   ```bash
   npm install "git+https://github.com/ablecredit/ablecredit-telemetry.git#v0.2.0"
   npx ablecredit-telemetry install node     # versions of the OpenTelemetry packages may change
   npx ablecredit-telemetry check node
   ```
   Python: change `@v0.1.0` to `@v0.2.0` in `pyproject.toml`, then run `uv lock` and `uv sync`.
3. Run your tests, deploy to a test environment, and check SigNoz.

## Removing it

```bash
npm uninstall @ablecredit/telemetry          # JavaScript
uv remove ablecredit-telemetry               # Python
```

Then delete the one start-up line you added. Nothing else in your code depends on it.
