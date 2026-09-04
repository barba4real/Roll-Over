# Roll-Over Predictor — Architecture & Build Brief

> **Handoff document for the engineer/agent building the standalone Python prediction app.**
> This app is **entirely separate** from the Roll-Over Tauri project. It shares exactly one
> thing with it: **read-only access to the SQLite database**. Nothing else is coupled.
> Build it in a brand-new folder as its own Windows project with its own git repo.

---

## 1. Mission

Build a standalone Python CLI tool that:

1. **Reads** the Roll-Over SQLite database (read-only) to learn each team's historical profile.
2. **Gets the upcoming fixtures to predict** from either of two offline sources (see §4):
   (a) the **`upcoming_fixtures` table** in the same read-only DB — a durable, accumulating slate
   of SportyBet fixtures the app has pulled (one row per fixture) — or (b) a **pasted list**
   copied from SportyBet. Both are offline; no scraping.
3. **Sorts and predicts** per-market outcomes for those fixtures — with **Team Fouls
   Over/Under as the priority market** — and prints a readable report (plus optional CSV).

The guiding principle discussed with the product owner:

> **Python looks backward** (learns team strengths from history). **The forward-looking
> fixtures come from SportyBet** — either already captured in the DB by the app, or pasted by
> the user. History and fixtures meet at the **team name**.

**Non-goals (do NOT do these):**

- Do **not** scrape SportyBet or any provider, and make **no** network calls. Fixtures come only
  from the read-only DB (`upcoming_fixtures`) or from paste — never from the live web.
- Do **not** write to any table the Roll-Over app owns. If you persist output at all, use
  your **own** table/file. (`upcoming_fixtures` is read-only to you, like every app table.)
- Do **not** import, call, or depend on any Roll-Over TypeScript/Rust code.
- Do **not** *require* the Roll-Over app to be running. (Reading `upcoming_fixtures` works whether
  the app is open or closed — it's just a table in the DB file. Paste remains the fallback when
  the table is absent or stale.)

---

## 2. The one dependency: the database

### Location (confirmed on the target Windows machine)

```
C:\Users\HP\AppData\Roaming\com.rollover.app\rollover.db
```

Generic form for any machine: `%APPDATA%\com.rollover.app\rollover.db`
(`com.rollover.app` is the Tauri app identifier; the SQL plugin stores `rollover.db` there.)

### Access rules

- **Open read-only.** Use SQLite URI mode: `file:...rollover.db?mode=ro`. This guarantees you
  can never corrupt the app's data.
- The app uses **WAL mode**, so concurrent reads are safe even while Roll-Over is open. You do
  not need to close the app to run predictions.
- Make the path a **config value** (CLI flag `--db` or a `config.toml`), defaulting to the path
  above. Also support the user simply **copying `rollover.db` next to the script** as a fallback.

---

## 3. The data you have — `historical_matches`

