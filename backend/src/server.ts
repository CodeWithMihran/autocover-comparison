import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { normalizeRegistration, referenceDateFromEnv } from "./normalization.js";
import { loadVehicles } from "./vehicles.js";
import { closeDatabase, ensureDatabase, getComparisonsCollection, getPoliciesCollection } from "./database.js";
import { isPolicyRequest, mockPolicyDates, policyExpiryStatus } from "./policyLogic.js";
import { isSavedComparisonRequest, matchesSourceQuote } from "./comparisonLogic.js";
import { parseProviderA } from "./providers/providerA.js";
import { parseProviderB } from "./providers/providerB.js";
import { parseProviderC } from "./providers/providerC.js";
import { parseProviderD } from "./providers/providerD.js";
import type { NormalizedQuote, ProviderParseResult } from "./domain.js";

const registryPath = resolve(process.cwd(), "data/registry.json");
const vehicles = await loadVehicles(registryPath);
const configuredPort = process.env.API_PORT ?? "3001";
const port = Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("API_PORT must be an integer from 1 to 65535.");
}
const dataPath = (file: string) => resolve(process.cwd(), "data", file);
const providerRoutes: Record<string, (registration: string) => Promise<ProviderParseResult>> = {
  a: (registration) => parseProviderA(dataPath("provider_a.json"), registration),
  b: async (registration) => {
    // This mock endpoint intentionally responds more slowly to exercise partial results.
    await new Promise((done) => setTimeout(done, 1600));
    return parseProviderB(dataPath("provider_b.html"), registration);
  },
  c: (registration) => parseProviderC(dataPath("provider_c.pdf"), dataPath("registry.json"), registration),
  d: (registration) => parseProviderD(dataPath("provider_d.csv"), registration, undefined, new Set(vehicles.keys())),
};

