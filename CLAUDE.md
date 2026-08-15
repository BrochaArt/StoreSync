# CLAUDE.md

Guidance for Claude when working in this repository.

## Commit and PR rules

**No AI attribution anywhere.** Applies to every artifact that leaves this machine:

- Never add `Co-Authored-By: Claude <noreply@anthropic.com>` or any `Co-Authored-By` trailer naming an AI tool.
- Never add "Generated with Claude Code", "Made with AI", or any similar footer, badge, or sign-off.
- Never mention Claude, Anthropic, ChatGPT, Copilot, "AI-generated", "LLM", or "assistant" in: commit messages, branch names, PR titles, PR descriptions, issue titles or comments, release notes, changelog entries, or code comments.
- Write every commit as the repo author would. Imperative subject, no emoji, no filler.
- **Commit language: Spanish**, matching existing history (`validación cloud: despliegue ejecutado y E2E verde`).

## Sensitive data — never commit

Treat this repo as if it were public. This project brokers credentials between third-party stores and Supabase — a leak here compromises someone else's shop.

**Never stage:**
- `.env`, `.env.local`, `.env.cloud` or any variant except `.env.example`. Three env files live here; `.gitignore` covers `.env.*` — do not weaken it.
- **Shopify access tokens, API secrets, or webhook signing secrets** — per-shop tokens are the highest-value secret in this repo.
- Supabase service-role keys, JWT secrets, or the worker auth token.
- **`client_credentials` rows** (`007_client_credentials`) — API consumer IDs and secrets issued to downstream clients.
- Production dumps or fixtures containing real shop domains, real customer names, emails, phones, addresses, or order data.
- Real webhook payloads. Shopify order webhooks contain full customer PII — redact before pasting into `docs/` or a test.
- `docs/muestra-api-gateway.json` and similar samples must hold synthetic data only. Verify before committing an updated sample.

**Migrations (`supabase/migrations/`) and functions (`supabase/functions/`):**
- Schema, queue functions, RLS and cron definitions belong in git.
- Never hardcode a Shopify token, a service-role key, or a real shop domain. Read from env / Vault.
- `tests/*.sql` must seed obviously fake shops (`tienda-prueba`, `demo.myshopify.com`).

**Rules of thumb:**
- Every example value must be obviously fake: `demo.myshopify.com`, `shpat_xxx`, `cliente@example.com`.
- If a doc needs a real payload to be useful, keep the shape and redact the values.
- Never run `git add -A` or `git add .`. Stage explicit paths so nothing rides along.
- If unsure whether a file is sensitive, do not stage it — ask first.

## Commands

```bash
npm run typecheck            # tsc --noEmit
npm run onboard              # scripts/onboard-shop.ts — register a new shop
npm run import-catalog       # scripts/import-catalog.ts
npm run register-webhooks    # scripts/register-webhooks.ts
npm run create-api-consumer  # scripts/create-api-consumer.ts
npm run panel                # scripts/panel.ts — read-only sync panel
```

Shell tests in `tests/` (`test_receptor_webhooks.sh`, `test_worker_inbound.sh`, `simulacion_inbound.sh`) exercise the ingest path without a real Shopify token.

## Architecture

**StoreSync** synchronises Shopify stores into Supabase and exposes the result through an API gateway. There is no frontend — it is Supabase Edge Functions plus TypeScript operator scripts.

### Layout

```
supabase/functions/
  webhook/       # receives Shopify webhooks, enqueues
  worker-sync/   # drains the queue, writes to Postgres
  api-gateway/   # authenticated read API for downstream consumers
supabase/migrations/
  000_extensiones      001_schema_base       002_eventos_api
  003_funciones_colas  004_onboarding        005_ingesta_webhooks
  006_cron_worker      007_client_credentials 008_api_gateway
scripts/         # operator tooling (onboarding, catalog, webhooks, panel)
tests/           # SQL smoke tests + shell simulations
docs/ESTADO.md   # current state — read this first
docs/PENDIENTES.md
DECISIONES_TECNICAS_SYNC.md
```

### Start here

`docs/ESTADO.md` is the living state of the system and `docs/PENDIENTES.md` the open work. Read both before proposing changes — they are kept current deliberately, and they are cheaper than re-deriving context from the code.

### Conventions

- Ingest is queue-based: webhook enqueues, cron-driven worker drains. Never write to Postgres directly from the webhook path.
- Migrations are append-only and numbered. Never edit one that has run in production.
- The worker authenticates with a dedicated token, not the service-role key.
- Architectural decisions are recorded in `DECISIONES_TECNICAS_SYNC.md` — add to it rather than silently diverging.