This is the **only table you need to read.** It holds finished matches with rich stats.
Authoritative schema (from the app's migrations):

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `home_team` | TEXT | **join key** — see §5 |
| `away_team` | TEXT | **join key** |
| `date` | TEXT | ISO-ish date string |
| `time` | TEXT | nullable |
| `season` | TEXT | e.g. "2024/2025" |
| `league_id` | TEXT | league identifier |
| `division` | TEXT | nullable |
| `ft_home_goals` | INTEGER | full-time home goals |
| `ft_away_goals` | INTEGER | full-time away goals |
| `ft_result` | TEXT | **`'H'` \| `'D'` \| `'A'`** (home win / draw / away win) |
| `ht_home_goals` | INTEGER | nullable |
| `ht_away_goals` | INTEGER | nullable |
| `ht_result` | TEXT | nullable, same encoding |
| `home_shots` / `away_shots` | INTEGER | nullable |
| `home_shots_on_target` / `away_shots_on_target` | INTEGER | nullable |
| `home_corners` / `away_corners` | INTEGER | nullable |
| `home_yellows` / `away_yellows` | INTEGER | nullable |
| `home_reds` / `away_reds` | INTEGER | nullable |
| `home_fouls` / `away_fouls` | INTEGER | **nullable — see warning below** |
| `source` | TEXT | which provider supplied the row |

Unique constraint: `(home_team, away_team, date, league_id)`.
Indexes exist on `home_team`, `away_team`, `league_id`, `season`, `date` — lean on them.

### ⚠️ Critical data-quality warnings (read before modeling)

1. **`home_fouls` / `away_fouls` are frequently NULL.** They were added by a later migration and
   only some sources populate them. **Fouls is the priority market, but it is also the sparsest
   column.** Measured on the real DB: of **16,614** rows, only **365 (~2.2%)** carry foul data
   (see Appendix B / D4). Your fouls model must:
   - Count only matches where the foul value is non-null.
   - Report **sample size (n)** alongside every fouls prediction.
   - Refuse to predict (or flag "insufficient data") when n is below a threshold (suggest n ≥ 5
     per team).
2. **Many stat columns are NULL from certain sources** (shots/corners/cards often come as `null`
   from Flashscore/ESPN-derived rows). Never assume a column is populated — always filter
   `WHERE col IS NOT NULL` per-market.
3. **`ft_result` is `'H'/'D'/'A'`, not scores.** Goals live in `ft_home_goals`/`ft_away_goals`.
4. **Team names are provider-inconsistent** (see §5) — the same club may appear under several
   spellings across `source` values.

Other tables exist (`slips`, `slip_selections`, `chains`, `transactions`, `match_cache`,
`prediction_log`, `settings`, `data_sync_log`) — **ignore them.** They belong to the app. The
only one you might *optionally* read later is `slip_selections` (to backtest against real staked
outcomes), but that's a stretch goal, not core.

---

## 4. The fixtures to predict — two offline sources

The upcoming fixtures come from SportyBet, via **either** of two fully-offline paths. Prefer (A);
fall back to (B). Both are read-only; neither makes a network call.

### 4A. Primary: read `upcoming_fixtures` from the DB

The Roll-Over app persists every SportyBet fixture pull into a **durable, accumulating** table in
the same `rollover.db` you already open read-only — **one row per fixture** (`event_id` primary
key). Unlike a snapshot, it is *not* wiped by the next pull, so it grows into a stable slate across
pulls and time-windows. Reading it removes the paste step and gives you SportyBet's exact fixtures
(the book the owner plays), pre-attached to league names.

**Schema (`upcoming_fixtures`):**

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT PK | SportyBet event id, e.g. `sr:match:72221244` |
| `game_id` | TEXT | nullable |
| `home_team` | TEXT | SportyBet spelling — goes through the §5 resolver |
| `away_team` | TEXT | SportyBet spelling |
| `country` | TEXT | e.g. `England` |
| `league_name` | TEXT | e.g. `Premier League` |
| `league` | TEXT | `Country: League`, e.g. `England: Premier League` |
| `league_id` | TEXT | **resolved DB slug** (e.g. `esp-la-liga`) matching `historical_matches.league_id`, or NULL for long-tail leagues the app doesn't track. Use this to league-scope resolution directly — no `league_map.json` needed. |
| `kickoff_ms` | INTEGER | kickoff, epoch **milliseconds** (divide by 1000 for a datetime) |
| `date` | TEXT | `DD/MM` |
| `time` | TEXT | `HH:MM` |
| `has_preferred` | INTEGER | `1` if the fixture offered a preferred market in the pull; else `0` |
| `window` | TEXT | the time-window active when last seen (`''`=all, `3h`, `6h`, `today`, `tomorrow`, `weekend`) |
| `first_seen` | INTEGER | epoch ms the fixture was first stored |
| `last_seen` | INTEGER | epoch ms it was last refreshed by a pull |

Indexed on `kickoff_ms`. The app prunes rows more than ~2 days past kickoff, so the table stays
"upcoming/recent" without unbounded growth.

Read snippet:

```python
rows = con.execute("""
    SELECT home_team, away_team, league, league_name, kickoff_ms, date, time, has_preferred
    FROM upcoming_fixtures
    WHERE kickoff_ms IS NULL OR kickoff_ms >= ?    -- only future/near kickoffs
    ORDER BY kickoff_ms
""", [int(time.time() * 1000)]).fetchall()
# each row: SportyBet team spellings + kickoff in epoch ms -> still resolve via §5
```

**Critical caveats — handle all three:**

1. **Team names are SportyBet's spellings** (`Ipswich Town`, `Man Utd`, …). They go through the
   §5 resolver exactly like pasted names. Reading from the DB removes the *paste* step, not the
   *matching* step.
2. **The table may not exist / may be empty / may be stale.** It's created lazily on the app's
   first pull in the current build. If it's absent or empty, or the newest `last_seen` is older
   than a freshness threshold you choose (e.g. 12h), **fall back to paste (4B)** and say so.
   Surface freshness ("using SportyBet fixtures last refreshed 2h ago").
3. **Coverage reflects what the owner pulled.** A fixture only appears once the app has pulled a
   window that includes it. If a wanted game is missing, either the owner pulls a wider window in
   the app, or you add it via paste (see the `--source` union behavior below).

`has_preferred = 1` means the fixture offered at least one of the owner's preferred markets in the
pull — a weak positive signal, **not** a fouls guarantee. Do not treat it as "has fouls."

#### 4A-legacy. Secondary: `sb_fixture_cache` (single-row snapshot)

The app also keeps a single-row snapshot of the *last* pull in `sb_fixture_cache`
(`id=1`, `payload` JSON, `window`, `pulled_at` epoch ms). It's used by the app UI for fast
whole-list restore. You may read it as a fallback if `upcoming_fixtures` is unavailable, but
**prefer `upcoming_fixtures`** — the snapshot only holds the most recent window and is overwritten
each pull. Its `payload` JSON is `{ "fixtures": [ { eventId, homeTeam, awayTeam, country,
leagueName, league, kickoff (ms), date, time, hasPreferred } ], "leagues": [...] }`.

### 4B. Fallback: pasted fixtures

The user pastes upcoming games copied from SportyBet. **Parse forgivingly.** One fixture per
line; tolerate these separators between the two team names:

```
Man Utd vs Arsenal
Chelsea v Liverpool
Real Madrid - Barcelona
Inter Milan – Napoli        (en-dash)
```

Parsing rules:

- Split on ` vs `, ` v `, ` - `, ` – ` (case-insensitive, surrounding whitespace tolerant).
- Trim whitespace; skip blank lines and lines that don't yield two names.
- Optionally accept trailing metadata (kickoff time, league) after the teams and ignore it if
  not needed — but **teams alone are sufficient** to predict.
- Echo back what was parsed so the user can spot a malformed line.

Input method: read from a text file (`--fixtures fixtures.txt`) **and/or** stdin paste. Support both.

### Source selection

Default to **4A (`upcoming_fixtures`)** when the table exists and is fresh; fall back to the
`sb_fixture_cache` snapshot, then to **4B (paste)**. Expose a `--source {auto,db,paste}` flag
(default `auto`) so the owner can force either. In `auto`, if the DB source is chosen, still allow
`--fixtures` to *supplement* the DB list (union, de-duplicated by team+date) so a fixture missing
from the last pull can be added by paste.

---

## 5. The hard part — team-name matching (this is where accuracy lives)

When the user pastes `Man Utd`, you must find `Manchester United` (or however it's stored) in
`historical_matches`. **If the match fails, there is no history, so no prediction.** Everything
else in this project is easy stats; this join is the whole ballgame.

Implement a **three-tier resolver**, in order:

1. **Normalize + exact match.** Lowercase, strip punctuation, drop common noise tokens (`fc`,
   `cf`, `afc`, `sc`, `club`), collapse whitespace. Compare normalized forms.
2. **Alias table (you own it).** A simple editable file (`aliases.json` / `aliases.csv`):
   `{"man utd": "Manchester United", "man united": "Manchester United", "spurs": "Tottenham
   Hotspur", ...}`. Seed it with common variants; grow it every time you hit a miss. This is the
   most reliable tier.
3. **Fuzzy fallback.** String distance (`rapidfuzz` recommended) against the distinct set of team
   names in the DB. Only accept above a confidence threshold (e.g. token-set ratio ≥ 88). Below
   that → **do not guess.**

**Fail loud, never silent.** When a pasted team can't be confidently resolved, print e.g.
`⚠ No confident match for "Real Betis" — skipped (add to aliases.json to fix)`. Acting on a
phantom prediction is worse than skipping.

> Note for context: the Roll-Over app has its own alias logic in TypeScript (`team-aliases.ts`).
> You are **not** sharing that code, but the product owner can hand you its mappings as a **seed
> list** for your `aliases.json`. Ask for it.

---

## 6. The models (start simple; earn complexity)

For each parsed fixture, resolve both teams, pull their recent finished matches, compute
per-market predictions. **Priority order: Fouls first.**

### 6.1 Team Fouls Over/Under — the priority

- For each team, compute average fouls **committed** over their last N finished matches where the
  foul column is non-null (suggest N = last 10, min 5).
- Combined match fouls estimate ≈ `home_avg_fouls_committed + away_avg_fouls_committed`, with a
  light opponent adjustment (a team draws more fouls against aggressive opponents — optional
  refinement).
- For each line the owner cares about — **11.5 through 22.5** (they explicitly said lines can run
  up to 22.5) — output the estimated probability of Over/Under, plus the **historical hit-rate**
  (share of past matches that landed under/over that line) and the **sample size**.
- Always show n. Flag low-n as low-confidence.

### 6.2 Goals — 1X2 and Over/Under

- **Poisson** model: estimate each team's attack strength and defense strength from goals
  for/against relative to league average, produce expected goals for each side, derive 1X2 and
  O/U 2.5 (and other lines) probabilities.
- **Dixon-Coles** is the natural upgrade once basic Poisson works (corrects low-score
  correlation). Do Poisson first.

### 6.3 Corners & Cards (secondary)

- Same rolling-average approach as fouls, using `*_corners` and `*_yellows`/`*_reds`. Only where
  columns are non-null.

### Modeling discipline

- Every prediction carries: **probability, the sample size it's based on, and a confidence flag.**
- Weight recent matches more if you like (exponential decay), but keep v1 simple.
- Never emit a prediction for a market whose columns are null for that team — say "no data"
  instead.

---

## 7. Output

- **Primary:** a clean terminal table, grouped/sorted (suggest: sort by your confidence, fouls
  market first). Human-readable — the owner eyeballs this while staging bets.
- **Optional:** write a `predictions_YYYYMMDD.csv` for record-keeping.
- **Optional (stretch):** write to your **own** SQLite table (e.g. a separate file
  `predictor.db`, or a clearly namespaced `ml_predictions` table) — but the default should be
  print + CSV. Do **not** write into `rollover.db`.

Suggested columns: `home, away, resolved_home, resolved_away, market, line, pick, probability,
hit_rate, n, confidence`.

---

## 8. Recommended stack & project shape

- **Python 3.11+** on Windows.
- **Standard library `sqlite3`** for DB reads (no ORM needed).
- **pandas** for aggregation, **numpy/scipy** for Poisson, **rapidfuzz** for name matching.
  **scikit-learn / statsmodels** only when you move past rolling averages.
- **No web framework, no GUI** for v1. Plain CLI: `python predict.py --fixtures fixtures.txt`.
  (A Streamlit dashboard is a fine *later* add-on, not v1.)
- Use a **virtual environment** (`python -m venv .venv`) and a `requirements.txt`.

Suggested layout:

```
rollover-predictor/
  predict.py            # CLI entrypoint (--source {auto,db,paste})
  db.py                 # read-only DB access, returns DataFrames
  fixtures.py           # fixture input: read sb_fixture_cache (§4A) + parse paste (§4B)
  resolver.py           # team-name matching (normalize + alias + fuzzy)
  models/
    fouls.py            # priority market
    goals.py            # Poisson 1X2 + O/U
    corners.py
    cards.py
  aliases.json          # you own + grow this
  config.toml           # db path, thresholds, lines
  requirements.txt
  README.md
```

---

## 9. Build order (suggested milestones)

1. **DB reader** — connect read-only to the confirmed path, load `historical_matches` into a
   DataFrame, print row count + distinct team count. Prove the pipe works.
2. **Resolver** — normalize + alias + fuzzy; unit-test against tricky names. Prove the join works
   before any modeling.
3. **Fouls model** — the priority. Rolling averages, lines 11.5–22.5, hit-rates, sample sizes,
   low-n flags.
4. **Fixture input + CLI wiring** — read `sb_fixture_cache` (4A) with paste (4B) fallback and the
   `--source` flag; fixtures in, fouls predictions out, as a table.
5. **Goals (Poisson)** — 1X2 + O/U.
6. **Corners/cards + CSV output.**
7. **(Stretch)** Dixon-Coles, recency weighting, Streamlit dashboard, backtest against
   `slip_selections`.

---

## 10. Definition of done for v1

- Runs on Windows against the real `rollover.db` **read-only**, without the Roll-Over app running.
- Gets fixtures from `sb_fixture_cache` (primary) or paste (fallback), with graceful handling when
  the table is absent/empty/stale; resolves team names with loud failures on misses.
- Produces **Fouls O/U predictions (11.5–22.5) with hit-rates and sample sizes**, plus Poisson
  goals 1X2/O/U, as a readable table.
- Touches nothing the Roll-Over app owns; writes only its own output.
- Has a `README.md` explaining setup (`venv`, `requirements.txt`), the `--db`/`--fixtures` flags,
  and how to grow `aliases.json`.

---

### Appendix — quick verification snippet (for the new agent's first milestone)

```python
import sqlite3, pandas as pd

DB = r"C:\Users\HP\AppData\Roaming\com.rollover.app\rollover.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)   # read-only
df = pd.read_sql_query("SELECT * FROM historical_matches", con)

print("rows:", len(df))
teams = pd.unique(df[["home_team", "away_team"]].values.ravel())
print("distinct teams:", len(teams))
print("rows with fouls:", df["home_fouls"].notna().sum())   # expect this to be LOW

# Upcoming fixtures — durable table (§4A). May not exist yet if the app never pulled.
try:
    n, newest = con.execute(
        "SELECT COUNT(*), MAX(last_seen) FROM upcoming_fixtures"
    ).fetchone()
    print(f"upcoming_fixtures: {n} rows, newest last_seen(ms)={newest}")
except Exception:
    print("upcoming_fixtures: not present yet — use paste (§4B)")
con.close()
```

If `rows with fouls` is small, that is expected — see §3 warning 1. Report it and design the
fouls model around sample-size gating, not around assuming dense data. If `upcoming_fixtures` is
absent/empty, that just means the app hasn't pulled fixtures in the current build yet — the paste
path (§4B) covers that case.

---

## Appendix B — Product-owner decisions (answers to D1 / D3 / D4)

> These are the product owner's answers to the open decision points raised during handoff.
> They are binding for v1. Where they add detail beyond the brief above, the detail wins.

### D1 — Fouls behavior when a team is thin (low sample)

Fouls is the **sparsest** column in `historical_matches` (see §3 warning 1) — measured at only
**~2.2% of rows** (365 of 16,614) — so "thin" is the common case, not an edge case. Design the
fouls model around scarcity from day one.

Required behavior, in priority order:

1. **Hard sample-size gate, per team, per market.** Count only non-null foul rows. Use
   `N = last 10`, hard floor `n ≥ 5` per team. Below the floor: do **not** emit a probability —
   print `insufficient data (n=X)`.
2. **Flagged league baseline via shrinkage.** When a team is thin, back off to a *league-level*
   foul baseline (computed from `league_id` over non-null foul rows), **not** a global one —
   refereeing/foul culture varies by league. Blend with shrinkage rather than a hard switch:

   ```
   team_estimate = (n / (n + k)) * team_avg + (k / (n + k)) * league_avg
   ```

   with `k ≈ 5`. Large `n` → team dominates; tiny `n` → league baseline dominates. Fall back to a
   global baseline only when the league itself has too few foul rows.
3. **Corners/cards as corroboration, not substitution.** Do **not** convert cards into a foul
   estimate (relationship is too noisy). When fouls are thin, surface the team's cards/corners
   profile *alongside* the low-confidence fouls line so the owner can eyeball agreement. If later
   modeled, cards may only nudge the confidence flag — never the primary number.
4. **Confidence flag is mandatory on every fouls row.** Three states:
   - `high`  — `n ≥ 10`, team-driven
   - `medium`— `5 ≤ n < 10`, shrinkage-blended
   - `low`   — baseline-dominated

Refusing to predict is a **valid, expected** output for fouls. Acting on phantom data is worse.

### D3 — Alias seed for `aliases.json`

Provided. The app's hand-curated map (`src/engine/team-aliases.ts`) has been flattened into the
exact `normalized_variant → canonical` shape the resolver's Tier-2 alias step expects and saved
as:

```
docs/predictor-aliases-seed.json
```

- **913 variant keys → 357 distinct canonical clubs**, spanning ~30 competitions
  (Europe Top 5 + secondary Europe, Scandinavia, Turkey, Belgium/Austria/Greece, MLS,
  Brazil/Argentina/Colombia/Mexico, Saudi/Japan/Australia/India/South Africa, plus EFL
  Championship / German 2.Bundesliga / Serie B / Ligue 2).
- Keys are lowercase. Apply the resolver's Tier-1 normalize step (lowercase, strip
  `fc`/`cf`/`afc`/`sc`/`club`, collapse whitespace) to the pasted name **before** looking it up
  here.
- Copy this file's contents into the predictor's own `aliases.json` and **grow it on every
  miss** — it is owned by the predictor from that point on.

### D4 — League priority (scoped from real DB ground truth)

> **Offline boundary (read this first).** The Python predictor is **fully offline**. Its only
> inputs are (1) the **read-only** `rollover.db` — the `historical_matches` learning data, the
> `upcoming_fixtures` slate (§4A), and optionally the `preferred_markets` odds table (Appendix
> D-odds, value-comparison only) — and (2) **fixtures the user pastes** (§4B). It does **not**
> connect to SportyBet, scan any catalog, check live market availability, or make any network call.
> All references to SportyBet below explain *why the database looks the way it does* — they are
> **not** steps the predictor performs. (Reading `upcoming_fixtures` is just a local table read; it
> stays inside this boundary.)

This answer is **derived from the actual `rollover.db`** (read-only probe on the target machine),
not from a preference guess — because the data itself defines the scope. Two facts drive it:

- **Why the foul data is shaped this way (context, not a predictor step):** the *Roll-Over app*
  (the separate Tauri project) populates the DB by scanning SportyBet and only stores foul data
  for competitions that expose a team-fouls market. The predictor never sees or repeats this — it
  just inherits the resulting DB. So the foul data you have already reflects "leagues SportyBet
  offers fouls on," without the predictor doing any scanning.
- **What the predictor acts on:** in the DB, **usable foul history is concentrated in ~15 clean,
  registry-mapped European leagues.** Fouls is the priority market and its data is the only
  constraint that matters offline, so those leagues *are* the scope.

**Observed DB state (probe):** 16,614 rows in `historical_matches`; **only 365 rows carry foul
data (~2.2%)**; **5,313 distinct team names**; `slip_selections` is currently **empty** (nothing
staked yet, so there's no staked-outcome ground truth to scope from — the foul-data distribution
is the best signal available).

**Leagues with foul data present, by non-null foul-row count (the real Tier A/B):**

| league_id | foul rows | total rows |
|---|---:|---:|
| `esp-la-liga` | 26 | 861 |
| `eng-championship` | 24 | 1,140 |
| `eng-league-one` | 23 | 1,140 |
| `esp-la-liga-2` | 22 | 957 |
| `eng-premier-league` | 20 | 1,198 |
| `ita-serie-a` | 20 | 1,160 |
| `ita-serie-b` | 20 | 780 |
| `fra-ligue-1` | 18 | 688 |
| `fra-ligue-2` | 18 | 647 |
| `tur-super-lig` | 18 | 675 |
| `por-primeira-liga` | 16 | 645 |
| `bel-pro-league` | 15 | 656 |
| `ned-eredivisie` | 15 | 645 |
| `gre-super-league` | 13 | 482 |
| `ger-2-bundesliga` | 9 | 639 |
| `ger-bundesliga` | 9 | 689 |
| `sco-premiership` | 7 | 475 |

Everything below these (the `"COUNTRY: Competition Standings"`-style rows) is sparse scrape
residue — near-zero foul coverage and noisy names. **Do not scope the resolver around them.**

**Scope rules for the predictor:**

1. **Restrict the fuzzy candidate set to distinct team names actually present in
   `historical_matches`** — never a global list. A club with no DB history yields no prediction
   anyway, so excluding it costs nothing and removes collision risk. (This alone bounds the
   5,313-name problem.)
2. **Prefer the ~15 clean `league_id`s above.** When a pasted fixture carries league metadata
   (§4), map it to one of these ids and **filter the candidate set by `league_id`** before fuzzy
   matching — this is what kills "Racing" → {Racing Club AR / Racing Santander / Racing Genk}
   collisions.
3. **For fouls specifically, expect scarcity everywhere** (2.2% coverage). Even the top league
   has ~26 foul rows total, so per-team `n` will routinely sit near the `n ≥ 5` floor. This is
   exactly why D1 mandates the league-baseline shrinkage — treat it as the norm, not the
   exception.
4. **Everything outside the clean set:** let the fuzzy tier handle it at token-set ratio ≥ 88 and
   **fail loud** rather than guess. Always print the resolved name so a bad auto-match is caught
   by eye.

**No further input needed from the owner for v1 scope** — the DB answers it. Revisit once
`slip_selections` accumulates real staked rows; at that point, re-scope around the leagues/markets
actually staked (a one-query update to this table).

---

## Appendix C — Additional build suggestions

These extend, but never override, the brief above. All are optional unless promoted into a
milestone by the owner.

**Resolver & data quality**

1. **Ship a `--resolve-only` mode.** Run the resolver over a pasted fixture list and print
   resolved/unresolved names *without* predicting. Fastest way to grow `aliases.json` before a
   betting session.
2. **Persist misses to a log.** Append every unresolved name to `unresolved.log` (or a small
   table in `predictor.db`) so aliases can be batch-triaged later instead of lost to the console.
3. **Guard against ambiguous fuzzy matches.** If the top-2 fuzzy candidates are within a few
   points of each other, treat it as a miss (ambiguous) rather than picking the top one.
4. **Print a data-coverage summary at startup:** total rows, distinct teams, and per-market
   non-null counts (fouls, corners, cards). Makes the sparse-fouls reality visible every run.

**Fouls model**

5. **Show both team lines and the combined line.** Owner bets *team* fouls (per FoulsStrategy)
   and sometimes *match* total — output home-team O/U, away-team O/U, and combined for every line
   11.5–22.5.
6. **Expose `k`, `N`, and the n-floor in `config.toml`.** Let the owner tune shrinkage strength
   and sample requirements without code edits.
7. **Optional light opponent adjustment** (per §6.1): a team draws more fouls against aggressive
   opponents. Keep it behind a config flag; v1 can ship without it.

**Output & workflow**

8. **Stable CSV schema from day one** (`home, away, resolved_home, resolved_away, market, line,
   pick, probability, hit_rate, n, confidence`) so historical CSVs stay comparable as the model
   evolves.
9. **Sort output by confidence, fouls-first**, and visually separate `low`-confidence rows so
   they aren't mistaken for actionable picks.
10. **Backtest against `slip_selections` (stretch, read-only).** Once modeling is stable, compare
    predictions to real staked outcomes to measure true hit-rate. Read-only, never write.

**Safety reminders (non-negotiable)**

11. Open the DB **read-only** (`?mode=ro`) — the single hard rule that protects the app's data.
12. Keep **fail-loud** resolution and the **n ≥ 5** fouls gate as guardrails, not options — this
    tool informs real money at risk; phantom predictions are the primary failure mode to prevent.

---

## Appendix D — Preferred / starred markets (context, not a modeling requirement)

> **Status:** informational. Added after the predictor reported M0–M6 complete. This does **not**
> change v1 scope or the offline boundary. It exists so the architect understands what
> `has_preferred = 1` (on `upcoming_fixtures`, §4A) actually reflects, and where things could go
> later — nothing here is required for the tool to work.

### What "preferred markets" are

The owner has a set of SportyBet ⭐ *favorite* markets — the bet types they specialise in. The
Roll-Over app now mirrors that whole set (≈20 markets), grouped into sections, and surfaces them
in a dedicated **Preferred** tab (non-fouls) plus the existing **Fouls** tab. The current set,
with SportyBet market ids, is:

| Section | Market | SportyBet id(s) |
|---|---|---|
| Early-Payout | 1X2 - 1UP | 60200 |
| Early-Payout | 1X2 - 2UP | 60100 |
| Early-Payout | Double Chance - 1UP | 60110 |
| Combos | 1X2 & Over/Under | 37 |
| Combos | Double Chance & Over/Under | 547 |
| Combos | Double Chance & GG/NG | 546 |
| Combos | Over/Under & GG/NG | 36 |
| Combos | 1X2 & GG/NG | 35 |
| Combos | Home Team or Over/Under 2.5 | 854 / 855 |
| Combos | Away Team or Over/Under 2.5 | 858 / 859 |
| Halves | Win Either Half | 50 / 51 |
| Halves | Highest Scoring Half | 52 / 53 / 54 |
| Halves | 1st Half - 1X2 & Over/Under | 79 |
| Halves | 1st Half - Double Chance | 63 |
| Halves | 1st Half - 1X2 & GG/NG | 78 |
| Corners | Home / Away Team Total Corners | 900300 / 900301 |
| Team Totals | Home / Away Team Over/Under | 19 / 20 |
| Other | To Score 3+ in a Row | 60020 / 60021 / 60022 |
| Other | 10 Minutes - 1X2 | 105 |
| Fouls (own tab) | Home / Away / Match Fouls O/U | 900544 / 900545 / 900342 |

(Correct Score and Handicap were deliberately excluded by the owner.)

### What this means for the predictor — deliberately minimal

1. **You are NOT required to model these markets.** v1 priority is unchanged: **Fouls first**,
   then Poisson goals (1X2 / O/U), then corners/cards. The preferred list is the owner's *betting*
   vocabulary on SportyBet, not a modeling mandate. Do not add combo/half/early-payout models for
   v1.
2. **`has_preferred` is a flag, not a market.** On `upcoming_fixtures`, `has_preferred = 1` means
   the fixture offered *at least one* of these markets when the app pulled it. Treat it exactly as
   §4A already says: a weak positive signal, **not** a guarantee of any specific market (and
   specifically **not** a fouls guarantee). Safe optional use: as a minor sort key (float
   preferred-carrying fixtures up), never as a filter that drops fixtures.
3. **The markets you already model map onto some of these.** Where your existing outputs line up,
   you may *optionally* label them so the owner sees the correspondence — e.g. your goals O/U
   informs "Over/Under", your 1X2 informs "1X2 - 1UP" (the 1UP is just an early-payout wrapper on
   the same 1X2 outcome). This is presentation only; the underlying probability is the same.
4. **Corners** — you already model corners (§6.3). The preferred "Home/Away Team Total Corners"
   (ids 900300/900301) map directly to your per-team corner rolling averages. If corner coverage
   in the DB is reasonable, surfacing a per-team corners O/U line is a natural, low-cost add — but
   still stretch, not v1.

### If the owner ever wants preferred-market modeling (future, not now)

Only relevant if promoted to a milestone later. The combos (1X2 & O/U, DC & GG/NG, etc.) are
**products of marginals you may already estimate** — e.g. P(1X2 & Over 2.5) can be approximated
from your 1X2 model × your goals O/U model under an independence assumption (crude but a starting
point). Halves markets need a half-time goals model (you have `ht_home_goals`/`ht_away_goals` in
`historical_matches` to build it). None of this is needed for v1; it's here so the path is known.

**Bottom line:** keep building fouls + goals as specified. The preferred-market list is context so
you interpret `has_preferred` correctly and know where optional presentation labels or future
models could hook in — it adds **no** v1 obligation.

### D-odds — `preferred_markets` table (confirmed markets + live odds; OPTIONAL, value-only)

The app now also writes a **`preferred_markets`** table to `rollover.db` — the confirmed preferred
markets **with their live SportyBet lines/odds**, captured when the owner scans the Preferred tab.
You can read it read-only like every other table.

**Schema (`preferred_markets`):** one row per `(event_id, market_key, line)`.

| Column | Type | Notes |
|---|---|---|
| `event_id` | TEXT | SportyBet event id (joins to `upcoming_fixtures.event_id`) |
| `home_team` / `away_team` | TEXT | SportyBet spellings (§5 resolver applies) |
| `league` | TEXT | `Country: League` |
| `kickoff_ms` | INTEGER | epoch ms |
| `section` | TEXT | Early-Payout / Combos / Halves / Corners / Team Totals / Other |
| `market_key` | TEXT | stable key (e.g. `1x2_1up`, `dc_ou`, `home_corners`) |
| `market_label` | TEXT | display label (team-agnostic) |
| `line` | TEXT | the specific outcome, e.g. `Over 2.5`, `Home or Over 2.5` |
| `odds` | REAL | live decimal odds (nullable if unpriced) |
| `locked` | INTEGER | `1` if the line was not open/priced when confirmed |
| `confirmed_at` | INTEGER | epoch ms the row was captured |

Primary key `(event_id, market_key, line)`; indexed on `event_id` and `kickoff_ms`; rows are
pruned ~2 days past kickoff. It's populated only when the owner runs a Preferred-tab scan, so it
may be empty/partial — handle absence gracefully, same as the other optional tables.

**Critical — what this is and is NOT for the predictor:**

- **NOT a modeling input.** Do **not** feed these odds into the fouls/goals models. The models
  learn from *history* (`historical_matches`) and get fixtures from `upcoming_fixtures`. Feeding
  SportyBet's own prices into a model whose job is to find value *against* those prices would be
  circular and self-defeating. This stays true to the offline, history-based design.
- **It IS the odds side of an OPTIONAL value check.** The one legitimate use: compare **your
  model's probability** for an outcome against **SportyBet's implied probability** (`1 / odds`)
  to flag *value* — i.e. where your model thinks an outcome is more likely than the price implies.
  This is a **stretch/future** feature, not v1. If pursued: join `preferred_markets` to your
  per-market model output on `event_id` + market, compute `edge = model_prob - (1/odds)`, and
  surface positive-edge lines. Read-only always; never write to this table.

Read snippet (only if/when you build value comparison):

```python
rows = con.execute("""
    SELECT event_id, home_team, away_team, league, section,
           market_key, market_label, line, odds, locked, kickoff_ms
    FROM preferred_markets
    WHERE (kickoff_ms IS NULL OR kickoff_ms >= ?) AND locked = 0 AND odds IS NOT NULL
    ORDER BY kickoff_ms
""", [int(time.time() * 1000)]).fetchall()
# implied_prob = 1 / odds ; value = your_model_prob - implied_prob
```

---

## Appendix E — Responses to the architect's post-M0–M6 integration flags

> The architect completed M0–M6 and raised three integration observations plus the stretch
> backlog. Owner responses below. These are **advisory** — none block current use.

### E1 — Fouls is data-starved (2.2%); D2 backfill is the highest-leverage next step

Correct, and acknowledged. **The owner has explicitly deferred D2 (fouls backfill) and does not
want it pursued right now.** Keep the model exactly as built: honest, low-confidence baseline
lines with visible `n` and the D1 shrinkage. Do **not** attempt to backfill fouls from inside the
predictor — that would require network scraping and breaks the offline boundary (§4 / D4). If foul
coverage ever improves, it will happen on the **Roll-Over app side** (its enrichment pipeline
writes `historical_matches`), and your model will benefit automatically with **no predictor
change** — which is the whole point of the design being "ready to exploit it the moment the data
improves." Leave the hook; don't build the importer.

### E2 — Entity-splitting across sources (e.g. active "Man United" vs sparse StatsBomb "Manchester United")

Good catch, and the match-count weighting you built is the right instinct. Guidance:

- **Keep match-count weighting** as the primary defence — a spelling with more rows should
  dominate a sparse duplicate of the same club.
- **Grow `aliases.json` toward the DB's *active* spellings.** The seed maps variants → a canonical
  name; make sure the canonical you resolve to is the spelling that actually carries the most rows
  in *this* DB, not a "textbook" name. When you hit a split, add both raw spellings as aliases
  pointing at the row-richest canonical.
- **Optional consolidation view:** a `--resolve-only`-style report (Appendix C.1) that lists, per
  canonical, which raw DB spellings collapsed into it and their row counts, would make splits
  visible so the owner/you can triage them into `aliases.json`. Stretch, not required.

The owner is fine with this staying a "sharpen aliases as you go" process rather than an automated
entity-resolution layer.

### E3 — SportyBet league string ("Spain: LaLiga") doesn't map to DB `league_id` slugs (e.g. `esp-la-liga`)

Confirmed real gap, and it's the one concrete cross-side refinement worth noting. Context:

- `upcoming_fixtures.league` is SportyBet's display string (`"Spain: LaLiga"`,
  `"England: Premier League"`); `historical_matches.league_id` is a slug (`esp-la-liga`,
  `eng-premier-league`, per the D4 table).
