import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { lookupVehicle, VehicleLookupError } from './services/vehicleService'
import { getPolicies, savePolicy, type SavedPolicy } from './services/policyService'
import { getSavedComparisons, saveComparison as persistComparison } from './services/comparisonService'
import { fetchProviderQuotes, flattenQuotes, type ProviderId, type ProviderState } from './services/quoteService'
import type { AddonConcept, NormalizedQuote, SavedComparison, Vehicle } from './types/insurance'

type Screen = 'lookup' | 'review' | 'confirmed' | 'compare' | 'dashboard' | 'saved-comparison'

const providerNames: Record<ProviderId, string> = { a: 'Provider A', b: 'Provider B', c: 'Provider C', d: 'Provider D' }
const providerIdsByName: Record<string, ProviderId> = {
  'Provider A': 'a',
  'Provider B': 'b',
  'Provider C': 'c',
  'Provider D': 'd',
}
const providerSourceFiles: Record<string, string> = {
  'Provider A': 'data/provider_a.json',
  'Provider B': 'data/provider_b.html',
  'Provider C': 'data/provider_c.pdf',
  'Provider D': 'data/provider_d.csv',
}
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function formatMoney(value: number | null): string {
  return value === null ? 'Not provided' : currency.format(value)
}

function quoteIdentity(quote: NormalizedQuote): string {
  return JSON.stringify([
    quote.provider, quote.registration, quote.sourceQuoteId, quote.planName, quote.totalPremiumInr,
    quote.gstInr, quote.basePremiumInr, quote.idvInr, quote.coverageType, quote.addons,
    quote.benefits, quote.validUntil, quote.validityStatus, quote.taxIncluded, quote.priceBasis, quote.warnings,
  ])
}

function SideBySideComparison({ plans, onRemove, onClear, onSave, saving = false, saved = false, saveError = '', readOnly = false }: {
  plans: NormalizedQuote[]
  onRemove?: (plan: NormalizedQuote) => void
  onClear?: () => void
  onSave?: () => void
  saving?: boolean
  saved?: boolean
  saveError?: string
  readOnly?: boolean
}) {
  return <section className="side-compare" aria-labelledby="side-compare-title">
    <div className="side-compare-heading">
      <div><h3 id="side-compare-title">Side-by-side comparison</h3><p>Compare up to three plans on the details that matter.</p></div>
      {!readOnly && onClear && <button className="text-button" type="button" disabled={saving} onClick={onClear}>Clear selection</button>}
    </div>
    <div className="comparison-table-wrap">
      <table className="comparison-table">
        <caption className="visually-hidden">Selected insurance plan comparison</caption>
        <thead><tr><th scope="col">Plan detail</th>{plans.map((plan) => <th scope="col" key={quoteIdentity(plan)}>
          <span>{plan.provider}</span><strong>{plan.planName}</strong>
          {!readOnly && onRemove && <button type="button" disabled={saving} onClick={() => onRemove(plan)} aria-label={'Remove ' + plan.planName + ' from comparison'}>Remove</button>}
        </th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Total premium</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>
            {formatMoney(plan.totalPremiumInr)}
            <small>{plan.taxIncluded === true ? 'Source reports a tax-inclusive total' : plan.taxIncluded === false && plan.totalPremiumInr !== null ? 'Tax added or calculated in normalized total' : plan.taxIncluded === false ? 'Tax excluded; total unavailable' : 'Tax basis unclear'}</small>
          </td>)}</tr>
          <tr><th scope="row">Insured value (IDV)</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>{formatMoney(plan.idvInr)}</td>)}</tr>
          <tr><th scope="row">Coverage</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>{plan.coverageType === 'unknown' ? 'Not stated' : plan.coverageType.replace('_', ' ')}</td>)}</tr>
          <tr><th scope="row">Included add-ons</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>{plan.addons.length ? plan.addons.map((item) => item.sourceLabel).join(', ') : 'None listed'}</td>)}</tr>
          <tr><th scope="row">Benefits</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>{plan.benefits.length ? plan.benefits.join('; ') : 'None listed'}</td>)}</tr>
          <tr><th scope="row">Quote validity</th>{plans.map((plan) => <td key={quoteIdentity(plan)}>{plan.validityStatus === 'unknown' ? 'Expiry not provided' : 'Through ' + formatDate(plan.validUntil)}</td>)}</tr>
        </tbody>
      </table>
    </div>
    {onSave && <div className="save-comparison-actions"><button className="secondary-button" type="button" disabled={saving || saved} onClick={onSave}>{saved ? 'Comparison saved' : saving ? 'Saving comparison…' : 'Save this comparison'}</button>{saveError && <p role="alert">{saveError}</p>}</div>}
  </section>
}

