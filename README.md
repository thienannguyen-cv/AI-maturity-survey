# AI Maturity Survey

A lightweight, content-driven web survey for assessing **AI integration maturity** in software delivery projects.

The survey is designed for producers, product/delivery leaders, and software teams that want a structured way to discuss how mature their AI-assisted delivery practices are. It focuses on practical delivery signals rather than generic enthusiasm about AI tooling.

## What The Survey Measures

The current survey model includes:

- **4 context questions** about respondent role, team size, AI adoption duration, and project risk profile.
- **15 scored maturity questions** grouped into 5 capability areas.
- **Weighted scoring** so foundational/high-risk capabilities matter more than supporting capabilities.
- **N/A handling** that excludes non-applicable questions from the denominator instead of penalizing the respondent.
- **Group-level radar profile** for scanning relative strengths and weaknesses.
- **Worth-reviewing signals** that flag potentially inconsistent self-assessments.
- Optional per-question context and final improvement feedback.

The 5 capability groups are:

- Delivery Planning & Scope
- Context & Reusable Knowledge
- Quality, HITL & Evals
- Harness, Operations & Governance
- Agent Capability & Team Enablement

## Interpretation Limits

The result is a **reference and positioning tool**, not a certification, independent audit, or absolute conclusion about team capability.

The score should be read together with project context, open responses, and follow-up discussion. Warning signals are especially useful as prompts for review, but they are not final judgments by themselves.

## Methodology

The survey content and scoring model are based on the companion research/design document:

[AI Maturity Research Strategy Revision](AI%20Maturity%20Research%20Strategy%20Revision.docx)

The same methodology link is also shown inside the survey welcome screen.

## Privacy And Data Handling

The survey does not ask for personal names, email addresses, company names, client names, or specific project names.

Responses are stored locally in the browser while the respondent is in progress. On submission, the app can also send a JSON payload to a configured Formspree endpoint and store an anonymous aggregate copy through the storage adapter when available.

Free-text fields are intended for high-level context only. Respondents should not enter credentials, customer data, internal secrets, identifiable project details, or anything they are not authorized to share. Raw free-text feedback should not be published verbatim; aggregate statistics are the intended public/community-dashboard use case.

Downloaded files named like `ai-maturity-*.json` are result exports. Treat them as data artifacts, not source code; do not commit them unless they are intentionally sanitized samples.

## Features

- Vietnamese / English language switch.
- Runtime YAML content loading.
- Weighted maturity scoring with configurable question weights.
- 5-tier maturity mapping based on percent of applicable weighted score.
- N/A exclusion from applicable maximum score.
- Interactive radar visualization with group focus.
- Creator-only preview sections for warning signals and per-question breakdown.
- Session persistence with `window.storage` support and `localStorage` fallback.
- Optional Formspree email submission.
- Downloadable JSON result export.
- Creator-only review signals controlled by `DEPLOY`.

## Project Structure

```text
.
├── index.html            # App shell, styling/theme setup, CDN dependencies, mount bootstrap
├── data.js               # Runtime YAML loader -> window.SURVEY_DATA
├── survey.jsx            # Main React app logic: flow, scoring, warnings, storage, result rendering
├── survey-content.yaml   # Source of truth for survey content/scoring/groups/tiers/translations
└── AI Maturity Research Strategy Revision.docx
```

### Responsibility Boundaries

- `survey-content.yaml` is the canonical place to edit survey content, scoring weights, groups, tiers, methodology link, and EN/VI translations.
- `survey.jsx` should contain app behavior, scoring/rendering logic, warning heuristics, and UI chrome.
- `data.js` should stay focused on loading, parsing, validating, and exposing YAML content.
- `index.html` should stay focused on page shell, CDN dependencies, theme setup, and mount bootstrap.

## Architecture