- For **league-scoped resolution on DB fixtures** (D4 rule 2 — filter the candidate set by
  `league_id` before fuzzy matching), you need to map the SportyBet string → the slug.

Recommended handling, in order of effort:

1. **v1 (no new work):** DB-sourced fixtures can skip league-scoping and rely on the
   name-present-in-DB restriction (D4 rule 1) + fuzzy ≥ 88 + fail-loud. This already works; league
   scoping is an accuracy *booster*, not a requirement.
2. **Cheap improvement (predictor-side):** keep a small `league_map.json` you own —
   `{"spain: laliga": "esp-la-liga", "england: premier league": "eng-premier-league", ...}` —
   covering the ~15 clean D4 leagues. Normalize the SportyBet string (lowercase, trim) and look it
   up; when present, scope the candidate set by that `league_id`. Unmapped → fall back to rule 1.
   The D4 table gives you the exact target slugs to seed this with.
3. **If the owner wants it made robust later (app-side, optional):** the Roll-Over app could write
   the resolved `league_id` directly onto `upcoming_fixtures` (it already knows its own registry
   slugs). That would hand you the slug with no mapping needed. **Not committed** — flag it to the
   owner if E3 becomes a real accuracy limiter in practice.

Owner's call: **go with option 2** (predictor owns a small `league_map.json` seeded from the D4
slugs). Option 3 stays on the shelf unless the mapping proves too noisy to maintain by hand.

