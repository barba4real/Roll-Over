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
   (a) the **`sb_fixture_cache` table** in the same read-only DB — the app's last SportyBet
   fixture pull — or (b) a **pasted list** copied from SportyBet. Both are offline; no scraping.
3. **Sorts and predicts** per-market outcomes for those fixtures — with **Team Fouls
   Over/Under as the priority market** — and prints a readable report (plus optional CSV).

The guiding principle discussed with the product owner:

> **Python looks backward** (learns team strengths from history). **The forward-looking
> fixtures come from SportyBet** — either already captured in the DB by the app, or pasted by
> the user. History and fixtures meet at the **team name**.

**Non-goals (do NOT do these):**

- Do **not** scrape SportyBet or any provider, and make **no** network calls. Fixtures come only
  from the read-only DB (`sb_fixture_cache`) or from paste — never from the live web.
- Do **not** write to any table the Roll-Over app owns. If you persist output at all, use
  your **own** table/file. (`sb_fixture_cache` is read-only to you, like every app table.)
- Do **not** import, call, or depend on any Roll-Over TypeScript/Rust code.
- Do **not** *require* the Roll-Over app to be running. (Reading `sb_fixture_cache` works whether
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

### 4A. Primary: read `sb_fixture_cache` from the DB

The Roll-Over app persists its **last SportyBet fixture pull** into a table in the same
`rollover.db` you already open read-only. Reading it removes the paste step entirely and gives you
SportyBet's exact slate (the book the owner plays), pre-attached to league names.

**Schema:**

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | always `1` — single-row cache |
| `payload` | TEXT | JSON blob (see below) |
| `window` | TEXT | which time-window was pulled (`''`=all upcoming, `3h`, `6h`, `today`, `tomorrow`, `weekend`) |
| `pulled_at` | INTEGER | epoch **milliseconds** of the pull |

`payload` parses to:

```json
{
  "fixtures": [
    {
      "eventId": "sr:match:72221244",
      "gameId": "...",
      "homeTeam": "Ipswich Town",
      "awayTeam": "Liverpool",
      "country": "England",
      "leagueName": "Premier League",
      "league": "England: Premier League",
      "kickoff": 1789200000000,
      "date": "16/08",
      "time": "17:30",
      "hasPreferred": true
    }
  ],
  "leagues": ["England: Premier League", "..."]
}
```

Read snippet:

```python
import json
row = con.execute("SELECT payload, window, pulled_at FROM sb_fixture_cache WHERE id=1").fetchone()
if row:
    data = json.loads(row[0])
    fixtures = data["fixtures"]           # each has homeTeam / awayTeam / leagueName / kickoff(ms)
    pulled_at_ms = row[2]                 # epoch ms; divide by 1000 for datetime
```

**Critical caveats — handle all three:**

1. **Single-row snapshot, not a durable history.** The table holds only the *last* pull and is
   overwritten each time. So you see whatever window the owner last pulled in the app — it may be
   a narrow one (`3h`) or the full `~6k` slate (`''`). Read `window` + `pulled_at` and surface them
   ("using SportyBet pull from 2h ago, window=today"). If the owner wants the full slate, they
   pull "all upcoming" in the app before running you.
2. **The table may not exist / may be empty / may be stale.** It's created lazily on the app's
   first pull. If the row is absent, or `pulled_at` is older than a freshness threshold you choose
   (e.g. 12h), **fall back to paste (4B)** and say so.
3. **`kickoff` is epoch milliseconds**, and **team names are SportyBet's spellings**
   (`Ipswich Town`, `Man Utd`, …) — they still go through the §5 resolver exactly like pasted
   names. Reading from the DB removes the *paste* step, not the *matching* step.

`hasPreferred` means the fixture offered at least one of the owner's preferred markets in the
app's pull — a weak positive signal, not a fouls guarantee. Do not treat it as "has fouls."

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

Default to **4A (`sb_fixture_cache`)** when the table exists and is fresh; otherwise use **4B
(paste)**. Expose a `--source {auto,db,paste}` flag (default `auto`) so the owner can force either.
In `auto`, if the DB source is chosen, still allow `--fixtures` to *supplement* the DB list (union,
de-duplicated by team+date) so a fixture missing from the last pull can be added by paste.

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

# Upcoming fixtures cache (§4A) — may not exist yet if the app never pulled.
import json
try:
    row = con.execute("SELECT payload, window, pulled_at FROM sb_fixture_cache WHERE id=1").fetchone()
    if row:
        fx = json.loads(row[0]).get("fixtures", [])
        print(f"sb_fixture_cache: {len(fx)} fixtures, window='{row[1]}', pulled_at(ms)={row[2]}")
    else:
        print("sb_fixture_cache: table exists but empty — use paste (§4B)")
except Exception:
    print("sb_fixture_cache: not present yet — use paste (§4B)")
con.close()
```

If `rows with fouls` is small, that is expected — see §3 warning 1. Report it and design the
fouls model around sample-size gating, not around assuming dense data. If `sb_fixture_cache` is
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
> inputs are (1) the **read-only** `rollover.db` — both the `historical_matches` learning data and
> the `sb_fixture_cache` upcoming-fixtures table (§4A) — and (2) **fixtures the user pastes**
> (§4B). It does **not** connect to SportyBet, scan any catalog, check live market availability, or
> make any network call. All references to SportyBet below explain *why the database looks the way
> it does* — they are **not** steps the predictor performs. (Reading `sb_fixture_cache` is just a
> local table read; it stays inside this boundary.)

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
