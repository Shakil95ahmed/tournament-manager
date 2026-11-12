/**
 * Normalises a name for duplicate detection only. The original spelling is
 * always kept for display, so "Léa  Dupont" and "lea dupont" collide.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Key for a doubles team: the two player keys sorted, so the same pair can
 * never be entered twice, regardless of pairing order.
 */
export function participantKey(playerNames: string[]): string {
  return playerNames.map(normalizeName).sort().join(' + ');
}

export function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
