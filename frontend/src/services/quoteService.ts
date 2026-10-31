import type { ProviderParseResult, NormalizedQuote } from '../types/insurance'

export type ProviderId = 'a' | 'b' | 'c' | 'd'
export type ProviderState =
  | { status: 'loading'; previousResult?: ProviderParseResult }
  | { status: 'success'; result: ProviderParseResult }
  | { status: 'error'; message: string; previousResult?: ProviderParseResult }

export async function fetchProviderQuotes(id: ProviderId, registration: string): Promise<ProviderParseResult> {
  let response: Response
  try {
    response = await fetch(`/api/providers/${id}/quotes?registration=${encodeURIComponent(registration)}`, { signal: AbortSignal.timeout(10_000) })
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError'
      ? 'Provider request timed out. Please retry.'
      : 'Could not reach this provider. Please check that AutoCover is running.', { cause: error })
  }
  let payload: ProviderParseResult | { error?: string }
  try { payload = await response.json() as ProviderParseResult | { error?: string } }
  catch { throw new Error('Provider returned an unreadable response. Please retry.') }
  if (!payload || typeof payload !== 'object') throw new Error('Provider returned an unreadable response. Please retry.')
  if (!response.ok) throw new Error('error' in payload && payload.error ? payload.error : 'This provider could not be reached.')
  return payload as ProviderParseResult
}

export function flattenQuotes(states: Record<ProviderId, ProviderState>): NormalizedQuote[] {
  return Object.values(states).flatMap((state) => state.status === 'success'
    ? state.result.quotes
    : state.status === 'loading' || state.status === 'error'
      ? state.previousResult?.quotes ?? []
      : [])
}