### E4 — Remaining stretch backlog (Dixon-Coles, recency weighting, backfill importer, Streamlit, backtest)

All confirmed **stretch, post-v1**, none blocking:

- **Dixon-Coles / recency weighting** — welcome upgrades to the goals model whenever you want;
  Poisson-first was always the plan.
- **Fouls backfill importer** — **deferred / do not build** (see E1; offline boundary).
- **Streamlit dashboard** — nice-to-have; CLI + CSV is sufficient for now.
- **Backtest against `slip_selections`** — blocked by data, not design: the table is still
  **empty** (no staked slips yet). Revisit once the owner has staked real slips; then it becomes a
  genuine accuracy check. Read-only always.

### Verdict

**This is a good place to pause.** The tool is usable now (`python predict.py --source db` against
a fresh pull, or `--fixtures` with a paste), the priority market is modeled honestly, and every
remaining item is either deferred by the owner (D2/backfill) or a clearly-optional enhancement.
Pick up E2/E3 sharpening opportunistically; hold the rest until the owner promotes one.

---

## Appendix F — PRIORITY REFRAME: venue-form profiling → preferred picks (supersedes "fouls-first")

> **Read this as the corrected mission.** The original brief (§1, §6) framed the predictor as
> **fouls-first**. That was wrong for how the owner actually bets. Where this appendix conflicts
> with the fouls-first framing, **this appendix wins.** Nothing else about the offline / read-only
> / fail-loud discipline changes.

