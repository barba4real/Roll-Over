/**
 * Learned Team Aliases — self-populating name → canonical bindings.
 *
 * Distinct from the hand-curated TEAM_ALIASES map in team-aliases.ts. When the
 * evidence-based resolver (match-resolver.ts) confirms that a crawled team name
 * refers to a known club — via corroborating signals like a matching opponent,
 * date and league — it records the binding here so we never have to re-resolve
 * that name again. Kept separate so a bad auto-binding can be cleared without
 * touching the curated aliases.
 *
 * Storage: localStorage (survives restarts, no DB round-trip needed). Each entry
 * maps a normalized variant name → canonical name + a short "why" provenance.
 */

const STORE_KEY = 'rollover_learned_aliases_v1';

export interface LearnedAlias {
  canonical: string;   // e.g. "Willem II"
  why: string;         // provenance e.g. "opponent+date+league"
  learnedAt: number;   // timestamp
}

// variantKey (lowercased, trimmed) → LearnedAlias
let store: Record<string, LearnedAlias> | null = null;

function load(): Record<string, LearnedAlias> {
  if (store) return store;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    store = raw ? JSON.parse(raw) : {};
  } catch {
    store = {};
  }
  return store!;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store || {}));
  } catch { /* non-fatal */ }
}

function keyOf(name: string): string {
  return (name || '').toLowerCase().trim();
}

/** Look up a learned canonical name for a variant. Returns null if none. */
export function getLearnedCanonical(name: string): string | null {
  const k = keyOf(name);
  if (!k) return null;
  const hit = load()[k];
  return hit ? hit.canonical : null;
}

/**
 * Record a learned binding. No-op if the variant already maps to the same
 * canonical. Overwrites an older binding only if the new one has stronger
 * provenance (opponent-corroborated beats name-only).
 */
export function learnAlias(variant: string, canonical: string, why: string): void {
  const k = keyOf(variant);
  const canon = (canonical || '').trim();
  if (!k || !canon) return;
  if (keyOf(canon) === k) return; // identity — nothing to learn

  const map = load();
  const existing = map[k];
  if (existing && existing.canonical === canon) return; // already known

  map[k] = { canonical: canon, why, learnedAt: Date.now() };
  persist();
}

/** All learned aliases (for display / debugging). */
export function getAllLearnedAliases(): Record<string, LearnedAlias> {
  return { ...load() };
}

/** Remove one learned binding by its variant name. */
export function forgetAlias(variant: string): void {
  const k = keyOf(variant);
  const map = load();
  if (map[k]) { delete map[k]; persist(); }
}

/** Clear every learned binding (curated aliases are untouched). */
export function clearLearnedAliases(): void {
  store = {};
  persist();
}
