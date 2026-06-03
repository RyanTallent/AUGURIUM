# AUGURIUM

Prediction Market Intelligence Platform — monitor prediction markets, score traders, generate signals, and manage portfolio allocation.

## Stack

- **Web:** Next.js + TypeScript + React
- **Workers:** Node.js + TypeScript
- **Database:** PostgreSQL + Prisma
- **Events:** Redis
- **Monorepo:** npm workspaces

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start Postgres + Redis
npm run docker:up

# 3. Copy env and push schema
copy .env.example .env
npm run db:generate
npm run db:push

# 4. Run ingestion worker (Phase A) — separate terminal
npm run dev:worker

# 5. Run the dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

See **AUGURIUM_TARGET_ARCHITECTURE.md** (locked target) and **AUGURIUM_GAP_ANALYSIS.md** (audit).

**Current phase: A** — Polymarket ingestion (markets, trades, wallets, positions). Scoring, signals, and execution are intentionally disabled until later phases.

## GitHub workflow (Cursor → GitHub)

This repo is set up so **commit in Cursor, push to GitHub** is the only loop you need.

1. **One-time:** log into GitHub CLI and create the remote repo (see below).
2. **Daily:** make changes in Cursor → **Source Control** → commit message → **Commit**.
3. **Sync:** click **Sync/Push** (or `git push`) — changes land on GitHub.

### One-time GitHub setup

```powershell
gh auth login
gh repo create AUGURIUM --private --source=. --remote=origin --push
```

If the repo already exists on GitHub:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/AUGURIUM.git
git push -u origin main
```

After that, every commit + push in Cursor updates GitHub automatically.

## Project layout

```
apps/web          Next.js dashboard
apps/worker       Background jobs (ingestion, scoring, signals)
packages/database Prisma schema + client
packages/shared   Shared types and constants
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start web dashboard |
| `npm run dev:worker` | Start background worker |
| `npm run docker:up` | Start Postgres + Redis |
| `npm run db:studio` | Open Prisma Studio |
