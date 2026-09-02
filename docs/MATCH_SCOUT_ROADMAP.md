# Match Scout Expansion Roadmap

## Vision
Transform Match Scout from a 12-league key-dependent tool into a professional 55+ league analysis platform that works with zero API keys. Any single provider that has data for a match should be able to contribute useful predictions.

## Principles
- One out of many APIs should be able to say something useful — that's enough
- No odds needed — focus on near-accurate predictions from form, H2H, standings
- More leagues = more opportunities, not more noise (confidence thresholds filter the noise)
- Works immediately with free providers; API keys add depth, not access
- Predictions run against LOCAL historical data — not dependent on live API responses

---

## Phase 1: Foundation — Unified League Registry + Regional Presets
**Status:** COMPLETE

### Deliverables
- `src/engine/league-registry.ts` — 47 leagues across 5 providers, 10 regional presets
- Regional preset buttons in Match Scout UI
- Tier-grouped league picker with search
- Replaced `FREE_COMPETITIONS` dependency

---

## Phase 2: Historical Data Engine — Prediction Brain
**Status:** COMPLETE

### Deliverables
- `src/engine/football-data-uk.ts` — CSV importer for 17 leagues x 5 seasons from football-data.co.uk
- `src/engine/openfootball.ts` — JSON fetcher for 16 leagues from GitHub Pages (OpenFootball)
- `src/engine/allsportdb.ts` — Free tier API client (10K calls/month, event discovery)
- `src/engine/historical-stats.ts` — Prediction engine: form, H2H, home/away splits, BTTS%, O1.5/O2.5%
- `src/lib/match-database.ts` — SQLite persistence: save/load/sync historical matches
- `src-tauri/src/lib.rs` — Added `http_get_text` command for CSV downloads, SQLite migration v2
- Match Scout now uses `predictMatch()` backed by local historical data
- "Sync Data" button in UI fetches and stores ~10,000+ matches from free sources
- Fallback to live provider stats when historical data is insufficient

### Architecture
```
                    ┌─────────────────────────┐
                    │     Match Scout UI       │
                    └───────────┬─────────────┘
                                │ predictMatch(home, away)
                    ┌───────────▼─────────────┐
                    │  historical-stats.ts     │
                    │  (in-memory engine)      │
                    └───────────┬─────────────┘
                                │ loadMatches()
                    ┌───────────▼─────────────┐
                    │  match-database.ts       │
                    │  (SQLite persistence)    │
                    └───────────┬─────────────┘
                   ┌────────────┼────────────┐
                   │            │            │
          ┌────────▼──┐  ┌─────▼──────┐  ┌──▼───────────┐
          │OpenFootball│  │football-   │  │ AllSportDB   │
          │(JSON/free) │  │data.co.uk  │  │ (10K/month)  │
          │16 leagues  │  │(CSV/free)  │  │ fixture disc │
          │current szn │  │17 lg x 5yr │  │              │
          └────────────┘  └────────────┘  └──────────────┘
```

### Data Flow
1. User clicks "Sync Data" (or auto on first run)
2. Fetches CSVs from football-data.co.uk (3 seasons x 17 leagues)
3. Fetches JSONs from OpenFootball (3 seasons x 16 leagues)
4. Stores all matches in SQLite (deduped, indexed)
5. Loads into in-memory engine on app start
6. When Scout runs: fixture discovery via ESPN/TheSportsDB → predictMatch() against local DB

---

## Phase 3: Smart Discovery — Auto-Detect Active Leagues
**Status:** Pending

### Deliverables
- Pre-scan: probe ESPN CDN to detect which leagues have fixtures in selected date range
- Only show leagues with actual upcoming games
- Cache active league list per session
- Tier 3 (cups/international) only visible when they have games

---

## Phase 4: Match Analysis Panel (Futball24/SofaScore style)
**Status:** Pending

### Deliverables
- Full analysis view when clicking any match, with tabs:
  - **H2H:** Last 10 meetings, filtered by competition type
  - **Home Form:** Last 10-20 matches (all/home-only/league/cups/friendlies filter)
  - **Away Form:** Same for opponent
  - **Standings:** Full league table with both teams highlighted
- Filter system: league matches, cups, friendlies, home/away splits
- Visual form strip (W/D/L colored badges)
- Data from historical-stats.ts (local DB) + ESPN standings (free)

---

## Phase 5: Cross-Provider Compare + Consensus Engine
**Status:** Pending

### Deliverables
- Compare tab in Match Analysis: shows what each API says side by side
- Consensus engine: averages predictions across available providers
- Flags disagreements between providers
- Feeds back into Scout confidence scores

---

## Working Data Sources (August 2026)

| Provider | Status | Key? | Data Type |
|----------|--------|:----:|-----------|
| ESPN CDN | Working | No | Fixtures, live scores (55 leagues) |
| TheSportsDB | Working | No | Fixtures, past events, team data |
| OpenLigaDB | Working | No | German/European fixtures |
| SportScore | Working | No | Live scores fallback |
| Football-Data.org | Working | Yes | Standings, fixtures (12 leagues) |
| Sportmonks | Working | Yes | Danish/Scottish, xG |
| football-data.co.uk | Working | No | 30 years historical results (CSV) |
| OpenFootball | Working | No | Current season results (JSON) |
| AllSportDB | Available | Free key | Event discovery (10K/month) |
| API-Football | BROKEN (403) | Yes | — |
| KickoffAPI | BROKEN (404) | Yes | — |
| The Odds API | BROKEN (401) | Yes | — |

