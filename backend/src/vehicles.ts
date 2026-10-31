import { readFile } from "node:fs/promises";
import { Vehicle } from "./domain.js";
import { normalizeRegistration, parseIsoDate } from "./normalization.js";

interface RegistryRow {
  registration_number: string;
  make: string;
  model: string;
  variant: string;
  fuel_type: string | null;
  engine_cc: number;
  registration_date: string;
  rto: string;
  ex_showroom_price: number;
  ncb_percent: number;
  claims_last_year: number;
  current_policy_expiry: string | null;
}

export async function loadVehicles(path: string): Promise<Map<string, Vehicle>> {
  const raw = JSON.parse(await readFile(path, "utf8")) as { vehicles: RegistryRow[] };
  return new Map(raw.vehicles.map((row) => {
    const registration = normalizeRegistration(row.registration_number);
    const vehicle: Vehicle = {
      registration,
      make: row.make,
      model: row.model,
      variant: row.variant,
      fuelType: row.fuel_type,
      engineCc: Number(row.engine_cc),
      registrationDate: parseIsoDate(row.registration_date)!,
      rto: row.rto,
      exShowroomPriceInr: Number(row.ex_showroom_price),
      ncbPercent: Number(row.ncb_percent),
      claimsLastYear: Number(row.claims_last_year ?? 0),
      currentPolicyExpiry: parseIsoDate(row.current_policy_expiry),
    };
    return [registration, vehicle];
  }));
}
