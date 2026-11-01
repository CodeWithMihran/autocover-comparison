import type { Vehicle } from '../types/insurance'
import { apiUrl } from './api'

interface VehicleLookupResponse {
  vehicle: Vehicle;
}

export class VehicleLookupError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'VehicleLookupError'
    this.status = status
  }
}

export async function lookupVehicle(registration: string): Promise<Vehicle> {
  const query = new URLSearchParams({ registration })
  let response: Response
  try {
    response = await fetch(apiUrl(`/api/vehicles?${query.toString()}`))
  } catch {
    throw new VehicleLookupError('We could not reach AutoCover just now. Please try again.', 0)
  }

  const decoded: unknown = await response.json().catch(() => ({}))
  const body = decoded && typeof decoded === 'object' ? decoded as Partial<VehicleLookupResponse> & { error?: string } : {}
  if (!response.ok || !body.vehicle) {
    throw new VehicleLookupError(body.error ?? 'We could not find a vehicle for that registration.', response.status)
  }
  return body.vehicle
}
