# Roll-Over — Next Improvements Roadmap

## Status: Discussion Phase
**Date:** August 20, 2026
**Current Build:** v2.1.0 (income-ready, all 5 phases complete)

---

## What We Have Now (Completed)

### Infrastructure
- 9 working data providers (ESPN, TheSportsDB, Football-Data.org, Sportmonks, AllSportDB, OpenLigaDB, OpenFootball, Football-Data UK, StatsBomb)
- 47 leagues in unified registry with 350+ team aliases
- SQLite local database with 12,000+ historical matches
- Background service (persistent across page navigation)
- Rust/Tauri backend with direct + proxy HTTP

### Prediction Engine
- Historical form analysis (last 20 home/away matches)
- Head-to-head record
- League-specific calibration (30+ leagues with real-world baselines)
- xG efficiency adjustments
- Recent form weighting (last 5 matches get bonus)
- Cross-provider consensus engine

### Features
- Match Scout with ESPN schedule endpoint (full fixture lists)
- Match Analysis panel (H2H, Form, Standings, Compare tabs)
- Prediction tracking + auto-settlement from ESPN
- Accuracy dashboard (hit rates by market/league/confidence)
- Quick Slip builder (one-click top 4 picks)
- Odds Booster (inject value picks into slips)
- Slip Optimizer (validate pasted picks against data)
- Telegram bot foundation (send daily picks)
- Dark/Light theme toggle
- Provider confidence attribution (badges + tooltips + guide)
- Smart league discovery (scan active leagues)
- Regional presets for league selection

---

## Identified Improvements (To Implement)

### A. Analysis Panel Overhaul — "Self-Sufficient Match Center"

**Goal:** User never needs to open SofaScore, Futball24, or any other tool.

#### A1. Side-by-Side Comparison View
- Both teams' stats displayed in parallel columns (not separate tabs)
- Win rate, goals scored/conceded, clean sheets, BTTS — all visible at once
- Visual bars showing which team is stronger in each metric

#### A2. H2H with Competition Filtering
- Toggle: All / League only / Cups only / Friendlies
- Show which competition each H2H match was in
- Highlight most relevant meetings (same league, recent)
- "In league meetings: Home won 5 of last 7"

#### A3. Team League History (Promotion/Relegation Awareness)
- Show which league each team was in for the past 3 seasons
- Flag: "This team was promoted from Championship" or "Relegated from La Liga"
- New-to-league indicator: "First season in this division"
- Helps understand why a team might be weaker/stronger than their current form suggests

#### A4. Available Everywhere
- Analyze button on Paste & Build selections
- Analyze button on Active Slips picks
- Analyze button on Search results
- Same comprehensive modal regardless of which page triggers it

#### A5. Comprehensive Match Summary
- Predicted scoreline (e.g. "Expected: 2-1")
- Key stats: avg goals in this H2H, avg corners, cards tendency
- "Match profile": high-scoring, defensive, volatile
- Injury/lineup impact (when Sportmonks data available)

---

### B. Database Auto-Update — "Always Fresh Data"

**Goal:** DB grows automatically without user clicking "Sync Data."

#### B1. Auto-Save Match Results After Settlement
- When prediction tracker settles a match (gets score from ESPN), save the result to historical_matches table
- Every settled match = 1 new DB entry = better future predictions

#### B2. Background TheSportsDB Past Events Fetch
- On every 6h background cycle, fetch `eventspastleague` for all 24 leagues
- Convert to HistoricalMatch and save — DB grows by ~15-30 results per cycle

#### B3. Incremental Football-Data UK Refresh
- Weekly: check if new CSV data is available for current season
- Download only the delta (new rows) and append

#### B4. Data Freshness Indicators
- Show "Last updated: 2h ago" on the DB status bar
- Per-team: "Arsenal data: fresh (updated today)" vs "Catanzaro data: stale (7 days)"

---

### C. Prediction Logic — "Smart Context-Aware Engine"

**Goal:** Predictions that understand the nuance of the fixture, not just raw stats.

#### C1. Promoted/Relegated Team Detection
- If a team has zero or very few matches in the current league's historical data
- But HAS data from a different league (lower/higher division)
- Flag: "Newly promoted — historical data from Championship, not Premier League"
- Reduce confidence or apply a "new team" penalty factor

#### C2. Early Season vs Mid-Season Logic
- First 5 matchdays: lean more on last season form + pre-season data
- After 10 matchdays: current season data becomes reliable
- Avoid over-weighting 2-3 early results

#### C3. Context-Aware Pick Selection
- Cup matches: increase upset probability
- Derby matches: unpredictable, reduce confidence
- Last day of season: motivation matters (relegation battle vs nothing to play for)
- Midweek fixtures: fatigue factor for teams playing twice in 4 days

