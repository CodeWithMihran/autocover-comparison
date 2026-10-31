import { MongoClient, type Collection } from "mongodb";
import type { NormalizedQuote, Vehicle } from "./domain.js";

export interface PolicyDocument {
  _id: string;
  registration: string;
  provider: string;
  planName: string;
  premiumInr: number;
  policyStart: string;
  policyEnd: string;
  vehicle: unknown;
  quote: unknown;
  createdAt: string;
}

export interface SavedComparisonDocument {
  _id: string;
  registration: string;
  vehicle: Vehicle;
  plans: NormalizedQuote[];
  createdAt: string;
}

let client: MongoClient | null = null;
let policies: Collection<PolicyDocument> | null = null;
let comparisons: Collection<SavedComparisonDocument> | null = null;
let initialization: Promise<void> | null = null;

export async function ensureDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri?.trim()) throw new Error("Database is not configured. Set MONGODB_URI and start MongoDB.");

  if (!initialization) {
    const nextClient = new MongoClient(uri, {
      connectTimeoutMS: 3_000,
      serverSelectionTimeoutMS: 3_000,
      maxPoolSize: 5,
    });
    initialization = (async () => {
      try {
        await nextClient.connect();
        const database = nextClient.db(process.env.MONGODB_DB_NAME?.trim() || "autocover");
        const collection = database.collection<PolicyDocument>("policies");
        const comparisonCollection = database.collection<SavedComparisonDocument>("comparisons");
        await Promise.all([
          collection.createIndex({ registration: 1 }),
          collection.createIndex({ policyEnd: 1 }),
          comparisonCollection.createIndex({ registration: 1 }),
          comparisonCollection.createIndex({ createdAt: -1 }),
        ]);
        client = nextClient;
        policies = collection;
        comparisons = comparisonCollection;
      } catch (error) {
        await nextClient.close().catch(() => undefined);
        throw error;
      }
    })();
  }

  const attempt = initialization;
  try {
    await attempt;
  } catch (error) {
    if (initialization === attempt) initialization = null;
    throw error;
  }
}

export function getPoliciesCollection(): Collection<PolicyDocument> {
  if (!client || !policies) throw new Error("MongoDB is not connected. Call ensureDatabase() first.");
  return policies;
}

export function getComparisonsCollection(): Collection<SavedComparisonDocument> {
  if (!client || !comparisons) throw new Error("MongoDB is not connected. Call ensureDatabase() first.");
  return comparisons;
}

export async function closeDatabase(): Promise<void> {
  const connectedClient = client;
  client = null;
  policies = null;
  comparisons = null;
  initialization = null;
  await connectedClient?.close();
}
