import type { Server } from '../../../shared/types'

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** Monthly totals per currency; currencies are not converted. */
export function totalsByCurrency(servers: Server[]): [string, number][] {
  const totals = new Map<string, number>()
  for (const s of servers) {
    if (s.monthlyCost > 0) totals.set(s.currency, (totals.get(s.currency) ?? 0) + s.monthlyCost)
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])
}

export function serverAddress(s: Server): string {
  if (s.host)
    return `${s.username ? s.username + '@' : ''}${s.host}${s.port !== 22 ? ':' + s.port : ''}`
  return s.sshAlias ? `ssh ${s.sshAlias}` : '—'
}