### F1 — The correction

- **Fouls is NOT the priority.** In practice the owner finds fouls markets **rarely available**
  on SportyBet, and (per D4) foul data is only ~2.2% of the DB. Fouls stays supported, but as a
  **secondary/bonus** market behind the existing sample-size gate (D1) — surfaced *only when the
  data exists*, never as the headline.
- **The real target is the owner's PREFERRED PICKS** — the same starred set the app mirrors
  (Appendix D): GG/NG, Over/Under (1.5/2.5/…), 1X2 and 1X2-1UP, Double Chance and DC-1UP, Win
  Either Half, and the combos. These are overwhelmingly **goals-derived**, and goals are **densely
  populated** in `historical_matches` (unlike fouls) — so this is the *confident* core, exactly
  the opposite of the sparse fouls situation.
- **The engine is venue-aware team-form profiling → pick suitability.** Profile each team's
  **home** record and **away** record *separately*, then rank which preferred picks the fixture
  supports for each side at its actual venue.

### F2 — Venue-split team profiles (the foundation)

For every team, compute **two independent profiles** from `historical_matches` — one from its
**home** matches (`home_team = team`) and one from its **away** matches (`away_team = team`).
`historical_matches` is row-per-match with explicit home/away columns, so these splits are direct.

Per venue profile, from goal history (dense, high-confidence):