#### C4. Avoid False Confidence
- Two unknown teams: cap confidence at 50% max regardless of calculations
- One data-rich team vs one unknown: note the asymmetry in reasoning
- "Data supports Home but away team is unknown — prediction less reliable"

---

### D. User Experience — "Professional Tool Feel"

#### D1. Fixture Calendar View
- Calendar-style layout showing all fixtures for next 7-14 days
- Color-coded by confidence (green = strong picks available, gray = no data)
- Click any day → see that day's fixtures

#### D2. Notification System
- "Arsenal vs Chelsea kicks off in 1 hour — your pick: Home (78%)"
- "3 matches settled — 2 won, 1 lost. Updated accuracy: 67%"
- In-app notifications badge

#### D3. Export / Share
- Export daily picks as image (shareable on social media)
- Export accuracy report as PDF
- Copy formatted picks to clipboard

#### D4. Personalized League Preferences
- "My leagues" quick-access (bookmarked leagues)
- Remember last scout configuration
- Personal hit rate per league (shows which leagues YOU predict best)

---

### E. Monetization Readiness

#### E1. Telegram Channel Features
- Automated daily send at configurable time (e.g. 9:00 AM)
- Different tiers: "Free picks" (top 2) vs "Premium picks" (all)
- Weekly accuracy report auto-send
- Subscriber count tracking

#### E2. WhatsApp Integration
- Send picks via WhatsApp Business API
- Group message support

#### E3. Web Dashboard (Future)
- Public-facing page showing track record
- Subscription management
- API for external consumers

---

## Priority Order

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| 1 | B1-B2: DB auto-update | High — more data = better predictions | Medium |
| 2 | A1-A2: Analysis side-by-side + H2H filtering | High — makes the tool self-sufficient | High |
| 3 | C1-C2: Promoted/relegated + early season | High — avoids bad predictions | Medium |
| 4 | A3: League history | Medium — context for understanding | Medium |
| 5 | C3: Context-aware picks | Medium — nuance | Medium |
| 6 | D1: Calendar view | Medium — UX | Medium |
| 7 | A4: Analyze everywhere | Medium — convenience | Low |
| 8 | E1: Telegram automation | High (income) | Low |
| 9 | D2-D3: Notifications + export | Medium — polish | Medium |
| 10 | E2-E3: WhatsApp + web | High (income) | High |

---

## Technical Debt / Known Issues

1. **Scout league filter** — works but some edge cases with similar league names
2. **Team alias list** — 350+ teams but will always have gaps as new teams get promoted
3. **ESPN CDN rate** — currently fetches 1 request per league for schedule, could batch
4. **MatchScout component** — very large file (~1100 lines), should be split
5. **Search page** — partially outdated, still references old providers
6. **Date parsing** — DD/MM/YYYY vs YYYY-MM-DD inconsistency in historical data

---

## Data Architecture (Current)

```
┌──────────────────────────────────────────────────────────┐
│                    Background Service                      │
│  (persistent, runs at App level, never unmounts)          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ DB Refresh  │  │ Auto-Scout   │  │ Auto-Settle    │  │
│  │ (6h cycle)  │  │ (2h cycle)   │  │ (30min cycle)  │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬─────────┘  │
│         │                 │                  │            │
│         ▼                 ▼                  ▼            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              SQLite (rollover.db)                     │ │
│  │  historical_matches | prediction_log | settings      │ │
│  └─────────────────────────────────────────────────────┘ │
│                          ▲                                │
│                          │                                │
│  ┌───────────────────────┼────────────────────────────┐  │
│  │          In-Memory Prediction Engine                │  │
│  │  (historical-stats.ts + team-aliases + league cal)  │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└──────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ Match Scout │    │ Match Anal.  │    │  Slip Builder  │
│ (fixtures)  │    │ (deep dive)  │    │ (optimizer)    │
└─────────────┘    └──────────────┘    └────────────────┘
```

---

## Session Summary (August 20, 2026)

This session accomplished:
- Fixed ESPN connection (CDN-first, removed blocked site.api.espn.com)
- Built all 5 roadmap phases (league registry → consensus engine)
- Added 3 new data sources (OpenFootball, Football-Data UK, StatsBomb)
- Expanded TheSportsDB from 9 to 24 leagues
- Built team alias database (350+ teams globally)
- Implemented prediction tracking + accuracy dashboard
- Added odds booster + slip optimizer
- Built Telegram bot foundation
- Created dark/light theme
- Fixed multiple bugs (league filtering, duplicates, ESPN schedule)
- League-specific calibration for 30+ leagues
- Provider attribution UI (badges, tooltips, guide panel)

**Files created this session:** ~20 new engine/component files
**Files modified:** ~15 existing files
**Total build size:** ~344KB JS bundle
