import type { NormalizedQuote, SavedComparison, Vehicle } from '../types/insurance'

async function readPayload<T extends Record<string, unknown>>(response: Response): Promise<T> {
  let payload: T | { error?: string }
  try { payload = await response.json() as T | { error?: string } }
  catch { throw new Error('The comparison service returned an unreadable response.') }
  if (!payload || typeof payload !== 'object') throw new Error('The comparison service returned an unreadable response.')
  if (!response.ok) throw new Error('error' in payload && typeof payload.error === 'string' ? payload.error : 'The comparison service could not be reached.')
  return payload as T
}

export async function getSavedComparisons(): Promise<SavedComparison[]> {
  const response = await fetch('/api/comparisons')
  const payload = await readPayload<{ comparisons: SavedComparison[] }>(response)
  return payload.comparisons
}

export async function saveComparison(vehicle: Vehicle, plans: NormalizedQuote[]): Promise<SavedComparison> {
  const response = await fetch('/api/comparisons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle, plans }),
  })
  const payload = await readPayload<{ comparison: SavedComparison }>(response)
  return payload.comparison
}