- **Goals scored** avg + distribution (e.g. Lyon home: avg 2.1 scored)
- **Goals conceded** avg + distribution (e.g. Lyon home: avg 1.2 conceded)
- **Scored ≥1 rate**, **conceded ≥1 rate** (drive GG/NG)
- **Over 1.5 / 2.5 / 3.5 rates** (combined match goals at that venue)
- **Win / draw / loss rates** and **win-or-draw rate** (drive 1X2 and DC)
- **BTTS (GG) rate**
- **Clean-sheet rate**, **failed-to-score rate**
- Optional: **first-half** versions (`ht_*` columns exist) for Win Either Half / half markets
- Optional (dense enough): **corners** avg for the corner preferred markets

Apply the **same discipline as fouls** but note it rarely bites here: sample-size `n` shown on
every profile; recency weighting optional; league-baseline shrinkage (D1) available for thin
teams. Because goals are dense, most teams will be `high` confidence — the gating exists but is
seldom the limiting factor.

### F3 — The canonical worked example (owner's own)

> "If Lyon always scores a minimum of 2 goals in their home play and concedes on average, the
> predictor should understand Lyon at home is possible for GG, Over 1.5, 1UP, DC, etc."

So the flow is: **Lyon home profile** (scored avg ~2+, concedes ~1) → the predictor derives, for a
Lyon *home* fixture:

