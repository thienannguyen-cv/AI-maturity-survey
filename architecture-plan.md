# AI Maturity Dashboard v1 - Execution Plan

## Why previous outputs may have felt unsatisfying
- Over-focused on one artifact (static dashboard code) but under-specified **data pipeline and semantic metric contract**.
- Weak separation between **data layer** and **presentation layer**, making iteration hard.
- Not enough **deployment/runbook detail** for self-serve operation.
- Lacked a **mirror UI for visual feedback loop**, which you explicitly need for fast revision.

## Confirmed decisions
- Gate A: Approved
- Gate B: Approved
- Cohort minimum threshold: 20
- Priority: speed + transparency + free-first architecture

## Free-first architecture
1. Survey -> webhook ingest.
2. Ingest worker validates, dedupes, writes raw + normalized records.
3. SQL semantic views compute maturity/tier/cohort metrics.
4. Metabase v1 reads views directly.
5. Weekly AI insight report with confidence tags.

## Deliverables
- `architecture-plan.html`: full visual architecture + mirror dashboard concept.
- `architecture-plan.md`: concise execution and governance summary.

## Next implementation phase
- Build ingest/service layer and SQL view files under version control.
- Wire dashboard to semantic views only (no business logic hidden in chart UI).
- Add data-quality and edge-case tests.
