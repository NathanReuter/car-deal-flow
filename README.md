# Car Deal Flow

Decision-support pipeline for used-car purchases in Brazil. Harvests distress /
repossession / auction / repasse inventory into SQLite, scores each lead against
an active buying goal, and surfaces a triage pipeline (Kanban + table) in the
browser. It is decision support only — no bidding or purchase automation.

## Stack

Next.js 16 (App Router) · React 19 · Prisma 7 + SQLite · Tailwind v4 · Vitest ·
`tsx` harvest scripts (Playwright + stealth for SPA/Cloudflare sources).

## Setup

```bash
npm ci
echo 'DATABASE_URL="file:./dev.db"' > .env
npm run db:migrate
npm run db:seed        # seeds the active buying goal
npm run dev            # http://localhost:3000
```

## Harvesting leads

See the harvest skills (`.claude/skills/harvest-*`) and the orchestrator:

```bash
npm run harvest              # all sources
npm run harvest:olx          # a single source
npm run harvest:pre          # pre-repossession (repasse) phase
npm run harvest:auction      # auction phase
```

After a harvest, run the goal filter to soft-triage new leads:

```bash
npx tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
```

## Quality gates

```bash
npm run build && npm test && npm run lint
```

See `SPEC.md` for scope/boundaries and `docs/superpowers/specs/` +
`docs/superpowers/plans/` for design history.