- **Over 1.5** — very likely (Lyon alone ~2 + opponent contribution) → high
- **GG/NG (GG)** — likely (Lyon scores AND concedes on average) → high
- **1X2 / 1X2-1UP** — Lyon favored (scores 2, concedes 1 → wins/leads often); the 1UP wrapper
  makes it safer still → medium-high
- **Double Chance / DC-1UP** — Lyon home win-or-draw rate high → high
- **Over 2.5** — plausible if opponent also contributes → medium

That mapping — *team venue form → the set of preferred picks it supports, each with a
probability/confidence* — **is the predictor's primary output.**

### F4 — Map each preferred market to its history signal

The architect should compute each preferred pick from the venue profiles (independence
approximations are fine for v1; refine later):

| Preferred pick | Driven by (from venue profiles) |
|---|---|
| **Over 1.5 / 2.5 / 3.5** | Home team's scored-at-home + away team's scored-away → expected match goals (Poisson) → P(Over line) |
| **GG/NG (GG)** | P(home scores) from home team's home scoring × P(away scores) from away team's away scoring |
| **1X2** | Poisson on each side's venue expected goals → P(home win)/draw/away |
| **1X2 - 1UP** | Same as 1X2 for the favored side; 1UP = early-payout wrapper → treat prob ≥ the raw 1X2 (it can only help), flag as "safer 1X2" |
| **Double Chance** | P(home win) + P(draw) etc. from the 1X2 distribution |
| **DC - 1UP** | DC with the early-payout wrapper → ≥ DC prob; "safer DC" |
| **Win Either Half** | First-half + second-half win tendencies (`ht_*` split vs full-time) |
| **Combos (1X2&O/U, DC&GG/NG, O/U&GG/NG, …)** | Product of the two marginal probabilities above (independence approx v1; note the assumption) |
| **Corners (Home/Away Team Total)** | Team's corners avg at that venue, if corner coverage is adequate |
| **Fouls (secondary)** | Unchanged: D1 gate; only when foul `n ≥ 5`; never the headline |

**Note the 1UP/2UP wrappers** are SportyBet early-payout mechanics on an underlying outcome (1X2 /
DC): the *underlying* probability is what the model computes; the wrapper only ever *improves* the
effective outcome for the bettor, so treat 1UP/DC-1UP as "the same pick, safer" rather than a
separate model.

### F5 — Output shape (revised)

Per fixture, output the **preferred picks it supports**, ranked by confidence, e.g.:

```
Lyon (H) vs Rennes (A)   France: Ligue 1   Sat 20:00
  ✓ Over 1.5      82%  (Lyon home scored avg 2.1, n=14)
  ✓ Double Chance 78%  (Lyon home W/D 79%)   [DC-1UP: safer]
  ✓ GG            71%  (Lyon home GG 68%, Rennes away GG 74%)
  ~ 1X2 Home      64%  (→ 1X2-1UP: safer)
  ~ Over 2.5      58%
  (fouls: no data)
```

- **Rank by model confidence**, preferred picks first; visually separate `low`-confidence.
- Keep the **team totals / combos** where the marginals support them.
- **`preferred_markets` table (Appendix D-odds)** becomes genuinely useful here: for any fixture
  present there, the predictor can put **its probability next to SportyBet's live odds** and flag
  **value** (`edge = model_prob − 1/odds`). This is the natural payoff of the reframe — the
  owner's preferred picks, scored by the model, checked against the actual prices offered. Still
  optional/stretch, but now it's the *obvious* next step rather than a side note.
- Fouls appear only as a bonus line when foul `n ≥ 5`.

### F6 — What changes in build order / scope

- **Milestone priority flips:** build the **venue-split team-form profiler + goals-based preferred
  picks (Over/Under, GG/NG, 1X2, DC, and the 1UP wrappers)** as the *core*. This replaces
  "fouls model" as milestone 3.
- **Fouls model** moves to a later, optional milestone (keep the D1 design — it's correct — just
  no longer the priority).
- **Everything else stands:** offline, read-only, team-name resolver (§5, still the make-or-break),
  league scoping (D4), fail-loud, sample-size honesty.
- **Data reality is favorable:** because goals are dense, the core preferred-pick predictions will
  be *far* more confident and useful than the fouls model ever could be — this reframe plays to
  the DB's strengths instead of its sparsest column.