function CompareScreen({
  vehicle,
  states,
  onRetry,
  onBack,
  selected,
  onSelect,
  onConfirm,
  onSaveComparison,
}: {
  vehicle: Vehicle
  states: Record<ProviderId, ProviderState>
  onRetry: (id: ProviderId) => void
  onBack: () => void
  selected: NormalizedQuote | null
  onSelect: (quote: NormalizedQuote) => void
  onConfirm: () => void
  onSaveComparison: (vehicle: Vehicle, plans: NormalizedQuote[]) => Promise<void>
}) {
  const [sort, setSort] = useState<'source' | 'price' | 'idv'>('source')
  const [coverage, setCoverage] = useState('all')
  const [addon, setAddon] = useState<'all' | AddonConcept>('all')
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const allQuotes = useMemo(() => flattenQuotes(states), [states])
  const unavailableDateQuoteCount = allQuotes.filter((quote) => quote.validityStatus === 'expired' || quote.validityStatus === 'not_yet_valid').length
  const unavailableDateQuotes = allQuotes.filter((quote) => quote.validityStatus === 'expired' || quote.validityStatus === 'not_yet_valid')
  const availableQuotes = useMemo(() => allQuotes.filter((quote) => quote.validityStatus !== 'expired' && quote.validityStatus !== 'not_yet_valid'), [allQuotes])
  const addonConcepts = [...new Set(availableQuotes.flatMap((quote) => quote.addons.map((item) => item.concept)))].sort()
  const quotes = useMemo(() => {
    let plans = [...availableQuotes]
    if (coverage !== 'all') plans = plans.filter((quote) => quote.coverageType === coverage)
    if (addon !== 'all') plans = plans.filter((quote) => quote.addons.some((item) => item.concept === addon))
    if (sort === 'price') plans.sort((a, b) => (a.totalPremiumInr ?? Number.MAX_SAFE_INTEGER) - (b.totalPremiumInr ?? Number.MAX_SAFE_INTEGER))
    if (sort === 'idv') plans.sort((a, b) => (b.idvInr ?? -1) - (a.idvInr ?? -1))
    return plans
  }, [availableQuotes, sort, coverage, addon])
  const comparisonPlans = useMemo(() => comparisonIds
    .map((id) => allQuotes.find((quote) => quoteIdentity(quote) === id))
    .filter((quote): quote is NormalizedQuote => quote !== undefined), [allQuotes, comparisonIds])
  const comparisonIdSet = new Set(comparisonIds)
  function toggleComparison(quote: NormalizedQuote) {
    const id = quoteIdentity(quote)
    setSaveStatus('idle')
    setSaveError('')
    setComparisonIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 3 ? [...current, id] : current)
  }
  async function handleSaveComparison() {
    setSaveStatus('saving')
    setSaveError('')
    try {
      await onSaveComparison(vehicle, comparisonPlans)
      setSaveStatus('saved')
    } catch (error) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : 'Could not save this comparison. Please try again.')
    }
  }
  const pending = Object.values(states).some((state) => state.status === 'loading')
  const failures = Object.entries(states).filter(([, state]) => state.status === 'error') as [ProviderId, Extract<ProviderState, { status: 'error' }>][]
  const declines = Object.values(states).flatMap((state) => {
    const result = state.status === 'success' ? state.result : state.previousResult
    return result?.declines ?? []
  })
  const sourceWarnings = Object.values(states).flatMap((state) => {
    const result = state.status === 'success' ? state.result : state.previousResult
    return result ? result.warnings.map((warning) => ({ provider: result.provider, warning })) : []
  })
  const premiumCohorts = useMemo(() => {
    const cohorts = new Map<string, NormalizedQuote[]>()
    for (const quote of quotes) {
      if (quote.totalPremiumInr === null || quote.coverageType === 'unknown') continue
      const key = [quote.coverageType, quote.taxIncluded ?? 'unknown', quote.priceBasis].join(':')
      cohorts.set(key, [...(cohorts.get(key) ?? []), quote])
    }
    return cohorts
  }, [quotes])
  const idvCohorts = useMemo(() => {
    const cohorts = new Map<string, NormalizedQuote[]>()
    for (const quote of quotes) {
      if (quote.idvInr === null || quote.coverageType === 'unknown') continue
      cohorts.set(quote.coverageType, [...(cohorts.get(quote.coverageType) ?? []), quote])
    }
    return cohorts
  }, [quotes])

  return <section className="compare-screen" aria-labelledby="compare-title">
    <div className="compare-heading">
      <div><p className="card-kicker">YOUR OPTIONS · {vehicle.registration}</p><h2 id="compare-title">Compare plans with confidence</h2><p>{vehicle.make} {vehicle.model} {vehicle.variant} · {vehicle.rto}</p></div>
      <button className="text-button" type="button" onClick={onBack}><ArrowIcon direction="left" /> Vehicle details</button>
    </div>
    <div className="provider-statuses" aria-label="Provider quote status">
      {(['a', 'b', 'c', 'd'] as const).map((id) => {
        const state = states[id]
        const displayedResult = state.status === 'success' ? state.result : state.status === 'loading' || state.status === 'error' ? state.previousResult : undefined
        const availableCount = displayedResult?.quotes.filter((quote) => quote.validityStatus !== 'expired' && quote.validityStatus !== 'not_yet_valid').length ?? 0
        const statusText = state.status === 'loading' ? state.previousResult
          ? `Refreshing · ${availableCount} previous plans shown`
          : 'Getting quotes…'
          : state.status === 'success' ? availableCount + (availableCount === 1 ? ' plan available' : ' plans available')
            : 'Unavailable · ' + state.message + (state.previousResult ? ' Previous results shown.' : '')
        return <div className={`provider-status provider-status--${state.status}`} key={id}><span className="status-dot" /><strong>{providerNames[id]}</strong><span className="provider-status-label">{statusText}</span></div>
      })}
    </div>
    <div className="compare-toolbar"><span><strong>{quotes.length}</strong> available plans{pending && <span className="subtle"> · More arriving</span>}</span><div className="compare-filters"><label>Cover <select value={coverage} onChange={(event) => setCoverage(event.target.value)}><option value="all">All types</option><option value="comprehensive">Comprehensive</option><option value="third_party">Third party</option></select></label><label>Add-on <select value={addon} onChange={(event) => setAddon(event.target.value as 'all' | AddonConcept)}><option value="all">Any add-on</option>{addonConcepts.map((concept) => <option key={concept} value={concept}>{concept === 'unknown' ? 'Other / unspecified' : concept.replaceAll('_', ' ')}</option>)}</select></label><label>Sort <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="source">Provider order</option><option value="price">Lowest known price</option><option value="idv">Highest IDV</option></select></label></div></div>
    {failures.length > 0 && <div className="provider-alert" role="status"><strong>{failures.length} provider{failures.length > 1 ? 's are' : ' is'} temporarily unavailable.</strong><span>Successful results remain available while you retry.</span>{failures.map(([id, state]) => <span className="provider-error-detail" key={id}><strong>{providerNames[id]}:</strong> {state.message} <button type="button" onClick={() => onRetry(id)}>Retry {providerNames[id]}</button></span>)}</div>}
    {comparisonPlans.length === 1 && <p className="comparison-prompt" role="status">1 plan selected for side-by-side comparison. Add one more plan to compare them; you can select up to three.</p>}
    {comparisonPlans.length >= 2 && <SideBySideComparison plans={comparisonPlans} onRemove={toggleComparison} onClear={() => { setComparisonIds([]); setSaveStatus('idle'); setSaveError('') }} onSave={() => void handleSaveComparison()} saving={saveStatus === 'saving'} saved={saveStatus === 'saved'} saveError={saveError} />}
    {quotes.length === 0 && !pending && <div className="empty-quotes"><strong>No available plans for this vehicle yet.</strong><span>Check provider status above or retry an unavailable provider.</span></div>}
    <div className="plan-grid">{quotes.map((quote) => {
      const isSelected = selected !== null && quoteIdentity(selected) === quoteIdentity(quote)
      const premiumPeers = quote.totalPremiumInr === null || quote.coverageType === 'unknown'
        ? []
        : premiumCohorts.get([quote.coverageType, quote.taxIncluded ?? 'unknown', quote.priceBasis].join(':')) ?? []
      const idvPeers = quote.idvInr === null || quote.coverageType === 'unknown' ? [] : idvCohorts.get(quote.coverageType) ?? []
      const lowestComparablePremium = premiumPeers.length > 1 ? Math.min(...premiumPeers.map((peer) => peer.totalPremiumInr!)) : null
      const highestComparableIdv = idvPeers.length > 1 ? Math.max(...idvPeers.map((peer) => peer.idvInr!)) : null
      const isLowestPrice = lowestComparablePremium !== null && quote.totalPremiumInr === lowestComparablePremium
      const isHighestIdv = highestComparableIdv !== null && quote.idvInr === highestComparableIdv
      const knownAddonNames = quote.addons.filter((item) => item.concept !== 'unknown').map((item) => item.concept.replaceAll('_', ' '))
      const hasHighlights = isLowestPrice || isHighestIdv || quote.addons.length > 0 || quote.benefits.length > 0
      const isInComparison = comparisonIdSet.has(quoteIdentity(quote))
      const providerId = providerIdsByName[quote.provider]
      const providerState = providerId ? states[providerId] : undefined
      const resultsRefreshing = providerState?.status === 'loading' && Boolean(providerState.previousResult)
      const validityLabel = quote.validityStatus === 'valid' ? 'Valid through ' + formatDate(quote.validUntil)
        : quote.validityStatus === 'unknown' ? 'Expiry not provided'
          : quote.validityStatus === 'expired' ? 'Expired ' + formatDate(quote.validUntil) : 'Not yet effective'
      return <article className={`plan-card ${isSelected ? 'plan-card--selected' : ''}`} key={quoteIdentity(quote)}>
      <div className="plan-card-top"><span>{quote.provider}</span><span className={`cover-badge cover-badge--${quote.coverageType}`}>{quote.coverageType === 'unknown' ? 'Cover not stated' : quote.coverageType.replace('_', ' ')}</span></div>
      <div className="plan-meta-badges"><span className="tax-badge">{quote.taxIncluded === true ? 'Source says taxes included' : quote.taxIncluded === false && quote.totalPremiumInr !== null ? 'Tax added/calculated in total' : quote.taxIncluded === false ? 'Tax excluded; total unknown' : 'Tax basis unclear'}</span>{quote.priceBasis === 'calculated_from_rate_card' && <span className="calculation-badge">Rate-card estimate</span>}</div>
      <h3>{quote.planName}</h3>
      <div className="plan-price">{formatMoney(quote.totalPremiumInr)}<small>{quote.totalPremiumInr !== null ? quote.taxIncluded === null ? ' source amount · tax basis unclear' : ' total premium' : ' total not available'}</small></div>
      {hasHighlights && <div className="plan-highlights"><span>Why it may suit you</span><ul>{isLowestPrice && <li>Lowest known total among plans currently shown with {quote.coverageType.replace('_', ' ')} cover and the same tax disclosure and price basis.</li>}{isHighestIdv && <li>Highest IDV among plans currently shown with {quote.coverageType.replace('_', ' ')} cover.</li>}{knownAddonNames.map((name) => <li key={name}>Includes {name} add-on.</li>)}{quote.addons.some((item) => item.concept === 'unknown') && <li>Includes an add-on whose benefit could not be confidently mapped: {quote.addons.filter((item) => item.concept === 'unknown').map((item) => item.sourceLabel).join(', ')}.</li>}{quote.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul></div>}
      <div className="plan-facts"><div><span>Insured value (IDV)</span><strong>{formatMoney(quote.idvInr)}</strong>{quote.idvInr === null && <small className="missing-value">Not provided by source</small>}</div><div><span>GST amount</span><strong>{formatMoney(quote.gstInr)}</strong>{quote.gstInr === null && <small className="missing-value">Breakdown not provided</small>}</div></div>
      <div className={'plan-validity plan-validity--' + quote.validityStatus}><span>Quote validity</span><strong>{validityLabel}</strong></div>
      <button className={isInComparison ? 'compare-plan-button is-added' : 'compare-plan-button'} type="button" aria-pressed={isInComparison} disabled={saveStatus === 'saving' || (!isInComparison && comparisonIds.length >= 3)} onClick={() => toggleComparison(quote)}>{resultsRefreshing ? 'Showing previous results · refresh in progress' : isInComparison ? 'Remove from comparison' : comparisonIds.length >= 3 ? 'Comparison full (3 plans)' : 'Add to side-by-side'}</button>
      {quote.addons.length > 0 && <div className="plan-addons"><span>Included add-ons</span><div>{quote.addons.map((addon, index) => <span className="addon-chip" key={`${addon.sourceLabel}-${index}`}>{addon.sourceLabel}</span>)}</div></div>}
      {quote.benefits.length > 0 && <div className="plan-benefits">{quote.benefits.map((benefit) => <span key={benefit}>✓ {benefit}</span>)}</div>}
      <details className="plan-notes plan-source-notes"><summary>Data quality & source details{quote.warnings.length > 0 ? ' (' + quote.warnings.length + ' notes)' : ''}</summary><ul><li>Provider: {quote.provider}; source record: {quote.sourceQuoteId ?? 'not identified in source'}.</li><li>Source file: {providerSourceFiles[quote.provider] ?? 'supplied provider data'}.</li><li>Premium basis: {quote.priceBasis === 'calculated_from_rate_card' ? 'calculated from the supplied rate card' : 'read from the supplied provider file'}.</li><li>Premium breakdown: base {formatMoney(quote.basePremiumInr)}, GST {formatMoney(quote.gstInr)}, total {formatMoney(quote.totalPremiumInr)}.</li><li>Coverage type: {quote.coverageType === 'unknown' ? 'not stated or not recognized in the source' : quote.coverageType.replace('_', ' ')}.</li><li>Quote expiry: {quote.validUntil ? formatDate(quote.validUntil) + ' (' + quote.validityStatus.replaceAll('_', ' ') + ')' : 'not supplied by the source'}.</li>{quote.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
      <button className={isSelected ? 'plan-select-button is-selected' : 'plan-select-button'} type="button" disabled={quote.totalPremiumInr === null} onClick={() => onSelect(quote)}>{isSelected ? 'Selected' : 'Choose this plan'}</button>
    </article>
    })}</div>
    {declines.length > 0 && <details className="declines-panel"><summary>{declines.length} plan/provider decline{declines.length === 1 ? '' : 's'}</summary>{declines.map((decline, index) => <p key={`${decline.provider}-${index}`}><strong>{decline.provider}{decline.planName ? ` · ${decline.planName}` : ''}:</strong> {decline.reason}</p>)}</details>}
    {unavailableDateQuoteCount > 0 && <details className="declines-panel quote-date-exclusions"><summary>{unavailableDateQuoteCount} expired or not-yet-effective quote{unavailableDateQuoteCount === 1 ? ' is' : 's are'} excluded from available plans</summary>{unavailableDateQuotes.map((quote) => <p key={quoteIdentity(quote)}><strong>{quote.provider} · {quote.planName}:</strong> {quote.validityStatus === 'expired' ? 'Expired' + (quote.validUntil ? ' on ' + formatDate(quote.validUntil) : '') : 'Not available for the configured reference date; see source notes for the rate-card effective period.'}</p>)}</details>}
    {sourceWarnings.length > 0 && <details className="declines-panel"><summary>{sourceWarnings.length} provider data note{sourceWarnings.length === 1 ? '' : 's'}</summary>{sourceWarnings.map(({ provider, warning }, index) => <p key={`${provider}-${index}`}><strong>{provider}:</strong> {warning}</p>)}</details>}
    {selected && <div className="selection-banner" role="status"><span><strong>{selected.planName}</strong> from {selected.provider} selected · {formatMoney(selected.totalPremiumInr)}</span><button type="button" onClick={onConfirm}>Review & confirm</button></div>}
    <p className="comparison-disclaimer">Prices are taken from the supplied sample data. Provider C amounts are calculated from its supplied rate card; this is a comparison demo, not a live quote.</p>
  </section>
}

function PolicyDashboard({ policies, comparisons, loading, error, comparisonError, onRetry, onCompare, onOpenComparison }: {
  policies: SavedPolicy[]
  comparisons: SavedComparison[]
  loading: boolean
  error: string
  comparisonError: string
  onRetry: () => void
  onCompare: () => void
  onOpenComparison: (comparison: SavedComparison) => void
}) {
  return <section className="dashboard-screen" aria-labelledby="dashboard-title">
    <div className="dashboard-heading"><div><p className="card-kicker">YOUR AUTOCOVER ACCOUNT</p><h2 id="dashboard-title">Your saved items</h2><p>Saved comparisons and confirmed plan choices.</p></div><button className="primary-button" type="button" onClick={onCompare}>Compare another car <ArrowIcon /></button></div>
    {loading && <div className="dashboard-state"><span className="button-spinner dark-spinner" /> Loading saved items…</div>}
    {error && <div className="provider-alert" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Try again</button></div>}
    {!loading && <section className="saved-comparisons" aria-labelledby="saved-comparisons-title">
      <div className="saved-section-heading"><h3 id="saved-comparisons-title">Saved comparisons</h3><span>{comparisons.length}</span></div>
      {comparisonError && <p className="saved-list-error" role="alert">{comparisonError} <button type="button" onClick={onRetry}>Retry</button></p>}
      {!comparisonError && comparisons.length === 0 && <p className="saved-list-empty">No saved comparisons yet. Select two or three plans and save the comparison to revisit it here.</p>}
      {comparisons.length > 0 && <div className="saved-comparison-list">{comparisons.map((comparison) => <article className="saved-comparison-card" key={comparison.id}>
        <div><span className="card-kicker">{comparison.registration} · Saved {formatDate(comparison.createdAt.slice(0, 10))}</span><h4>{comparison.vehicle.make} {comparison.vehicle.model} {comparison.vehicle.variant}</h4><p>{comparison.plans.map((plan) => plan.provider + ' · ' + plan.planName).join('  /  ')}</p></div>
        <button className="text-button" type="button" onClick={() => onOpenComparison(comparison)}>Revisit comparison <ArrowIcon /></button>
      </article>)}</div>}
    </section>}
    {!loading && !error && <section className="saved-policies" aria-labelledby="saved-policies-title">
    <div className="saved-section-heading"><h3 id="saved-policies-title">Confirmed policies</h3><span>{policies.length}</span></div>
    {policies.length === 0 && <p className="saved-list-empty">No confirmed policies yet. You can confirm a selected plan after comparing quotes.</p>}
    {policies.length > 0 && <div className="policy-list">{policies.map((policy) => <article className="policy-card" key={policy.id}>
      <div className="policy-card-head"><div><span className="card-kicker">{policy.provider}</span><h3>{policy.planName}</h3></div><span className={`policy-status policy-status--${policy.expiryStatus}`}>{policy.expiryStatus === 'expiring_soon' ? 'Expiring soon' : policy.expiryStatus === 'expired' ? 'Expired' : 'Active'}</span></div>
      <div className="policy-vehicle"><span className="plate-icon" aria-hidden="true"><span /></span><div><strong>{policy.vehicle.make} {policy.vehicle.model} {policy.vehicle.variant}</strong><small>{policy.registration} · {policy.vehicle.rto}</small></div></div>
      <div className="policy-facts"><div><span>Premium</span><strong>{formatMoney(policy.premiumInr)}</strong></div><div><span>Policy starts</span><strong>{formatDate(policy.policyStart)}</strong></div><div><span>Policy ends</span><strong>{formatDate(policy.policyEnd)}</strong></div></div>
      <details className="plan-notes"><summary>Plan details</summary><ul><li>Cover: {policy.quote.coverageType.replace('_', ' ')}</li><li>IDV: {formatMoney(policy.quote.idvInr)}</li><li>GST: {formatMoney(policy.quote.gstInr)}</li><li>Reference: {policy.id}</li></ul></details>
    </article>)}</div>}
    </section>}
  </section>
}

function SavedComparisonView({ comparison, onBack }: {
  comparison: SavedComparison
  onBack: () => void
}) {
  return <section className="dashboard-screen saved-comparison-view" aria-labelledby="saved-comparison-title">
    <button className="text-button" type="button" onClick={onBack}><ArrowIcon direction="left" /> Saved items</button>
    <div className="dashboard-heading saved-comparison-title">
      <div><p className="card-kicker">SAVED SNAPSHOT · {comparison.registration}</p><h2 id="saved-comparison-title">{comparison.vehicle.make} {comparison.vehicle.model} comparison</h2><p>{comparison.vehicle.variant} · Saved {formatDate(comparison.createdAt.slice(0, 10))}</p></div>
    </div>
    <p className="saved-snapshot-note">This preserves the supplied plan data as it appeared when saved. Quotes may have expired since then; start a new comparison for current results.</p>
    <SideBySideComparison plans={comparison.plans} readOnly />
    {comparison.plans.some((plan) => plan.warnings.length > 0) && <details className="plan-notes saved-snapshot-notes"><summary>Source and data-quality notes</summary>{comparison.plans.map((plan) => <div key={quoteIdentity(plan)}><strong>{plan.provider} · {plan.planName}</strong><ul>{plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>)}</details>}
  </section>
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path d="M20 3.5 34 9v10.5c0 8-5.8 13.8-14 17-8.2-3.2-14-9-14-17V9l14-5.5Z" stroke="currentColor" strokeWidth="1.6" />
        <path d="m9.5 22 2.2-5.2c.5-1.2 1.5-1.9 2.8-1.9h11c1.2 0 2.3.7 2.8 1.9l2.2 5.2v6.3h-2.6v-2.1h-15v2.1h-2.6V22Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="m12.1 21.8 1.6-3.8c.2-.5.6-.8 1.2-.8h10.2c.5 0 1 .3 1.2.8l1.6 3.8H12.1Z" fill="currentColor" fillOpacity=".16" />
        <circle cx="14.8" cy="23.8" r="1.2" fill="currentColor" />
        <circle cx="25.2" cy="23.8" r="1.2" fill="currentColor" />
      </svg>
    </span>
  )
}

function ArrowIcon({ direction = 'right' }: { direction?: 'left' | 'right' }) {
  return (
    <svg className={direction === 'left' ? 'arrow-icon arrow-icon--back' : 'arrow-icon'} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 10h12m0 0-4.5-4.5M15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CarIllustration() {
  return (
    <svg className="car-illustration" viewBox="0 0 520 270" fill="none" role="img" aria-label="Illustration of a car ready for a policy comparison">
      <ellipse cx="270" cy="225" rx="193" ry="18" fill="#090909" fillOpacity=".12" />
      <path d="m103 177 13-42c5-16 18-27 34-31l72-18c14-4 27-2 39 6l58 39 81 13c16 3 27 14 31 29l9 34H94l9-30Z" fill="#F8F6F2" stroke="#171717" strokeWidth="3" strokeLinejoin="round" />
      <path d="m166 109 58-14c13-3 23-1 34 6l43 30H151l10-15c2-3 3-5 5-7Z" fill="#D8D5CF" stroke="#171717" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m228 96-8 35m45-30 37 30" stroke="#171717" strokeWidth="2.5" />
      <path d="M116 161h39m229 9h31" stroke="#B98C4D" strokeWidth="8" strokeLinecap="round" />
      <path d="M98 184h353" stroke="#171717" strokeWidth="3" strokeLinecap="round" />
      <circle cx="161" cy="196" r="29" fill="#171717" />
      <circle cx="161" cy="196" r="14" fill="#E7E3DB" />
      <circle cx="161" cy="196" r="5" fill="#B98C4D" />
      <circle cx="376" cy="196" r="29" fill="#171717" />
      <circle cx="376" cy="196" r="14" fill="#E7E3DB" />
      <circle cx="376" cy="196" r="5" fill="#B98C4D" />
      <path d="M133 70c15-20 38-31 65-31m177 2 22-12m-30 47 36 3" stroke="#B98C4D" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 8" />
      <circle cx="397" cy="43" r="21" fill="#B98C4D" fillOpacity=".14" />
      <path d="m398 31 10 4v8c0 6-4 10-10 12-6-2-10-6-10-12v-8l10-4Z" fill="#B98C4D" />
      <path d="m394 42 3 3 6-7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function formatDate(value: string | null): string {
  if (!value) return 'Not provided'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`))
}

function registrationLooksValid(value: string): boolean {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/.test(normalized)
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function App() {
  const [registration, setRegistration] = useState('')
  const [screen, setScreen] = useState<Screen>('lookup')
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [draft, setDraft] = useState<Vehicle | null>(null)
  const [draftError, setDraftError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [providerStates, setProviderStates] = useState<Record<ProviderId, ProviderState>>({
    a: { status: 'loading' }, b: { status: 'loading' }, c: { status: 'loading' }, d: { status: 'loading' },
  })
  const [selectedPlan, setSelectedPlan] = useState<NormalizedQuote | null>(null)
  const [showPolicyReview, setShowPolicyReview] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyError, setPolicyError] = useState('')
  const [policies, setPolicies] = useState<SavedPolicy[]>([])
  const [savedComparisons, setSavedComparisons] = useState<SavedComparison[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [comparisonsError, setComparisonsError] = useState('')
  const [activeSavedComparison, setActiveSavedComparison] = useState<SavedComparison | null>(null)
  const [referenceDate, setReferenceDate] = useState('2026-11-10')
  const requestGeneration = useRef(0)
  const providerRequestVersions = useRef<Record<ProviderId, number>>({ a: 0, b: 0, c: 0, d: 0 })

  useEffect(() => {
    let active = true
    void fetch('/api/health')
      .then((response) => response.ok ? response.json() as Promise<{ referenceDate?: string }> : null)
      .then((configuration) => {
        if (active && configuration?.referenceDate) setReferenceDate(configuration.referenceDate)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  async function searchForVehicle(value = registration) {
    const requestId = ++requestGeneration.current
    const cleaned = value.trim().toUpperCase()
    setRegistration(cleaned)
    setError('')
    setVehicle(null)
    setDraft(null)
    setDraftError('')
    setScreen('lookup')

    if (!registrationLooksValid(cleaned)) {
      setError('Enter a valid registration, such as WB 02 AB 1234.')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const found = await lookupVehicle(cleaned)
      if (requestGeneration.current !== requestId) return
      setVehicle(found)
      setDraft({ ...found })
      setDraftError('')
      setScreen('review')
    } catch (lookupError) {
      if (requestGeneration.current !== requestId) return
      setError(lookupError instanceof VehicleLookupError ? lookupError.message : 'We could not look up that vehicle. Please try again.')
    } finally {
      if (requestGeneration.current === requestId) setLoading(false)
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void searchForVehicle()
  }

  function updateDraft<Key extends keyof Vehicle>(key: Key, value: Vehicle[Key]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setDraftError('')
  }

  function confirmVehicle() {
    if (!draft) return
    if (!draft.make.trim() || !draft.model.trim() || !draft.variant.trim() || !draft.rto.trim()) {
      setDraftError('Enter the make, model, variant and registration city before continuing.')
      return
    }
    if (!isValidDateOnly(draft.registrationDate) || draft.registrationDate > referenceDate) {
      setDraftError('Enter a valid registration date that is not after the configured reference date.')
      return
    }
    if (draft.currentPolicyExpiry !== null
      && (!isValidDateOnly(draft.currentPolicyExpiry) || draft.currentPolicyExpiry < draft.registrationDate)) {
      setDraftError('Enter a valid policy expiry date on or after the vehicle registration date, or leave it blank.')
      return
    }
    setVehicle({ ...draft, make: draft.make.trim(), model: draft.model.trim(), variant: draft.variant.trim(), rto: draft.rto.trim() })
    setDraftError('')
    setScreen('confirmed')
  }

  async function startComparison() {
    if (!vehicle) return
    const requestId = ++requestGeneration.current
    setScreen('compare')
    setSelectedPlan(null)
    setProviderStates({ a: { status: 'loading' }, b: { status: 'loading' }, c: { status: 'loading' }, d: { status: 'loading' } })
    const ids: ProviderId[] = ['a', 'b', 'c', 'd']
    await Promise.all(ids.map(async (id) => {
      const providerRequestId = ++providerRequestVersions.current[id]
      try {
        const result = await fetchProviderQuotes(id, vehicle.registration)
        if (requestGeneration.current === requestId && providerRequestVersions.current[id] === providerRequestId) setProviderStates((current) => ({ ...current, [id]: { status: 'success', result } }))
      } catch (requestError) {
        if (requestGeneration.current === requestId && providerRequestVersions.current[id] === providerRequestId) setProviderStates((current) => ({ ...current, [id]: { status: 'error', message: requestError instanceof Error ? requestError.message : 'Provider request failed.' } }))
      }
    }))
  }

  async function retryProvider(id: ProviderId) {
    if (!vehicle) return
    const requestId = requestGeneration.current
    const providerRequestId = ++providerRequestVersions.current[id]
    setProviderStates((current) => {
      const state = current[id]
      const previousResult = state.status === 'success' ? state.result : state.previousResult
      return { ...current, [id]: { status: 'loading', ...(previousResult ? { previousResult } : {}) } }
    })
    try {
      const result = await fetchProviderQuotes(id, vehicle.registration)
      if (requestGeneration.current === requestId && providerRequestVersions.current[id] === providerRequestId) setProviderStates((current) => ({ ...current, [id]: { status: 'success', result } }))
    } catch (retryError) {
      if (requestGeneration.current === requestId && providerRequestVersions.current[id] === providerRequestId) setProviderStates((current) => {
        const state = current[id]
        const previousResult = state.status === 'success' ? state.result : state.previousResult
        return { ...current, [id]: { status: 'error', message: retryError instanceof Error ? retryError.message : 'Provider request failed.', ...(previousResult ? { previousResult } : {}) } }
      })
    }
  }

  async function openDashboard() {
    const requestId = ++requestGeneration.current
    setScreen('dashboard')
    setActiveSavedComparison(null)
    setDashboardLoading(true)
    setDashboardError('')
    setComparisonsError('')
    const [policyResult, comparisonResult] = await Promise.allSettled([getPolicies(), getSavedComparisons()])
    if (requestGeneration.current === requestId) {
      if (policyResult.status === 'fulfilled') setPolicies(policyResult.value)
      else setDashboardError(policyResult.reason instanceof Error ? policyResult.reason.message : 'Could not load saved policies.')
      if (comparisonResult.status === 'fulfilled') setSavedComparisons(comparisonResult.value)
      else setComparisonsError(comparisonResult.reason instanceof Error ? comparisonResult.reason.message : 'Could not load saved comparisons.')
    }
    if (requestGeneration.current === requestId) setDashboardLoading(false)
  }

  async function saveCurrentComparison(comparisonVehicle: Vehicle, plans: NormalizedQuote[]): Promise<void> {
    const comparison = await persistComparison(comparisonVehicle, plans)
    setSavedComparisons((current) => [comparison, ...current.filter((item) => item.id !== comparison.id)])
  }

  function revisitComparison(comparison: SavedComparison) {
    setActiveSavedComparison(comparison)
    setScreen('saved-comparison')
  }

  async function confirmSelectedPolicy() {
    if (!vehicle || !selectedPlan) return
    setSavingPolicy(true)
    setPolicyError('')
    try {
      await savePolicy(vehicle, selectedPlan)
      setShowPolicyReview(false)
      await openDashboard()
    } catch (saveError) {
      setPolicyError(saveError instanceof Error ? saveError.message : 'Could not save this policy.')
    } finally { setSavingPolicy(false) }
  }

  function resetLookup() {
    requestGeneration.current += 1
    setError('')
    setLoading(false)
    setScreen('lookup')
    setVehicle(null)
    setDraft(null)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#top" aria-label="AutoCover home">
            <BrandMark />
            <span className="brand-wordmark">Auto<span>Cover</span></span>
          </a>
          <nav className="main-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#why-autocover">Why AutoCover</a>
          <button className="header-policy-link" type="button" onClick={() => void openDashboard()}>My saved items</button>
          </nav>
          <button className="mobile-policy-link" type="button" onClick={() => void openDashboard()}>Saved items</button>
          <a className="header-cta" href="#vehicle-search" onClick={() => { if (screen === 'dashboard' || screen === 'saved-comparison') resetLookup() }}>Start comparing <ArrowIcon /></a>
        </div>
      </header>

      <main id="top">
        <section className="hero-section" id="vehicle-search">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-dot" /> A clearer way to renew</div>
              <h1>Good cover starts with <em>one detail.</em></h1>
              <p className="hero-description">Tell us your car’s registration once. We’ll bring the important details together so you can compare cover with confidence.</p>

              <div className="progress-track" aria-label="Your comparison steps">
                <div className={`progress-step ${screen !== 'lookup' ? 'is-complete' : 'is-current'}`}>
                  <span className="step-marker">{screen === 'lookup' ? '01' : '✓'}</span>
                  <span>Vehicle</span>
                </div>
                <span className={`progress-line ${screen !== 'lookup' ? 'is-complete' : ''}`} />
                <div className={`progress-step ${screen === 'confirmed' || screen === 'compare' || screen === 'dashboard' || screen === 'saved-comparison' ? 'is-current' : ''}`}>
                  <span className="step-marker">02</span>
                  <span>Compare</span>
                </div>
                <span className="progress-line" />
                <div className="progress-step">
                  <span className="step-marker">03</span>
                  <span>Choose</span>
                </div>
              </div>

              {screen === 'lookup' && (
                <form className="lookup-card" onSubmit={handleSearch} noValidate>
                  <label className="field-label" htmlFor="registration">Vehicle registration number</label>
                  <div className={`registration-field ${error ? 'has-error' : ''}`}>
                    <span className="plate-icon" aria-hidden="true"><span /></span>
                    <input
                      id="registration"
                      name="registration"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={15}
                      placeholder="e.g. WB 02 AB 1234"
                      value={registration}
                      onChange={(event) => {
                        setRegistration(event.target.value.toUpperCase())
                        if (error) setError('')
                      }}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'registration-error' : 'registration-hint'}
                    />
                    {registration && <button type="button" className="clear-input" aria-label="Clear registration" onClick={() => { setRegistration(''); setError('') }}>×</button>}
                  </div>
                  {error ? <p className="form-error" id="registration-error" role="alert">{error}</p> : <p className="field-hint" id="registration-hint">Spaces and hyphens are fine. We’ll tidy the format for you.</p>}
                  <button className="primary-button" type="submit" disabled={loading || !registration.trim()}>
                    {loading ? <><span className="button-spinner" /> Finding your car…</> : <>Find my car <ArrowIcon /></>}
                  </button>
                  <div className="sample-row">
                    <span>Want to explore?</span>
                    <button type="button" onClick={() => void searchForVehicle('WB 02 AB 1234')}>Try a sample car</button>
                  </div>
                  <div className="privacy-note"><span className="lock-icon" aria-hidden="true">◆</span> Your details are used only to find matching plans.</div>
                </form>
              )}

              {screen === 'review' && draft && (
                <section className="review-card" aria-labelledby="review-title">
                  <div className="review-heading">
                    <div>
                      <p className="card-kicker">VEHICLE FOUND</p>
                      <h2 id="review-title">Please check these details</h2>
                    </div>
                    <span className="verified-pill"><span /> Registry match</span>
                  </div>
                  <div className="registration-summary">
                    <span className="summary-label">Registration</span>
                    <strong>{vehicle?.registration}</strong>
                    <button type="button" onClick={resetLookup}>Change</button>
                  </div>
                  <div className="vehicle-fields">
                    <label className="form-field">
                      <span>Make</span>
                      <input value={draft.make} onChange={(event) => updateDraft('make', event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Model</span>
                      <input value={draft.model} onChange={(event) => updateDraft('model', event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Variant</span>
                      <input value={draft.variant} onChange={(event) => updateDraft('variant', event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Fuel type</span>
                      <select value={draft.fuelType ?? ''} onChange={(event) => updateDraft('fuelType', event.target.value || null)}>
                        <option value="">Select fuel</option>
                        <option>Petrol</option><option>Diesel</option><option>CNG</option><option>Electric</option><option>Hybrid</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Registration date</span>
                      <input type="date" max={referenceDate} value={draft.registrationDate} onChange={(event) => updateDraft('registrationDate', event.target.value)} />
                    </label>
                    <label className="form-field">
                      <span>Registration city</span>
                      <input value={draft.rto} onChange={(event) => updateDraft('rto', event.target.value)} />
                    </label>
                    <label className="form-field form-field--wide">
                      <span>Current policy expiry <small>Optional</small></span>
                      <input type="date" value={draft.currentPolicyExpiry ?? ''} onChange={(event) => updateDraft('currentPolicyExpiry', event.target.value || null)} />
                    </label>
                  </div>
                  {draftError && <p className="form-error" role="alert">{draftError}</p>}
                  <div className="review-footnote"><span className="info-icon">i</span> You can correct any detail before comparing plans.</div>
                  <div className="review-actions">
                    <button className="text-button" type="button" onClick={resetLookup}><ArrowIcon direction="left" /> Back</button>
                    <button className="primary-button" type="button" onClick={confirmVehicle}>Confirm car details <ArrowIcon /></button>
                  </div>
                </section>
              )}

              {screen === 'confirmed' && vehicle && (
                <section className="confirmed-card" aria-live="polite">
                  <div className="confirmation-icon"><span>✓</span></div>
                  <p className="card-kicker">DETAILS CONFIRMED</p>
                  <h2>Your car is ready to compare.</h2>
                  <p>We’ve confirmed <strong>{vehicle.make} {vehicle.model} {vehicle.variant}</strong> for registration <strong>{vehicle.registration}</strong>.</p>
                  <div className="confirmed-expiry">Current policy expiry <strong>{formatDate(vehicle.currentPolicyExpiry)}</strong></div>
                  <div className="next-step-note"><span className="next-step-number">02</span><span><strong>Next up: compare plans</strong><small>We’ll bring prices, cover and add-ons together in one clear view.</small></span></div>
                  <button className="primary-button compare-start" type="button" onClick={() => void startComparison()}>Compare available plans <ArrowIcon /></button>
                  <button className="text-button edit-details" type="button" onClick={() => { setDraft({ ...vehicle }); setScreen('review') }}>Review details <ArrowIcon /></button>
                </section>
              )}

              {screen === 'compare' && vehicle && <CompareScreen vehicle={vehicle} states={providerStates} onRetry={(id) => void retryProvider(id)} onBack={() => setScreen('confirmed')} selected={selectedPlan} onSelect={setSelectedPlan} onConfirm={() => { setPolicyError(''); setShowPolicyReview(true) }} onSaveComparison={saveCurrentComparison} />}

              {screen === 'dashboard' && <PolicyDashboard policies={policies} comparisons={savedComparisons} loading={dashboardLoading} error={dashboardError} comparisonError={comparisonsError} onRetry={() => void openDashboard()} onCompare={resetLookup} onOpenComparison={revisitComparison} />}
              {screen === 'saved-comparison' && activeSavedComparison && <SavedComparisonView comparison={activeSavedComparison} onBack={() => setScreen('dashboard')} />}

              {showPolicyReview && vehicle && selectedPlan && <div className="confirm-overlay"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="policy-review-title">
                <button className="dialog-close" type="button" aria-label="Close confirmation" onClick={() => setShowPolicyReview(false)}>×</button>
                <p className="card-kicker">MOCK POLICY CONFIRMATION</p><h2 id="policy-review-title">Review your choice</h2>
                <p className="dialog-intro">Please check the selected plan and vehicle before saving it to your policy dashboard.</p>
                <div className="dialog-summary"><div><span>Plan</span><strong>{selectedPlan.provider} · {selectedPlan.planName}</strong></div><div><span>Vehicle</span><strong>{vehicle.make} {vehicle.model} · {vehicle.registration}</strong></div><div><span>Total premium</span><strong>{formatMoney(selectedPlan.totalPremiumInr)}</strong></div><div><span>Cover / IDV</span><strong>{selectedPlan.coverageType.replace('_', ' ')} · {formatMoney(selectedPlan.idvInr)}</strong></div><div><span>Add-ons</span><strong>{selectedPlan.addons.length ? selectedPlan.addons.map((item) => item.sourceLabel).join(', ') : 'None listed'}</strong></div><div><span>Quote valid through</span><strong>{formatDate(selectedPlan.validUntil)}</strong></div><div><span>Policy term</span><strong>One year, starting after the current policy expires when provided</strong></div></div>
                {selectedPlan.warnings.length > 0 && <div className="dialog-caveat">{selectedPlan.warnings[0]}</div>}
                {policyError && <p className="form-error" role="alert">{policyError}</p>}
                <div className="dialog-actions"><button className="text-button" type="button" disabled={savingPolicy} onClick={() => setShowPolicyReview(false)}>Go back</button><button className="primary-button" type="button" disabled={savingPolicy} onClick={() => void confirmSelectedPolicy()}>{savingPolicy ? <><span className="button-spinner" /> Saving…</> : <>Confirm and save <ArrowIcon /></>}</button></div>
              </section></div>}
            </div>

            <aside className="visual-panel" id="how-it-works">
              <div className="panel-topline"><span>LESS SEARCHING. MORE CLARITY.</span><span className="panel-index">01 / 03</span></div>
              <div className="illustration-wrap"><CarIllustration /></div>
              <div className="panel-copy">
                <p className="panel-kicker">YOUR RENEWAL, SIMPLIFIED</p>
                <h2>One car. A clearer view of your options.</h2>
                <p>Start with your registration. Review your car, then compare plans on what matters to you.</p>
              </div>
              <div className="panel-points">
                <div><span className="point-number">01</span><span>Check your vehicle details</span><span className="point-check">✓</span></div>
                <div><span className="point-number">02</span><span>Compare cover side by side</span><span className="point-check">✓</span></div>
                <div><span className="point-number">03</span><span>Keep your choice in one place</span><span className="point-check">✓</span></div>
              </div>
              <div className="panel-note"><span className="sparkle">✳</span> Built around your car, not a one-size-fits-all quote.</div>
            </aside>
          </div>
        </section>

        <section className="trust-strip" id="why-autocover" aria-label="AutoCover principles">
          <div className="trust-inner">
            <div><span className="trust-icon">01</span><span><strong>Clear comparisons</strong><small>Price is one part of the picture.</small></span></div>
            <div><span className="trust-icon">02</span><span><strong>Your details, once</strong><small>Review before moving ahead.</small></span></div>
            <div><span className="trust-icon">03</span><span><strong>Informed choices</strong><small>Understand what each plan includes.</small></span></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="#top"><BrandMark /><span>AutoCover</span></a>
        <span>Compare thoughtfully. Choose confidently.</span>
        <span className="footer-reference">Reference date · {formatDate(referenceDate)}</span>
      </footer>
    </div>
  )
}

export default App
