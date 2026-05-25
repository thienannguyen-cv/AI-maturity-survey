# AI Maturity Survey

A lightweight, content-driven web survey that evaluates **AI integration maturity** in software delivery teams.

This project is intentionally simple to run: open `index.html` in a browser (or serve the folder with a static file server), and the app loads survey content from YAML at runtime.

---

## Why this project exists

Teams increasingly use AI tools (agents, copilots, code assistants), but many struggle to evaluate maturity beyond subjective impressions. This survey provides:

- A **weighted maturity score**.
- A **group-level radar profile** across delivery capabilities.
- **Warning signals** (“worth reviewing”) that highlight potentially inconsistent self-assessments.
- Optional **context and feedback** collection to improve interpretation quality.

---

## Project structure

```text
.
├── index.html            # App shell, styling/theme setup, CDN dependencies, mount bootstrap
├── survey.jsx            # Main React app logic: flow, scoring, warnings, storage, result rendering
├── data.js               # Runtime YAML loader -> window.SURVEY_DATA
├── survey-content.yaml   # Source of truth for survey content/scoring/groups/tiers
└── AI Maturity Research Strategy Revision.docx
```

### Responsibility boundaries

- **`survey-content.yaml`** is the canonical place to edit survey content, wording, scoring weights, tiers, and question options.
- **`survey.jsx`** should contain app behavior and rendering logic (not business content text unless it is true UI chrome).
- **`data.js`** should stay focused on load/parse/validate/error-handling for content.

---

## Architecture at a glance

1. `index.html` loads React, Recharts, Babel Standalone, js-yaml, and project scripts from CDNs.
2. `data.js` fetches `survey-content.yaml`, parses it with `js-yaml`, validates minimum shape, then assigns `window.SURVEY_DATA`.
3. `survey.jsx` defines `window.Survey` and reads survey data through a lazy proxy.
4. A mount loop waits until dependencies and data are ready, then renders the app.

### Current trade-off

This architecture optimizes for **rapid iteration and low setup friction**, but has trade-offs:

- Browser-side Babel transpilation is slower than prebuilt bundles.
- CDN dependency strategy is convenient but less deterministic for long-term reproducibility.
- Monolithic `survey.jsx` can become harder to maintain as features grow.

---

## Features

- Bilingual UI (Vietnamese / English) toggle.
- Weighted scoring with N/A exclusion from denominator.
- Tier mapping from score percentage.
- Group-level radar visualization.
- Session persistence (storage adapter + localStorage fallback).
- Optional Formspree submission endpoint.
- Optional open-response + survey-feedback collection.
- “Worth reviewing” warning heuristics to flag cross-dimension inconsistencies.

---

## Local development

### Option A: open directly

Open `index.html` in your browser.

### Option B (recommended): static server

Using Python:

```bash
python3 -m http.server 8000
```

Then open: <http://localhost:8000>

> A static server is more reliable for `fetch()` behavior and mirrors deployment conditions better.

---

## Configuration points

In `survey.jsx`:

- `FORMSPREE_FORM_ID`: set to enable email submission.
- `DEPLOY`: controls visibility of internal-only review signals in ResultScreen.
- `COMMUNITY_DASHBOARD_URL`: external link destination.

In `survey-content.yaml`:

- `scoring`: default weight, N/A handling, tier metric notes.
- `tiers`: maturity band boundaries and recommendations.
- `groups`: radar group model.
- `questions`: scored question bank and option levels.

---

## Content editing workflow

1. Edit `survey-content.yaml`.
2. Refresh browser.
3. Verify loader/parsing behavior and UI rendering.
4. Spot-check scoring logic impact on total score, group profile, and warnings.

### Editing rules of thumb

- Keep question intent stable when changing wording.
- If adjusting weights, review tier calibration impact.
- If adding/removing questions, revisit warning rules that reference fixed IDs.

---

## Quality and validation checklist

Before shipping survey changes:

- YAML parses successfully.
- All referenced group IDs exist.
- All question options have `level` and `score`.
- Tier bands are contiguous and cover 0–100.
- Warning rules still reference valid question IDs.
- EN/VI text remains semantically aligned.

---

## Practical enhancement roadmap

If you want to improve the project quality, prioritize in this order:

1. **Split `survey.jsx` into modules**
   - `scoring.js`, `warnings.js`, `i18n.js`, `storage.js`, `components/*`.
   - Improves readability, testability, onboarding.

2. **Introduce a build system (e.g., Vite)**
   - Precompiled JSX, pinned dependency graph, faster startup.

3. **Add schema validation for YAML**
   - Validate content structure with JSON Schema/Zod-like checks before runtime usage.

4. **Add automated tests**
   - Unit tests for scoring/tier/warning logic.
   - Snapshot tests for key UI states.

5. **Strengthen observability**
   - Structured analytics for question completion drop-offs and warning frequency.

6. **Harden privacy/compliance docs**
   - Explicit retention policy for submissions and feedback handling process.

---

## Suggested learning path for contributors

- Start with `survey-content.yaml` to understand the domain model.
- Read scoring/warning helpers in `survey.jsx` next.
- Trace app flow: Welcome → Questions → Result → Feedback.
- Finally inspect loader and mount sequence in `data.js` + `index.html`.

---

## Known limitations

- No formal package/dependency lock.
- Limited runtime error telemetry.
- Warning heuristics are useful but not universally valid conclusions.
- Current implementation is browser-centric and not yet optimized for large-scale production governance.

---

## License

No license file is currently included in this repository.
If you plan to open-source broadly, add a `LICENSE` (e.g., MIT/Apache-2.0) and mention it here.