**One-line summary for the architect:** *Profile each team's home and away form from goal history,
then for each fixture rank the owner's preferred picks (GG, Over lines, 1X2/1UP, DC/DC-1UP, Win
Either Half, combos) by model probability — optionally checked against live odds in
`preferred_markets` for value. Fouls is a low-priority bonus, gated by its sparse data, never the
headline.*

---

## Appendix G — Fixing unresolved team names (data-backed, measured on the real DB)

> Diagnostic run against the live `rollover.db` to explain the high "unresolved / skipped" count
> on DB-slate predictions and tell you exactly what will move the needle. All numbers below are
> **real**, not estimates.

### G1 — The measurement

`upcoming_fixtures` has **2,938 distinct team names**; `historical_matches` has **5,314**. Matching
upcoming → history:

| Resolver stage | Teams resolved | Notes |
|---|---:|---|
| Exact string match | 450 / 2,938 (15%) | brittle |
| Basic normalize (strip `fc/cf/afc/sc/club`) | 836 / 2,938 (28%) | ≈ your current Tier-1 |
| **Improved normalize** (below) | **1,015 / 2,938 (35%)** | **+179 recovered, cheap** |
| Still unresolved after improved | 1,923 | see G3 |

**The single biggest cheap win is a better Tier-1 normalizer** — it nearly doubles exact-match and
recovers +179 over your current normalize, before any fuzzy/alias work.

### G2 — Normalizer improvements (do these first)

The unresolved sample is dominated by **prefix/suffix noise your normalize doesn't strip**. Add:

1. **Leading ordinals** — `"1. FC Magdeburg"`, `"1 FC Kaiserslautern"`, `"1.SK Prostejov"`.
   Strip a leading `^\s*\d+\s*\.?\s*` before tokenizing. (German/Czech clubs.)
2. **Many more club-type tokens** — your list is `fc/cf/afc/sc/club`. The DB needs at least:
   `as, ac, ad, ae, aa, ab, acs, acsm, acd, sk, fk, if, ca, cd, ce, cs, us, usd, rc, sv, tsv,
   vfl, vfb, fsv, sd, ud, nk, hnk, kf, ks, ss, ssd`. These appear as leading noise on hundreds of
   Italian/Spanish/Argentine/Nordic/Balkan clubs (`AS Cittadella`, `AD Ceuta`, `CA Banfield`,
   `Bryne FK`, `ACD Ospitaletto`).
3. **Strip accents** (unidecode/`unicodedata`): `Alcorcón→Alcorcon`, `Nürnberg→Nurnberg`. SportyBet
   is usually ASCII; some history sources aren't (and vice-versa).

Just (1)+(2)+(3) recover the +179 measured above and more (the accent cases aren't in that count).

### G3 — What's left is mostly genuinely absent (not a bug)

Of the ~1,923 still unresolved after improved normalize, **the large majority have NO rows in
`historical_matches` at all** — SportyBet's option 2/3 long-tail crawl (see the app's fixture
sourcing) surfaces obscure clubs the app never synced history for: `12 de Junio de Villa Hayes`
(Paraguay), `AA Ponte Preta SP` (Brazil regional), `ACS Axi Adunatii Copaceni` (Romania lower),
`AD Isidro Metapan` (El Salvador). **These are correctly unresolvable** — there is nothing to
predict from, and fail-loud is the right behavior. Do **not** chase them; predicting them would
mean inventing data. This is also consistent with D4: the confident scope is the ~15 clean
European leagues, and those resolve well.

### G4 — The recoverable remainder (second-pass, optional)

A minority of the still-unresolved ARE real clubs present in history under a different form.
Patterns worth a second pass, in value order:

1. **Native vs English spelling** — `1. FC Nuremberg` (SportyBet) vs `Nürnberg`/`Nuremberg`
   (history). → **alias entries** (grow `aliases.json`). This is the highest-value manual add.
2. **Trailing city / partial** — `AC Omonia Nicosia`, `AE Larissa FC`, `AEK Larnaca` where history
   stores `Omonia`, `Larissa`, `AEK Larnaca`. → **token-subset match**: if every significant token
   of the shorter normalized name appears in a candidate, accept (guarded by league scope, G5).
3. **Accents** — covered by G2.3.

### G5 — League scoping needs the slug (cross-side note)

Your D4 strategy — restrict fuzzy candidates by `league_id` before matching — is the biggest
*accuracy* (not coverage) win, because it prevents wrong matches among the 5,314 names. But
`upcoming_fixtures.league` is SportyBet's display string (`"France: Ligue 1"`), not the DB slug
(`fra-ligue-1`). Two ways to bridge:

- **Predictor-side (now):** keep a small `league_map.json` (Appendix E3) mapping the ~15 clean
  SportyBet strings → slugs; scope candidates when a fixture's league maps.
- **App-side (DONE — owner approved):** the Roll-Over app now stamps the resolved `league_id`
  directly onto `upcoming_fixtures` (the app maps SportyBet's `country`+`leagueName` to its
  registry slug at pull time). **So `upcoming_fixtures.league_id` is populated** — scope on it
  directly and you can **retire `league_map.json`** for DB-slate fixtures. Notes:
  - It's **NULL for long-tail leagues** the app doesn't track (the same clubs that are the
    unresolvable floor in G3) — fall back to name-present-in-DB + fuzzy when `league_id` is NULL.
  - Coverage is the ~15 clean D4 leagues plus the major cups (mapping is conservative — a NULL
    means "no confident match," never a wrong slug).
  - Requires a fixture pull in the current app build for the column to populate; older rows get
    it back-filled on the next pull (the column was added backward-compatibly via ALTER TABLE).
  - Paste-sourced fixtures still have no league metadata, so keep `league_map.json`/name-scoping
    as the fallback path for §4B.

### G6 — Recommended order for the architect

1. **G2 normalizer upgrade** (ordinals + expanded club tokens + accents) — biggest cheap win, do
   first. Re-measure the resolved count.
2. **Grow `aliases.json`** from the native/English spelling misses (G4.1) — use `--resolve-only`
   (Appendix C.1) against a DB-slate run to dump the real misses and triage them.
3. **Token-subset match** (G4.2), guarded by league scope.
4. **League scoping** (G5) — ask the owner for the app-side `league_id` column if the hand-mapped
   `league_map.json` proves too noisy.
5. **Accept the long-tail floor** (G3): a large unresolved count is expected and correct when the
   DB simply has no history for those clubs. Report it; don't force it.

**Bottom line:** the "unresolved" count is partly a fixable normalizer gap (G2, +179 measured and
more) and partly the honest, correct floor of clubs with no history (G3). Fix the normalizer and
grow aliases against real misses; don't try to resolve clubs that aren't in the data.
