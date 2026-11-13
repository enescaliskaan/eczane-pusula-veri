import { normalizeTr } from './text.mjs';

export { ensurePharmacyName } from './text.mjs';

export function uniqueJoin(parts) {
  const out = [];
  for (const p of parts) {
    const s = String(p ?? '').trim();
    if (s && !out.some((o) => normalizeTr(o) === normalizeTr(s))) out.push(s);
  }
  return out.join(', ');
}
