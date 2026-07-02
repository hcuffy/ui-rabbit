# UI-Rabbit

Open-source AI agent: takes a plain-language charter prompt, drives a web app's UI via [Playwright](https://playwright.dev), finds issues, and remembers prior runs so each run suppresses known noise and surfaces only what changed. "CodeRabbit for UI." First target: rabbit.

All-TypeScript/Node monorepo (pnpm workspaces). See [`UI-Rabbit-Build-Plan.md`](./UI-Rabbit-Build-Plan.md) for full architecture, stack, and the D1–D7 deliverable roadmap.

## Current state

D1 — repo + infra skeleton. The `shared` package has real Zod schemas (`Finding`/`Run`/`AppMap`/`Baseline`); `engine`/`driver`/`backend`/`frontend` are placeholders pending their own deliverables.

## Quickstart

```bash
git clone git@github.com:hcuffy/ui-rabbit.git && cd ui-rabbit
cp .env.example .env
docker compose up -d        # Mongo (requires Docker Compose v2 plugin)
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm --filter shared test
```

## Running against an authenticated environment

Two options — auto-login is preferred (session never stale); storageState is the fallback.

### Option A — Auto-login (preferred)

Set all six vars in `.env`; the backend logs in fresh before every run:

```
TARGET_LOGIN_URL=https://your-dev-env.example.com/login
TARGET_EMAIL=test-account@example.com
TARGET_PASSWORD=...
TARGET_EMAIL_SELECTOR=[data-cy-id="email"]
TARGET_PASSWORD_SELECTOR=[data-cy-id="password"]
TARGET_SUBMIT_SELECTOR=[data-cy-id="submit"]
```

**Guardrails:** use a low-privilege throwaway account on an isolated sandbox only. Never a real or shared account. The password never appears in logs or run records.

If login fails (wrong credentials, captcha, 2FA), the run is marked `FAILED` with a clear reason and no unauthenticated page is captured. For captcha / 2FA, fall back to Option B.

### Option B — Storage state (fallback)

Capture a session once with Playwright codegen, then point the backend at it.

**1. Capture — run from repo root:**

```bash
npx playwright codegen \
  --save-storage="$(pwd)/.ui-rabbit/auth.json" \
  https://your-dev-env.example.com
```

Log in through the browser that opens. Close it; Playwright writes the session to `.ui-rabbit/auth.json` (gitignored).

**2. Set in `.env`** (absolute path — relative paths break when backend cwd differs):

```
STORAGE_STATE_PATH=/absolute/path/to/.ui-rabbit/auth.json
```

**3. Restart the backend.** If the file is absent or the var is unset, runs proceed unauthenticated. Auto-login takes precedence when all six `TARGET_*` vars are set.

## License
MIT — see [LICENSE](./LICENSE).
