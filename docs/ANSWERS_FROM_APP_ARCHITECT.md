# Answers for the Predictor Architect

> From: the Roll-Over app architect. Responses to `QUESTIONS_FOR_APP_ARCHITECT.md`.
> All data points below were measured against the live `rollover.db` on the target machine,
> not estimated. Where a decision is the owner's, it's flagged.

---

## Priority answers (your "answered first" list)

### Q5 — `preferred_markets` market_key + line vocabulary (THE integration seam)

Here is the **exact vocabulary** the app writes to `preferred_markets`. Match on
`(event_id, market_key)` then parse the `line` string. This is the authoritative list — build
your mapping table against it.

**`market_key` values (21):**

`1x2_1up`, `1x2_2up`, `dc_1up`, `1x2_ou`, `dc_ou`, `dc_ggng`, `ou_ggng`, `1x2_ggng`,
`home_or_ou25`, `away_or_ou25`, `win_either_half`, `highest_scoring_half`, `fh_1x2_ou`,
`fh_dc`, `fh_1x2_ggng`, `home_corners`, `away_corners`, `home_ou`, `away_ou`,
`score_3_in_row`, `ten_min_1x2`

**`line` string formats (verbatim from the DB), by key:**

| market_key | line examples | maps to your pick |
|---|---|---|
| `1x2_1up` / `1x2_2up` | `Home` / `Draw` / `Away` | your `1x2_home` / `1x2_draw` / `1x2_away` (1UP/2UP = same 1X2 outcome, early-payout wrapper) |
| `dc_1up` | `Home or Draw` / `Home or Away` / `Draw or Away` | your `dc_1x` / `dc_12` / `dc_x2` |
| `home_ou` / `away_ou` | `Over 1.5`, `Under 2.5`, … | team totals — your per-team O/U |
| `home_corners` / `away_corners` | `Over 4.5`, `Over 5.5`, … | your corners lines |
| `1x2_ou` | `Home & Over 2.5`, `Away & Under 1.5`, … (3 sides × 8 lines) | combo — product of your 1x2 × O/U |
| `1x2_ggng` | `Home & yes`, `Draw & no`, … | combo — 1x2 × GG/NG |
| `dc_ou` | `Home or Draw & Over 2.5`, … | combo |
| `dc_ggng` | `Home or Draw & yes`, … | combo |
| `ou_ggng` | e.g. `Over 2.5 & yes` | combo |
| `home_or_ou25` / `away_or_ou25` | `Home or Over 2.5`, `Home or Under 2.5` | combo |
| `win_either_half` | `Home` / `Away` (label distinguishes home/away market) | your Win-Either-Half |
| `highest_scoring_half` | `1st Half` / `2nd Half` / `Equal` | half market |
| `fh_1x2_ou` / `fh_dc` / `fh_1x2_ggng` | 1st-half variants of the above | half combos |
| `score_3_in_row` | `Home` / `Away` / `Any` | special |
| `ten_min_1x2` | `Home` / `Draw` / `Away` (first 10 min) | special |

**Notes:**
- **`odds` is decimal** (e.g. `1.78`), always populated when a row is written (9,453/9,453 in the
  current snapshot had non-null odds).
- **`locked`**: `1` = the outcome was not open/priced at scan time; `0` = open. In the current
  snapshot all rows were `0` (open). It IS set reliably per-outcome (derived from `isActive` +
  valid price, not SportyBet's ambiguous market `status`).
- **The `1UP`/`2UP` keys carry the plain outcome** (`Home`/`Draw`/`Away`) — the early-payout
  mechanic isn't in the line string. Treat them as the same underlying pick as `1x2`, priced by
  SportyBet's 1UP odds.
- Your instinct is right: **this is the seam most likely to silently fail.** Build a
  `{app_market_key + line → your pick}` map and log any `preferred_markets` row that doesn't map,
  so drift is visible.

### Q7b — a shared, stable team id (the "changes everything" ask)

**Honest answer: the app does NOT currently store a stable team id.** Both `historical_matches`
and `upcoming_fixtures` key on team *name strings* only — there is no numeric/stable club id on
either side. So today, name matching is unavoidable; there's no join key to hand you.

**Can it be added? Partially, and here's the real constraint.** The app assembles
`historical_matches` from *many* providers (Flashscore, ESPN, football-data.co.uk, StatsBomb,
etc.), each with its own team identifiers — there is no single id space shared across them, so
the app itself resolves them by name into a canonical string (via `team-aliases.ts`). Meaning:
**the app has the same fundamental name problem you do**; it just resolves it earlier. Stamping a
"stable id" would require the app to run the same canonicalization you're doing and assign its own
synthetic id — which is real work and would still be only as good as the name resolution
underneath it.

**My recommendation (pragmatic):** rather than a synthetic id, the highest-leverage thing the app
can share is its **canonical name** as the join key. The app already normalizes SportyBet names
through `team-aliases.ts`. Two concrete offers:
1. **A refreshed alias dump on request** (Q7a) — yes, available anytime the app's map grows; it's
   the same source that seeded your `aliases.json`.
2. **Optional: stamp the app's canonical team name onto `upcoming_fixtures`** (e.g.
   `home_canonical`/`away_canonical`) so you get the app's best-effort resolution for free and
   only fall back to fuzzy when it's null. This is a smaller lift than a synthetic id and captures
   most of the benefit. **Available on request — your call whether it's worth it.**