1. `index.html` loads React, Recharts, Babel Standalone, js-yaml, and project scripts from CDNs.
2. `data.js` fetches `survey-content.yaml`, parses it with `js-yaml`, validates the minimum shape, then assigns `window.SURVEY_DATA`.
3. `survey.jsx` defines `window.Survey` and reads survey data through a lazy proxy so the app can parse before YAML finishes loading.
4. The mount script waits until dependencies and survey data are ready, then renders the app.

This architecture optimizes for **low setup friction and fast content iteration**. The trade-off is that browser-side Babel and CDN dependencies are less production-grade than a bundled build with pinned dependencies.

## Running Locally

Use a static server from the repository root:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Opening `index.html` directly may work in some browsers, but a static server is recommended because the app loads `survey-content.yaml` with `fetch()`.

## Configuration

In `survey.jsx`:

- `FORMSPREE_FORM_ID`: enables or disables email submission. Set it to `null` to keep results local/downloadable only.
- `DEPLOY`: controls whether creator-only review sections are hidden from real participants.
- `COMMUNITY_DASHBOARD_URL`: controls the link destination for the community dashboard mention.

In `survey-content.yaml`:

- `survey`: title, disclaimer, methodology link.
- `scoring`: default weight, N/A handling, scoring note, weight guidance.
- `survey_feedback`: final optional feedback prompt.
- `demographics`: unscored context questions.
- `groups`: capability group model used by the radar.
- `tiers`: maturity band boundaries and recommendations.
- `questions`: scored question bank, options, weights, and notes.
- `translations.en`: English text used by the language switch.

## Survey Flow

```text
Welcome -> Context questions -> Maturity questions -> Improvement feedback -> Results
```

The improvement feedback step is optional and does not affect maturity scoring.

## Content Editing Workflow

1. Edit `survey-content.yaml`.
2. Serve the repository locally.
3. Refresh the browser.
4. Check both Vietnamese and English views.
5. Spot-check scoring impact on total score, group radar, and warning signals.

### Editing Rules Of Thumb

- Keep question intent stable when changing wording.
- Keep EN/VI translations semantically aligned.
- If adjusting weights, review tier calibration impact.
- If adding/removing questions, revisit warning rules that reference fixed question IDs.
- If changing groups, verify every question still references a valid group ID.

## Validation Checklist

Before shipping survey changes:

- YAML parses successfully.
- All question IDs are unique.
- All referenced group IDs exist.
- Each scored question has 5 options.
- Each option has both `level` and `score`.
- Question weights are intentional and documented by the scoring note.
- Tier bands cover 0-100 without gaps.
- Warning rules reference valid question IDs.
- EN/VI text remains aligned.
- The result payload still includes `language`, demographics, answers, open responses, survey feedback, summary, and warnings.

## Practical Enhancement Roadmap

1. **Split `survey.jsx` into modules**
   - Suggested modules: `scoring.js`, `warnings.js`, `i18n.js`, `storage.js`, `submission.js`, `components/*`.
   - This would improve maintainability, reviewability, and testability.

2. **Introduce a build system**
   - Vite or a similar small setup would remove browser-side Babel and allow pinned dependencies.

3. **Add schema validation for YAML**
   - JSON Schema, Zod, or a lightweight custom validator would catch content mistakes before runtime.

4. **Add automated tests**
   - Unit tests for scoring, tier mapping, N/A handling, warning rules, and localization fallback.

5. **Improve privacy/compliance documentation**
   - Add explicit retention policy, submission handling process, and community-dashboard aggregation rules.

6. **Add analytics carefully**
   - Track aggregate completion/drop-off and warning frequency without collecting identifying information.

## Known Limitations

- No package/dependency lock is currently included.
- Runtime dependency loading depends on public CDNs.
- Browser-side JSX transpilation is convenient but not ideal for production scale.
- Warning heuristics are useful review prompts, not universal conclusions.
- The app is intentionally static-first and does not yet include a dedicated backend or admin console.

## License

No license file is currently included in this repository. If the project is intended for broader open-source reuse, add a `LICENSE` file and mention the selected license here.
