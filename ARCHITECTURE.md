# AI Maturity Community Dashboard Architecture (MVP v1)

## Why previous outputs may have failed

From your long prompt, common failure modes are:
- Not separating **plan/approval** from **implementation artifacts**.
- Not providing a **single deployable architecture source of truth**.
- Not including a **UI mirror** that lets you give visual feedback before real data volume exists.
- Not proving logic with **real tests/data checks** (integrity, constraints, edge cases).

## Agreed decisions
- Gate A: Approved.
- Gate B: Approved.
- Cohort minimum sample: **20**.
- Priorities: **100% free MVP**, fast iteration, transparent SQL-first logic.
- Recommended rollout: Metabase-first with migration-safe data layer.

## System components
1. Survey source (existing Vercel app)
2. Ingest endpoint (free serverless)
3. Raw storage table
4. Normalized analytics tables
5. Semantic views (metric definitions)
6. Dashboard (Metabase v1)
7. Weekly insight generator
8. Data quality checks + alerts

## Data flow
1. Survey submission arrives as JSON.
2. Ingest validates, fingerprints, stores raw payload.
3. Transformer maps payload to response/demographic/question-answer tables.
4. Metric jobs compute scores and cohort views.
5. Dashboard reads semantic views only.
6. Insight job summarizes only cohorts with n >= 20.

## Suggested repo structure
- `architecture/ARCHITECTURE.html` (visual source of truth)
- `architecture/ARCHITECTURE.md` (engineer-readable companion)
- `sql/schema/*.sql` (tables)
- `sql/views/*.sql` (metrics/cohorts)
- `ingest/*` (webhook + transform code)
- `checks/*` (DQ and edge-case tests)

## SQL contracts (core)
- `maturity_percent = total_weighted_score / applicable_max * 100`
- `applicable_max`: excludes N/A answers
- `cohort_confidence`: low when n < 20

## Validation checklist
- Integrity: required keys, foreign keys, unique constraints.
- Boundaries: levels only in [1..5] or N/A.
- Duplicates: same session burst deduped.
- Versioning: survey_version always persisted.

## Deployment (free-first)
- Ingest/API: Cloudflare Workers free tier.
- DB: Cloudflare D1 free tier.
- Dashboard: Metabase free (self-host or free container target).
- CI checks: GitHub Actions free.

## Iteration protocol
- Every change ships with:
  - updated metric/query SQL
  - updated architecture HTML section
  - smoke checks evidence
- You review via visual mirror + diff-based SQL changes.