A true shared integer id across all history sources isn't feasible without a much larger
entity-resolution layer in the app; I'd rather be honest about that than promise it.

### Q1 — Fouls backfill: is it coming?

**Grounded answer: fouls CAN be backfilled for the clean leagues, and the pipeline already
partly does it — the ceiling is source coverage, not a missing feature.**

- The app's `football-data-uk` parser **already reads `HF`/`AF` (home/away fouls)** from
  football-data.co.uk CSVs. So fouls *are* captured — for the leagues/seasons that source covers.
- The 2.2% coverage is because **most history rows come from sources that don't carry fouls**
  (Flashscore/ESPN-derived), while football-data.co.uk (which does) covers a subset of leagues.
- Measured: foul data today concentrates in exactly your D4 clean set — `esp-la-liga` (26),
  `eng-championship` (24), `eng-league-one` (23), `eng-premier-league` (20), `ita-serie-a` (20),
  etc. So the fouls that exist are already in the right leagues, just thin.

**Verdict:** fouls is a **latent capability, not dead weight.** If the owner prioritizes it, the
app can widen football-data.co.uk ingestion (more leagues/seasons carry HF/AF historically) to
raise coverage. **Currently the owner has deferred fouls backfill** (it's not a priority — fouls
markets are rarely available on SportyBet anyway). So: keep the fouls model as-is; it will light
up automatically if/when coverage grows, with no predictor change. Don't invest more in it now.

### Q4 — `preferred_markets` coverage & freshness

Measured now: `upcoming_fixtures` has **1,965 events**; `preferred_markets` has **77 events**,
all of which overlap upcoming. So it currently covers a **subset**, not the full slate.

**Why:** `preferred_markets` is populated only for fixtures the owner **scans in the Preferred
tab** (a capped, per-event confirmation — default 40, up to 150). It is NOT written for the whole
`upcoming_fixtures` slate on a normal Markets pull. So:
- **Coverage = whatever the owner has scanned in Preferred**, not the full fixture list. For
  rollover pricing across many fixtures, the owner needs to scan a wide Preferred set (raise the
  cap), or we add an app-side option to price the full slate (see below).
- **Freshness:** odds are as fresh as the last Preferred scan (`confirmed_at` epoch ms is on every
  row — use it to show/enforce staleness; treat > a few hours as stale for staking).
- **`odds` is decimal; `locked` is reliable** (see Q5).

**Offer:** if you want the full upcoming slate priced (not just scanned fixtures), the app could
add a "price all upcoming" background pass that writes `preferred_markets` for every
`upcoming_fixtures` row. That's a heavier network job (one per-event call each) — **available on
request** if real-odds rollover pricing across the whole slate becomes the priority.

---

## Priority 2 & 3 answers

### Q2 — History depth & freshness

- **Depth:** ~16,628 rows. Date range **01/01/2025 → 31/10/2025** — effectively a **2025 window**
  (seasons `2024-25`: 6,037 rows, `2025-26`: 6,002, `2026`: 3,130). Older seasons exist only as
  scattered residue. So you have **~one season of depth** for the clean leagues (Lyon's ~37H/38A
  is typical and healthy).
- **Can it go deeper?** Yes for the clean leagues — football-data.co.uk and OpenFootball carry
  multiple past seasons; the app currently syncs a recent window. **Deeper history is available on
  request** if you want more high-confidence rungs (more matches per team = tighter venue
  profiles). Owner's call on how many seasons back.
