<div align="center">

# 🏢 One Building, Many Tenants

### A multi-tenant performance-appraisal SaaS that takes *"your data stays yours"* very, very seriously

![NestJS 11](https://img.shields.io/badge/NestJS-11-e0234e)
![PostgreSQL 18](https://img.shields.io/badge/PostgreSQL-18%20%2B%20RLS-336791)
![React 19](https://img.shields.io/badge/React-19-61dafb)
![Prisma 7](https://img.shields.io/badge/Prisma-7-2d3748)
![Tests](https://img.shields.io/badge/tests-205%20green-3e7c4f)
![Coverage](https://img.shields.io/badge/API%20coverage-95%25-3e7c4f)
![Leaks](https://img.shields.io/badge/cross--tenant%20leaks-0-b04a12)

</div>

---

## 🤔 What is this?

Picture an office building. Many companies rent offices in it. They share the lift, the lobby and
the security guard, but **nobody gets into anybody else's office**. Ever.

This project is that building, in software:

| In the building 🏢 | In the code 💻 |
| --- | --- |
| The building | one code base + one PostgreSQL database |
| A company renting an office | a **tenant** (an organisation using the app) |
| The company's files | its users, review cycles, evaluations, audit log |
| The key to an office | a signed JWT carrying the tenant id |
| The security guard who *physically cannot* open the wrong door | **PostgreSQL Row-Level Security** |

The app itself? Employees fill in self-assessments, managers score their team, approvers approve,
and HR gets reports. Every organisation configures the rules its own way, and **not a single line
of code says "if this is customer X"**. 🙅‍♀️

## ✨ The fun parts

- 🛡️ **Five layers of isolation.** Even if a tired developer forgets `WHERE tenant_id = …`, the
  database itself hides the other tenant's rows. We *prove* it: an automated test attacks every API
  route with another tenant's ids, once with the app-level filter switched **off**. Result: 404s all
  the way down.
- 🎛️ **Configuration, not code.** Branding, feature flags, scoring scales, approval strategies: all data.
  A lint rule fails the build if anyone tries `if (tenant === 'acme')`.
- 🔁 **A real finite state machine.** Draft → self-assessed → manager-scored → approved → published.
  Each tenant's policy just prunes the edges.
- 🌙 **One build for everyone.** Each tenant gets its own colours, logo and language at runtime,
  including Persian with proper right-to-left layout. Dark mode included, obviously.
- 📦 **Take your data and go.** A tenant admin can export everything as checksummed JSON. An operator can
  restore it into a brand-new tenant with fresh ids, verified digests and foreign-key-ordered inserts
  (hello, topological sort 👋).
- 🤝 **No lost updates.** Two tabs editing the same evaluation? The second save gets a polite
  `412 Precondition Failed` instead of silently eating the first one's work.
- 📈 **Spot the noisy neighbour.** Per-tenant latency, errors and throttling, live in the operator console
  and as Prometheus metrics, with bounded cardinality so monitoring doesn't explode.

## 🚀 Run it in 5 minutes

You need **Node 22.12+** (24 recommended), **pnpm 11** and **PostgreSQL 18**.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # add your Postgres superuser URL + two JWT secrets
pnpm --filter @appraisal/contracts build
pnpm --filter @appraisal/api prisma:generate
pnpm --filter @appraisal/api db:bootstrap   # creates the database roles (no BYPASSRLS for anyone!)
pnpm db:reset                               # migrate + seed the demo world
pnpm dev                                    # API on :3000, web on :5173
```

Prefer containers? 🐳 `docker compose up --build` gives you Postgres, two API replicas behind
nginx, and the web app on http://acme.localhost:8080.

## 🗝️ Come on in (demo accounts)

Every password is `Demo-pass-2026`. Each person can only sign in **at their own company's address**.
Try the wrong one and watch the guard say no. 💂

| Address | Who lives here | Try logging in as |
| --- | --- | --- |
| http://acme.localhost:5173 | **Acme Robotics** 🤖 self-assessment + approval, English | `ada@acme.test` (admin) · `max@acme.test` (manager) · `eve@acme.test` (employee) · `hana@acme.test` (HR reviewer) |
| http://globex.localhost:5173 | **Globex Logistics** 🚚 no approval, 1–10 scale, **Persian RTL** | `gita@globex.test` (admin) · `kian@globex.test` (manager) · `sara@globex.test` (employee) |
| http://admin.localhost:5173 | **The building manager** 🏗️ create, suspend, restore tenants | `platform@appraisal.test` |
| http://localhost:3000/api/docs | 📚 OpenAPI docs | — |

> `*.localhost` resolves to your own machine in Chrome, Firefox and Edge, so there's no hosts-file fiddling.

## 🧪 Measured, not guessed

| | Question | Answer |
| --- | --- | --- |
| 🔐 | Can tenant A ever read tenant B's data? | **No.** Every route returns 404 for foreign ids, even with RLS as the *only* defence |
| ⚡ | What does Row-Level Security cost? | About **0 ms**: the predicate folds into the index lookup |
| 🏗️ | Shared schema vs schema-per-tenant? | New tenant in **~3.5 ms** vs ~220 ms |
| 🔊 | Can a 100× heavier neighbour hurt you? | Yes: p95 went **27 → 960 ms**. Rate limiting + query timeouts bring it back to **298 ms** |
| 🧩 | What does a new approval strategy cost? | One **18-line** class, zero customer-specific branches |
| 📚 | Do tenant-first indexes matter? | With 100 tenants: **~1 ms** vs 16–24 ms per audit page |

## ✅ Quality gates

```bash
pnpm typecheck    # TypeScript, everywhere
pnpm lint         # including the "no tenant-specific code" rule
pnpm boundaries   # module boundaries are walls, not suggestions
pnpm test         # 173 API + 21 contracts + 11 web tests
```

## 🗺️ Where to go next

- 🏛️ [Architecture](docs/architecture.md): the big picture, with diagrams
- 📝 [16 Architecture Decision Records](docs/adr): every "why", including the alternatives we said no to
- 🔬 [Experiments](docs/experiments/README.md): the numbers above, with method and raw results
- 🔧 [Technical README](docs/technical.md): full setup, the requirements → code → test traceability table, and the honest "what changed along the way" list
- 🇮🇷 [Persian summary](docs/report-fa.md)

## 💜 Made by

**Kimiya Khoshnood**, Software Engineer · Full-stack Developer.

An academic project: every company, person and evaluation in here is fictional.
No real employees were rated in the making of this repository. 😌