function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    let oversized = false;
    request.on("data", (chunk: Buffer) => {
      if (oversized) return;
      bodyBytes += chunk.length;
      if (bodyBytes > 1_000_000) {
        oversized = true;
        chunks.length = 0;
        reject(new Error("Request body is too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) return;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Request body must be valid JSON.")); }
    });
    request.on("error", reject);
    request.on("aborted", () => reject(new Error("Request body was interrupted.")));
  });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method === "GET" && url.pathname === "/api/comparisons") {
    void (async () => {
      await ensureDatabase();
      const rows = await getComparisonsCollection().find({}).sort({ createdAt: -1 }).limit(100).toArray();
      const comparisons = rows.map(({ _id, ...comparison }) => ({ ...comparison, id: _id }));
      response.writeHead(200).end(JSON.stringify({ comparisons }));
    })().catch((error: unknown) => {
      console.error("Could not load saved comparisons:", error);
      response.writeHead(503).end(JSON.stringify({ error: "Saved comparison storage is unavailable. Start MongoDB and check MONGODB_URI." }));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/comparisons") {
    void (async () => {
      let body: unknown;
      try { body = await readJsonBody(request); }
      catch (bodyError) {
        response.writeHead(400).end(JSON.stringify({ error: bodyError instanceof Error ? bodyError.message : "Request body must be valid JSON." }));
        return;
      }
      if (!isSavedComparisonRequest(body)) {
        response.writeHead(400).end(JSON.stringify({ error: "Provide a valid vehicle and two or three plans to save a comparison." }));
        return;
      }
      const registration = normalizeRegistration(body.vehicle.registration);
      if (!vehicles.has(registration) || normalizeRegistration(body.vehicle.registration) !== registration
        || body.plans.some((quote) => normalizeRegistration(quote.registration) !== registration)) {
        response.writeHead(400).end(JSON.stringify({ error: "Vehicle and all plans must use the same registration from the supplied registry." }));
        return;
      }
      const keys = body.plans.map((quote) => JSON.stringify([quote.provider, quote.sourceQuoteId, quote.planName]));
      if (new Set(keys).size !== keys.length) {
        response.writeHead(400).end(JSON.stringify({ error: "Choose different plans; duplicate plans cannot be saved in one comparison." }));
        return;
      }

      const verifiedPlans: NormalizedQuote[] = [];
      const resultByProvider = new Map<string, ProviderParseResult>();
      for (const requestedQuote of body.plans) {
        let result = resultByProvider.get(requestedQuote.provider);
        if (!result) {
          const providerEntry = Object.entries(providerRoutes).find(([id]) => providerNamesForId(id) === requestedQuote.provider);
          if (!providerEntry) {
            response.writeHead(400).end(JSON.stringify({ error: "A selected plan is from an unrecognized provider." }));
            return;
          }
          try {
            result = await providerEntry[1](registration);
            resultByProvider.set(requestedQuote.provider, result);
          } catch (providerError) {
            console.error(`Could not verify ${requestedQuote.provider} while saving comparison:`, providerError);
            response.writeHead(502).end(JSON.stringify({ error: "A selected provider source could not be read. Retry the comparison and save again." }));
            return;
          }
        }
        const sourceQuote = result.quotes.find((quote) => matchesSourceQuote(quote, requestedQuote));
        if (!sourceQuote) {
          response.writeHead(400).end(JSON.stringify({ error: "A selected plan could not be verified against its supplied provider file. Refresh the comparison and try again." }));
          return;
        }
        if (sourceQuote.validityStatus === "expired" || sourceQuote.validityStatus === "not_yet_valid") {
          response.writeHead(400).end(JSON.stringify({ error: "A selected quote is no longer valid for the configured reference date. Refresh the comparison before saving." }));
          return;
        }
        verifiedPlans.push(sourceQuote);
      }

      await ensureDatabase();
      const document = {
        _id: randomUUID(),
        registration,
        vehicle: { ...body.vehicle, registration },
        plans: verifiedPlans,
        createdAt: new Date().toISOString(),
      };
      await getComparisonsCollection().insertOne(document);
      const { _id, ...comparison } = document;
      response.writeHead(201).end(JSON.stringify({ comparison: { ...comparison, id: _id } }));
    })().catch((error: unknown) => {
      console.error("Could not save comparison:", error);
      response.writeHead(503).end(JSON.stringify({ error: "Saved comparison storage is unavailable. Start MongoDB and check MONGODB_URI." }));
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/policies") {
    void (async () => {
      await ensureDatabase();
      const rows = await getPoliciesCollection().find({}).sort({ createdAt: -1 }).toArray();
      const today = referenceDateFromEnv();
      const policies = rows.map(({ _id, ...policy }) => ({ ...policy, id: _id, expiryStatus: policyExpiryStatus(policy.policyEnd, today) }));
      response.writeHead(200).end(JSON.stringify({ policies, referenceDate: today }));
    })().catch((error: unknown) => {
      console.error("Could not load policies:", error);
      response.writeHead(503).end(JSON.stringify({ error: "Policy storage is unavailable. Start MongoDB and check MONGODB_URI." }));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/policies") {
    void (async () => {
      let body: unknown;
      try { body = await readJsonBody(request); }
      catch (bodyError) {
        response.writeHead(400).end(JSON.stringify({ error: bodyError instanceof Error ? bodyError.message : "Request body must be valid JSON." }));
        return;
      }
      if (!isPolicyRequest(body)) {
        response.writeHead(400).end(JSON.stringify({ error: "Provide a vehicle and a plan with a known premium." }));
        return;
      }
      const registration = normalizeRegistration(body.vehicle.registration);
      if (!vehicles.has(registration) || normalizeRegistration(body.quote.registration) !== registration) {
        response.writeHead(400).end(JSON.stringify({ error: "Vehicle and plan registration must match a vehicle in the supplied registry." }));
        return;
      }
      const providerEntry = Object.entries(providerRoutes).find(([id]) => providerNamesForId(id) === body.quote.provider);
      if (!providerEntry) {
        response.writeHead(400).end(JSON.stringify({ error: "The selected provider is not recognized." }));
        return;
      }
      const [, loadProviderQuotes] = providerEntry;
      let sourceResult: ProviderParseResult;
      try {
        sourceResult = await loadProviderQuotes(registration);
      } catch (providerError) {
        console.error(`Could not re-parse ${body.quote.provider} source during confirmation:`, providerError);
        response.writeHead(502).end(JSON.stringify({ error: "The provider source could not be read to verify this plan. Please try again." }));
        return;
      }
      const sourceQuote = sourceResult.quotes.find((quote) => matchesSourceQuote(quote, body.quote));
      if (!sourceQuote) {
        response.writeHead(400).end(JSON.stringify({ error: "The selected plan could not be verified against its supplied provider file." }));
        return;
      }
      if (sourceQuote.totalPremiumInr === null) {
        response.writeHead(400).end(JSON.stringify({ error: "This plan has no known total premium and cannot be confirmed." }));
        return;
      }
      if (sourceQuote.validUntil && sourceQuote.validUntil < referenceDateFromEnv()) {
        response.writeHead(400).end(JSON.stringify({ error: "This quote has expired and cannot be confirmed." }));
        return;
      }
      if (sourceQuote.validityStatus === "not_yet_valid") {
        response.writeHead(400).end(JSON.stringify({ error: "This quote is not valid yet and cannot be confirmed." }));
        return;
      }
      const referenceDate = referenceDateFromEnv();
      const dates = mockPolicyDates(body.vehicle, referenceDate);
      await ensureDatabase();
      const document = {
        _id: randomUUID(),
        registration,
        provider: sourceQuote.provider,
        planName: sourceQuote.planName,
        premiumInr: sourceQuote.totalPremiumInr,
        policyStart: dates.start,
        policyEnd: dates.end,
        vehicle: { ...body.vehicle, registration },
        quote: sourceQuote,
        createdAt: new Date().toISOString(),
      };
      await getPoliciesCollection().insertOne(document);
      const { _id, ...policy } = document;
      response.writeHead(201).end(JSON.stringify({ policy: { ...policy, id: _id }, message: "Mock policy confirmed and saved." }));
    })().catch((error: unknown) => {
      console.error("Could not confirm policy:", error);
      response.writeHead(503).end(JSON.stringify({ error: "Policy storage is unavailable. Start MongoDB and check MONGODB_URI." }));
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    try {
      response.writeHead(200).end(JSON.stringify({ status: "ok", referenceDate: referenceDateFromEnv() }));
    } catch (error) {
      response.writeHead(500).end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid API configuration." }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/vehicles") {
    const rawRegistration = url.searchParams.get("registration") ?? "";
    const registration = normalizeRegistration(rawRegistration);
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(registration)) {
      response.writeHead(400).end(JSON.stringify({ error: "Enter a valid vehicle registration number." }));
      return;
    }
    const vehicle = vehicles.get(registration);
    if (!vehicle) {
      response.writeHead(404).end(JSON.stringify({ error: "No vehicle was found for that registration." }));
      return;
    }
    response.writeHead(200).end(JSON.stringify({ vehicle }));
    return;
  }

  const providerMatch = url.pathname.match(/^\/api\/providers\/([a-d])\/quotes$/);
  if (request.method === "GET" && providerMatch) {
    const registration = normalizeRegistration(url.searchParams.get("registration") ?? "");
    if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(registration) || !vehicles.has(registration)) {
      response.writeHead(400).end(JSON.stringify({ error: "A registration from the supplied vehicle registry is required." }));
      return;
    }
    const providerId = providerMatch[1];
    // Provider D fails occasionally to exercise partial results; the query switch reproduces it on demand.
    const configuredFailureRate = Number(process.env.MOCK_PROVIDER_D_FAILURE_RATE ?? 0.12);
    const failureRate = Number.isFinite(configuredFailureRate) ? Math.min(1, Math.max(0, configuredFailureRate)) : 0.12;
    if (providerId === "d" && (url.searchParams.get("simulate_failure") === "true" || Math.random() < failureRate)) {
      response.writeHead(503).end(JSON.stringify({ error: "Provider D is temporarily unavailable. Please retry." }));
      return;
    }
    void providerRoutes[providerId](registration).then((result) => {
      response.writeHead(200).end(JSON.stringify(result));
    }).catch((error: unknown) => {
      console.error(`Provider ${providerId.toUpperCase()} mock service failed:`, error);
      response.writeHead(502).end(JSON.stringify({ error: `Provider ${providerId.toUpperCase()} could not return plans right now.` }));
    });
    return;
  }

  response.writeHead(404).end(JSON.stringify({ error: "API route not found." }));
});

function providerNamesForId(id: string): string {
  return `Provider ${id.toUpperCase()}`;
}

server.listen(port, "127.0.0.1", () => {
  console.log(`AutoCover API listening at http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => {
    void closeDatabase().finally(() => process.exit(0));
  }));
}