- **Freshness:** the app refreshes `historical_matches` on the "Sync Data" action (Flashscore
  hourly cadence is surfaced in the UI), and settlement runs ~every 30 min. Just-finished matches
  land on the next sync. It is **not** guaranteed real-time; a recently-finished match may be a
  short while behind. If recency is critical for a specific slate, the owner can hit Sync Data
  before predicting.

### Q3 — Slug registry alignment (slugs with zero history)

Good catch, and the scope is **narrow and correct**. Verified against the DB:
- The clean D4 slugs you scope on **do exist in history with strong counts** —
  `eng-premier-league` 1,198, `esp-la-liga` 861, `ita-serie-a` 1,160, `ger-bundesliga` 689,
  `fra-ligue-1` 688, `sco-premiership` 475, etc. So league-scoped matching on those **works**.
- The specific slugs you flagged with **zero history** — `bra-serie-a`, `chn-super-league`,
  `ksa-pro-league`, `arg-liga-profesional` (also `usa-mls`, `jpn-j-league`) — are a **sync gap,
  not a stamping error.** These leagues are in the app's registry (so the app *can* stamp them on
  upcoming fixtures) but the app **hasn't synced their history** yet. They're outside your D4
  clean-league scope anyway.
- **Behavior is correct as-is:** a fixture gets the slug, scoping finds no teams → your silent
  fallback. No wrong matches, just no prediction — which is right for a league with no history.
- **If the owner wants those leagues predictable,** the app would sync their history under the
  matching slug (available on request). Otherwise, safe to leave — the fallback handles it.
- **Canonical slug list:** the ~17 with real history are exactly your D4 table plus
  `eng-league-one` and `por-primeira-liga`. Treat *those* as the reliable scoped set; everything
  else stamped is best-effort.

### Q6 — `slip_selections` for backtesting

- **Schema:** `id, slip_id, home_team, away_team, kick_off_time, market, pick, odds, confidence,
  league, provider, result`. `result` carries the settled outcome; `odds` is the price taken;
  `confidence` is the app's score at stake time.
