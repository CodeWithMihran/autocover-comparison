const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '') ?? ''

export function apiUrl(path: `/api/${string}`): string {
  return `${configuredApiBase}${path}`
}
