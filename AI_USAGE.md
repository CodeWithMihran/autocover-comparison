# AI usage

This log summarizes the AI assistance used to build AutoCover. Generated changes were refined during implementation and checked with the automated checks below. I manually exercised the deployed app and MongoDB-backed flows; I am responsible for understanding and explaining the code during review.

## Tools used

- **Claude AI** — helped break down the assignment and plan an implementation sequence. The original prompt was not retained, so it is summarized below rather than quoted.
- **OpenAI Codex desktop** — assisted with source-file inspection, TypeScript implementation and review, debugging, UI work, documentation, and deployment configuration.
- **Codex web search** — consulted public insurer add-on information for the glossary and official hosting documentation for deployment guidance. URLs used for insurer research are recorded in `docs/addon-glossary.md`.
- **Codex browser/computer-use** — attempted a local UI preview, but the preview browser could not reach the local development server. The deployed app was subsequently checked manually in the browser.

## Main prompts, in order

The prompts below are concise summaries of the main requests; routine follow-ups and troubleshooting messages are omitted.

1. **Assignment planning (Claude):** summarize the requirements, propose a practical build plan, and recommend a project/repository name.
2. **Data investigation and parsing (Codex):** inspect all provided files and the assignment README; document source quirks; define a common quote shape; implement parsers using the selected React + TypeScript stack. An initial Python parser prototype followed the suggested stack, but I chose TypeScript for the API as well; that unused prototype was removed before submission.
3. **Frontend implementation (Codex):** build a polished, responsive AutoCover experience for vehicle lookup, quote comparison, plan selection, and saved policies.
4. **Assignment coverage review (Codex):** compare the implementation with the assignment requirements and recommend/fill important gaps.
5. **Explainable comparison and data quality (Codex):** explain plan strengths from supplied values and make missing fields, quote validity, source notes, calculations, and provider errors visible.
6. **Side-by-side comparison and resilience (Codex):** allow comparison of two or three plans and keep successful provider results available when another provider is slow or fails, with individual retries.
7. **Database choice (Codex):** replace the initial PostgreSQL direction with MongoDB because it is the database I already use and can confidently explain.
8. **Persistence (Codex):** save/reopen comparison snapshots and persist mock policy confirmations in MongoDB.
9. **Code review and bug fixing (Codex):** inspect the full project for parsing, validation, date, API, UI-state, and persistence issues; add regression coverage for identified cases.
10. **UI refinement (Codex):** improve navigation, landing-page sections, comparison readability, responsive behavior, and the size and prominence of important actions such as “Review & confirm.”
11. **Deployment (Codex):** prepare Render and Vercel configuration, connect the frontend to the separately hosted API, and document the required environment variables and deployment steps.
12. **Final submission review (Codex):** remove unused prototype/template files, make this usage log concise and accurate, and perform final lint, type, build, and test checks.

## Verification

- Backend test suite: 17 tests passed in the final audit.
- Backend TypeScript typecheck: passed.
- Frontend ESLint: passed.
- Frontend production build: passed.
- I manually verified vehicle lookup, provider comparisons, saved comparisons, mock policy confirmation, MongoDB persistence, and the deployed Vercel + Render flow.
- `npm audit` could not retrieve vulnerability data in the Codex environment because DNS could not resolve `registry.npmjs.org`. Render's frontend install previously reported 12 moderate advisories; review `npm audit --prefix frontend` from a networked machine before submission.