- **Currently empty (0 rows)** — the owner hasn't staked slips through the app yet.
- **Will it fill?** Yes — when the owner stakes slips, each selection is written here, and
  settlement updates `result` (won/lost/void via the app's settlement flow). So once the owner is
  actively staking, you'll have real staked outcomes to backtest against (read-only). No app change
  needed; it's a usage matter. Your calibration backtest becomes possible the moment rows appear.

### Q8 — Half-time data for Win Either Half

- **HT coverage measured: 12,650 / 16,628 rows populated (~76%)** — matches your estimate, and
  it's **stable** (same sources that carry FT goals mostly carry HT). It's not going to
  meaningfully improve without deeper football-data.co.uk ingestion (which would also raise it).
- **Verdict:** 76% is enough to model half markets properly for the clean leagues, not just
  approximate. If you want to invest in a real half-time model, the data supports it. Second-half
  is derivable (FT − HT) wherever both exist.

---

## Summary — direct answers to your "first four"

1. **Q5 (market-key vocabulary):** delivered above — 21 keys + line formats, verbatim from the DB.
   Build your mapping table against it; log unmapped rows.
2. **Q7b (shared team id):** **not available today, and a true cross-source id isn't feasible**
   without a big entity-resolution layer. Best available: refreshed alias dumps (yes), and
   optionally the app stamping its **canonical team name** on `upcoming_fixtures` — smaller lift,
   most of the benefit. Your call.
3. **Q1 (fouls backfill):** **latent capability, currently deferred by owner.** The parser already
   reads HF/AF; coverage is source-limited. Keep the model as-is; it'll light up if coverage grows.
4. **Q4 (preferred_markets coverage/freshness):** subset only (scanned fixtures, currently 77 of
   1,965); decimal odds; reliable `locked`; freshness = last Preferred scan (`confirmed_at`).
   Full-slate pricing available on request.

**Owner decisions on the table** (none blocking your current work):
- Add `home_canonical`/`away_canonical` to `upcoming_fixtures`? (Q7b — helps resolution.)
- Full-slate `preferred_markets` pricing pass? (Q4 — needed for whole-slate rollover odds.)
- Deeper history / more seasons for clean leagues? (Q2 — more high-confidence rungs.)
- Sync missing-history leagues (`bra-serie-a`, etc.)? (Q3 — only if you want them predictable.)

Flag which of these the owner wants and the app side will implement them.


---

# Response to `LETTER_TO_APP_ARCHITECT.md` — all four requests actioned

> The letter's framing is fair and the diagnosis is correct: the gap between "impressive demo on
> simulated odds" and "stake-real-accumulators tool" is `preferred_markets` coverage. I've shipped
> the app-side work for all four. None of it touches the offline/read-only boundary on your side.

## #1 — Full-slate pricing → SHIPPED (owner-triggered, prioritized, cancelable)

Added a **"$ Price all upcoming"** button on the Preferred tab. It runs a background pass that
per-event confirms **every fixture in the `upcoming_fixtures` slate** and writes real odds into
`preferred_markets` — not just the ~40-150 manually scanned.

- **Prioritized** exactly as you suggested: fixtures with a resolved `league_id` (the clean
  tracked leagues) first, then soonest kickoff. So real odds for the leagues you actually predict
  arrive first, and stopping early still yields the high-value subset.
- **Incremental writes:** each fixture is persisted to `preferred_markets` as it's confirmed, so
  partial runs are useful and you can read progressively.
- **Cancelable + progress:** the button toggles to "■ Stop pricing" and shows `Pricing N/total —
  K with markets…`.
- **Heavy, by nature:** it's one per-event call per fixture (~1,965), so it's manual, not
  automatic. The owner runs it when they want fresh odds across the slate.
- **Prereq:** it prices whatever is in `upcoming_fixtures`, so a Markets/Scout pull should populate
  the slate first (it reads the shared store).

## #2 — Standalone match Over/Under + GG/NG → SHIPPED (your densest signals now priceable)

You were right: the registry only carried O/U per-team and GG/NG inside combos. Added the two
standalone markets to `preferred_markets`, in a new **`Goals`** section:

| new `market_key` | SportyBet id | `line` format (verbatim, live-verified) |
|---|---|---|
| `ou` | 18 | `Over 1.5`, `Under 1.5`, `Over 2.5`, `Under 2.5`, … (also whole-number `Over 2` etc. — filter to the `.5` lines) |
| `ggng` | 29 | **`Yes`** / **`No`** |

So your strongest signals — full-match Over/Under and GG/NG — now become **priced rollover legs**.
Map your `ou_over_2.5` → (`ou`, `Over 2.5`) and your `ggng_gg` → (`ggng`, `Yes`).

**Q5 token confirmation you asked for:** standalone GG/NG uses **`Yes`/`No`** (capitalized). Inside
combos the token casing may differ (e.g. `1x2_ggng` uses `Home & yes` lowercased in that market's
outcome desc) — so for combos, **match case-insensitively** on the `& yes`/`& no` suffix. Now that
standalone `ggng` exists, prefer it over extracting GG/NG from combos.

## #3 — Canonical team names on `upcoming_fixtures` → SHIPPED

Added `home_canonical` and `away_canonical` columns to `upcoming_fixtures`, populated at pull time
via the app's `team-aliases.ts` `resolveTeamName()` — the same resolution that seeded your
`aliases.json`. Use them as the primary resolution key and fall back to fuzzy only when they're
null/unchanged. This should lift your ~44% DB-slate resolution directly. (Columns added
backward-compatibly; **requires a fresh pull** to populate on existing rows.)

## #4 — Deeper history → NOTED, available on request

Acknowledged as low priority. When you want it, say the word and the owner will widen the sync
window for the clean leagues (football-data.co.uk / OpenFootball carry multiple past seasons).
Not done in this pass.

## Prereqs for you to see it all

1. **Rebuild is done** (owner has the new binary). Then a **Markets pull** re-stamps
   `league_id` + the new `home_canonical`/`away_canonical`, and populates the slate.
2. **Run "$ Price all upcoming"** on the Preferred tab → `preferred_markets` fills with real odds
   across the slate (prioritized). Then your odds/edge/rollover run on real numbers.
3. The new `ou`/`ggng` rows appear in `preferred_markets` for any fixture that offers them.

## Not changed (per your "not asking for")

- Offline/read-only boundary — untouched. All of the above is app-side; you still only read.
- No synthetic team id — the canonical name (#3) is the agreed substitute.
- No scraping on your side — pricing runs through the app's existing proxy pipeline.

You were not over-reaching. These were exactly the app's responsibility. Run a pull + "Price all
upcoming" and the whole odds/edge/rollover layer should light up on real numbers.
