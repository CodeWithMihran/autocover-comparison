# AutoCover

Car insurance plan comparison using the assignment's supplied vehicle registry and four differently formatted provider sources.

> AutoCover is a comparison demo. It uses the assignment's supplied source data, with MongoDB-backed mock policy confirmation and a saved-policy dashboard.

**Live app:** [autocover-comparison.vercel.app](https://autocover-comparison.vercel.app/) · **API health:** [autocover-comparison.onrender.com/api/health](https://autocover-comparison.onrender.com/api/health) · **Source:** [GitHub repository](https://github.com/CodeWithMihran/autocover-comparison)

## Stack

- Frontend: React + TypeScript
- API and provider parser layer: Node.js + TypeScript
- Persistence: MongoDB, using the official Node.js driver

The assignment suggests React, TypeScript, Python/FastAPI and PostgreSQL. I use TypeScript for the API/parser layer too, so the frontend and backend share typed contracts. MongoDB fits the nested vehicle/quote snapshots saved with a policy and is the database I can run and explain confidently. Provider C's PDF is read with Mozilla PDF.js; see the [PDF.js Node.js examples](https://mozilla.github.io/pdf.js/examples/).

## Project layout

```text
backend/src/              API, MongoDB access, shared quote contract and provider parsers (TypeScript)
backend/tests/            Focused parser tests (Node test runner)
data/                     Assignment-provided source files
docs/                     Data investigation, calculation assumptions and add-on research
frontend/                 Vite + React + TypeScript application
frontend/src/types/       Shared contract consumed by the React app
```

## Requirements

- Node.js 22.12 or newer and npm
- A MongoDB server: either MongoDB Community Server on this computer, or a MongoDB Atlas cluster
- Git

MongoDB Compass is a graphical client; it does not run the database server by itself. If you have used Atlas, you can connect this app to your existing Atlas cluster instead of installing a local server.

## Setup on Windows

Run these commands from the repository root in PowerShell. The API and frontend run in separate terminals.

### 1. Install dependencies and configure the API

```powershell
Copy-Item .env.example .env
npm install
Set-Location frontend
npm install
Set-Location ..
```

### 2. Start MongoDB

Choose one option:

**Option A — local MongoDB Community Server:** install MongoDB Community Server using the [official Windows installation guide](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/). Enable the MongoDB Windows service during setup and keep the default address `mongodb://127.0.0.1:27017`. Compass can then connect to that same address.

**Option B — MongoDB Atlas:** in Atlas, create or select a cluster, create a database user, and allow your current IP in Network Access. From **Connect → Drivers**, copy the Node.js connection string and replace `MONGODB_URI` in `.env`. Replace `<password>` with the database user's password (URL-encode special characters). Follow [Atlas connection instructions](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/). Keep `.env` private and never commit Atlas credentials.

The API creates the configured database (default `autocover`), `policies` and `comparisons` collections and their indexes on first use. No database migration command is needed.

### 3. Run the API and frontend

**Terminal 1 — from the repository root:**

```powershell
npm run dev:api
```

**Terminal 2 — from the repository root:**

```powershell
Set-Location frontend
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`. Keep both terminals running. The frontend proxies `/api` to `http://127.0.0.1:3001`.

On macOS/Linux, use `cp .env.example .env` and `cd frontend` for the corresponding commands. Install/start MongoDB locally or configure Atlas as above.

## Deploy on Render

This repository includes a `render.yaml` Blueprint for a single Node web service. It builds the React frontend and serves it, the API, and the supplied provider files from the same service. MongoDB Atlas stores policies and saved comparisons.

1. Push this repository to your own GitHub account. Make sure `.env` is not tracked (`git check-ignore .env`) and never put the Atlas URI in Git.
2. In Render, choose **New → Blueprint**, connect your GitHub repository, and deploy the `render.yaml` configuration.
3. When Render prompts for `MONGODB_URI`, provide your Atlas application's connection string. In Atlas Network Access, allow the hosted service to reach the cluster. For a portfolio demo, restrict access as much as your host's outbound IP setup allows; avoid broad access where possible. Use a database user dedicated to this app with only the permissions it needs.
4. Wait for the deploy health check at `/api/health` to pass, then open the `onrender.com` URL shown on the service page.
5. Test vehicle lookup, all four provider results, saving a comparison, confirming a plan, and reloading the saved-items page. Check the Render logs if any API requests fail.

The free Render web service may sleep after 15 minutes without traffic, so its first request after idling can take longer. Its filesystem is temporary; AutoCover keeps saved records in MongoDB Atlas rather than on the service disk. See Render's [free service limitations](https://render.com/docs/free) and [web service port requirements](https://render.com/docs/web-services).

### Deploy the frontend on Vercel and API on Render

If the frontend is hosted separately on Vercel, deploy a Render web service from this same repository with a blank root directory, build command `npm ci --include=dev && npm run typecheck`, and start command `npm start`. Include dev dependencies during the build because the API start script uses `tsx`, and the TypeScript checker is also a dev dependency. Add `MONGODB_URI`, `MONGODB_DB_NAME=autocover`, `AUTOCOVER_REFERENCE_DATE=2026-11-10`, `MOCK_PROVIDER_D_FAILURE_RATE=0.12`, `NODE_VERSION=22.12.0`, and `CORS_ORIGINS=https://<your-vercel-domain>` to Render. In Vercel, set `VITE_API_BASE_URL=https://<your-render-service>.onrender.com`, then redeploy the frontend. `VITE_API_BASE_URL` is compiled into the frontend at build time; it should contain only the public API origin, never a secret. The API allows browser requests only from origins listed in `CORS_ORIGINS`.

## Verify the project

From the repository root:

```powershell
npm test
npm run typecheck
Set-Location frontend
npm run lint
npm run build
Set-Location ..
```

Parser tests cover the four source formats, normalization, calculations, missing data, duplicate records, quote validity and declines. To check database persistence manually, confirm a sample plan in the app, restart the API, and verify that the saved plan remains in the dashboard.

## Comparison flow

Enter a registration from `data/registry.json` or choose “Try a sample car”, review/edit the returned vehicle details, then select “Compare available plans”. Provider quote requests run independently and each result appears as soon as it arrives; a slow or failed source does not block successful results. Provider states show progress or an error, and failed providers can be retried individually without discarding the other results. The comparison screen supports coverage/add-on filtering and sorting, and gives evidence-based plan reasons: relative premium is compared only among displayed plans with matching coverage, tax disclosure and price basis; IDV is compared within the same displayed coverage type; included add-ons and supplied benefits are listed as plan attributes, not scored. Add two or three plans to a separate side-by-side table showing premium, IDV, coverage, add-ons, benefits and validity; save that verified snapshot to MongoDB and revisit it under **My saved items**. Reopening a saved comparison shows its original figures and saved date, clearly marked as a snapshot that may have expired; it does not treat saved figures as a fresh quote. Comparison selection does not select a plan for policy confirmation. Cards clearly show quote validity, missing values, and expandable provider-file, calculation and data-quality notes. Expired and not-yet-effective quotes are excluded from live results, with their status explained. Choose a plan with “Choose this plan”, review the mock confirmation, and save it separately to the policy dashboard.

The four provider endpoints are `/api/providers/a/quotes` through `/api/providers/d/quotes`; the frontend calls them separately so slow or unavailable services do not hide successful responses. Provider B intentionally waits 1.6 seconds. Provider D has a 12% simulated failure rate (set `MOCK_PROVIDER_D_FAILURE_RATE=0` in `.env` to disable it) and accepts `?simulate_failure=true` to force a 503. Failed providers can be retried from the comparison screen.

## Configuration and assumptions

See [.env.example](.env.example) for the environment variables. Set `MONGODB_URI` to the local server or Atlas URI; `MONGODB_DB_NAME` defaults to `autocover`. `AUTOCOVER_REFERENCE_DATE` defaults to `2026-11-10` and controls quote validity and the policy expiry dashboard; use an ISO date to change it.

- Prices are only read or calculated from the supplied files. The API re-parses and verifies the selected provider plan before persisting it.
- A mock policy starts the day after the verified vehicle's existing policy expiry when that expiry is on or after the configured reference date. Otherwise it starts on the reference date. The mock term ends one calendar year later, minus one day.
- “Expiring soon” means the policy end date falls between the configured reference date and 15 days after it, inclusive. Policy status is calculated when the dashboard is loaded.
- The selected policy is a demonstration record; no insurer purchase, payment, or real policy issuance occurs.
- The registry remains authoritative for Provider C's rate-card calculation. User-corrected details are saved with the policy, but do not alter the supplied provider quote calculations.
- A provider add-on with an unclear label stays `unknown` and is shown with its source text rather than guessed.
- Provider C's calculated quotes are unavailable before the rate card's effective date, as well as after its expiry.

See [docs/data-source-investigation.md](docs/data-source-investigation.md) for source-specific parsing decisions and [docs/addon-glossary.md](docs/addon-glossary.md) for the public insurer research and normalization rules.

## Final submission checklist

- Run all commands in [Verify the project](#verify-the-project) from a clean install.
- With MongoDB running (or Atlas configured), save a comparison of two or three plans, restart the API, and verify the saved snapshot can be reopened. Also confirm a sample plan and verify the policy remains in the dashboard.
- Capture screenshots or a short screen recording of vehicle lookup, provider comparison (including a retry state), confirmation, and the saved-policy dashboard.
- Push the complete project to your own repository. A deployment is optional.

## Assignment constraints

- Use the provided files as the only source of plan prices. Provider C's prices are calculated from its supplied PDF rate card and registry values.
- Serve the files through mock provider endpoints. The app's collector must call those endpoints rather than read source files directly.
- Make at least one mock provider slow and another intermittently fail; show partial results and meaningful loading/error states.
- Research public add-on pages from at least three real insurers and record their URLs. Do not use quote forms, logins, or OTPs.
- Make assumptions visible in the README. Do not rank plans by price alone.
- Persist mock policy confirmations and saved comparison snapshots in MongoDB; display policies approaching expiry.

## Assumptions

Provider C's calculation and normalization assumptions are documented in [docs/data-source-investigation.md](docs/data-source-investigation.md). Policy date behavior and other application assumptions are documented above.
