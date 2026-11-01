import type { NormalizedQuote, Vehicle } from '../types/insurance'
import { apiUrl } from './api'

export interface SavedPolicy {
  id: string
  registration: string
  provider: string
  planName: string
  premiumInr: number
  policyStart: string
  policyEnd: string
  vehicle: Vehicle
  quote: NormalizedQuote
  createdAt: string
  expiryStatus: 'active' | 'expiring_soon' | 'expired'
}

async function readPayload<T extends Record<string, unknown>>(response: Response): Promise<T> {
  let payload: T | { error?: string }
  try { payload = await response.json() as T | { error?: string } }
  catch { throw new Error('The policy service returned an unreadable response.') }
  if (!payload || typeof payload !== 'object') throw new Error('The policy service returned an unreadable response.')
  if (!response.ok) throw new Error('error' in payload && typeof payload.error === 'string' ? payload.error : 'The policy service could not be reached.')
  return payload as T
}

export async function getPolicies(): Promise<SavedPolicy[]> {
  const response = await fetch(apiUrl('/api/policies'))
  const payload = await readPayload<{ policies: SavedPolicy[] }>(response)
  return payload.policies
}

export async function savePolicy(vehicle: Vehicle, quote: NormalizedQuote): Promise<SavedPolicy> {
  const response = await fetch(apiUrl('/api/policies'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle, quote }),
  })
  const payload = await readPayload<{ policy: SavedPolicy }>(response)
  return payload.policy
}
