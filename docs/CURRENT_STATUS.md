# Roll-Over v2.0.0 — Technical Status & Roadmap

## Last Updated: August 17, 2026

---

## Section 1: Working Features (v2.0.0)

### Core Features
- [x] SportyBet parser — all three contexts (A: betlist, B: settled ticket, C: running ticket)
- [x] Context D detection (compact format) — properly rejected with user guidance
- [x] Market interpreter with abbreviations (28+ market types recognized and abbreviated)
- [x] Market categorization system (1X2, Over/Under, Team O/U, Double Chance, GG/NG, Handicap, Goal Bounds, Combo, Special)
- [x] Selection list with Pick/Market/Date/Sort filters
- [x] "Use filtered for Slip Builder" button
- [x] Custom odds input (editable per pick after paste)
- [x] Remove individual selections
- [x] Paste from clipboard / Import file
- [x] Auto-deduplication on paste (same match + same pick + same market)
- [x] Sort by kick-off time after dedup
- [x] Year inference for dates (handles Dec→Jan rollover)

### Market Interpreter — Full Abbreviation Table

| Market Type | Example Pick | Abbreviated Output |
|-------------|-------------|-------------------|
| 1X2 | Home | H |
| 1X2 | Away | A |
| 1X2 | Draw | D |
| 1X2 - 1UP | Home | H (1UP) |
| Double Chance | Home or Draw | H/D |
| Double Chance | Draw or Away | D/A |
| Double Chance | Home or Away | H/A |
| Match Over/Under | Over 2.5 | M O2.5 |
| Match Over/Under | Under 1.5 | M U1.5 |
| Team Over/Under (Home) | Over 1.5 | H O1.5 |
| Team Over/Under (Away) | Under 0.5 | A U0.5 |
| 1st Half Over/Under | Over 0.5 | 1H O0.5 |
| 2nd Half Over/Under | Under 1.5 | 2H U1.5 |
| Early Goals | Over 0.5 | EG O0.5 |
| GG/NG | Yes | GG |
| GG/NG | No | NG |
| 2nd Half GG/NG | Yes | 2H GG |
| Handicap | Home (0:2) | Hcp H(0:2) |
| Goal Bounds | 0-4 | GB 0-4 |
| Corners Over/Under | Over 8.5 | Cor O8.5 |
| Cards Over/Under | Over 3.5 | Crd O3.5 |
| 1st Half 1X2 | Home | 1H H |
| 2nd Half 1X2 | Away | 2H A |
| Halftime/Fulltime | Home/Home | HT/FT H/H |
| Win Either Half | Yes (Home) | H WEH |
| Win Both Halves | Yes (Away) | A WBH |
| Score In Both Halves | Yes (Home) | H SBH |
| Highest Scoring Half | 1st Half | H Best: 1st Half |
| Multigoals | 1-3 (Home) | H 1-3G |
| Multiscores | 2-0 or 3-0 | MS: 2-0/3-0 |
| Combo (1X2 & GG) | Home & Yes | H & GG |
| Combo (DC & O/U) | H/D & Over 1.5 | H/D & O1.5 |
| Goals in a Row | 2+ (Home) | H 2+GR |
| Lead by X Goals | 3 Goal Lead | 3GL |

### Slip Builder
- [x] Target odds as plain number input (any value, default 3.0)
- [x] Auto-calculated odds range: target ±30% (e.g., 3.0 → range 2.1–3.9)
- [x] Auto-adjust min/max picks based on target odds
- [x] Combinatorial generation — finds ALL valid combinations within constraints
- [x] Matches can repeat across different slips (when constraints off)
- [x] Same exact match NEVER repeats within a single slip (hard rule)
- [x] "No same team" constraint (toggleable, ON by default)
- [x] "No same kickoff" constraint (toggleable, OFF by default)
- [x] Safe odds range indicator (default 1.20–1.50)
- [x] Max high risk picks per slip (configurable)
- [x] Quality scoring per slip (safe zone ratio × 80 + count bonus)
- [x] Sort generated slips by quality/odds/picks/kick-off time
- [x] Remove individual slip from generated list
- [x] Remove individual pick from a generated slip
- [x] Merge top 2 slips into one
- [x] Copy slip to clipboard
- [x] Max 50 slips generated (configurable)

### Staking & Tracking
- [x] "Mark as Staked" button (removes from generated, adds to active)
- [x] Slip naming/label at stake time
- [x] Chain-to-slip linking (auto advance on win, auto break on loss)
- [x] No duplicate matches across staked slips (conflict detection)
- [x] Undo staked (with confirmation dialog — returns to generated)
- [x] Per-match result marking (✓ won / ✗ lost per selection)
- [x] One match lost = entire slip auto-lost (cascading settlement)
- [x] All matches won = slip auto-completes (cascading win)
- [x] Kick-off countdown display per match (relative time)
- [x] Timestamp display ("3h ago", "staked yesterday")
- [x] Copy active slip to clipboard

### Chain Management
- [x] Multiple parallel chains (unlimited)
- [x] Create chain (custom label + starting stake amount)
- [x] Won → Advance (with confirmation dialog)
- [x] Lost → Break (with confirmation dialog + reason)
- [x] Quick restart from broken chain (same label, reset to starting stake)
- [x] Portfolio summary panel:
  - Active chains count
  - Total deployed across all active chains
  - P&L calculation (total returns vs total invested)
  - Broken chains count
  - Current step for each chain

### History & Analytics
- [x] Full slip history (won/lost, with all per-match results preserved)
- [x] Per-match results preserved in history (see exactly which match lost)
- [x] Filter: All / Won / Lost
- [x] Delete individual history entries (with confirmation)
- [x] Clear all history (with confirmation)
- [x] Accuracy breakdown by Market type (which markets win most?)
- [x] Accuracy breakdown by Odds range (which odds ranges hit most?)
- [x] Overall pick hit rate (total won picks / total settled picks)
- [x] Win streak display (last 10 results on dashboard with color coding)
- [x] W/L count and win rate percentage

### Dashboard (Command Center)
- [x] Quick Paste from Clipboard button (auto-parse and navigate)
- [x] Active slips quick view with per-match ✓/✗ buttons
- [x] Win streak visualization (last 10 as colored squares)
- [x] P&L summary card (W/L ratio, win rate %)
- [x] Generated slips counter badge in nav
- [x] Active slips counter badge in nav
- [x] Generated slips with full action buttons
- [x] Match Scout section integrated
- [x] Merge Top 2 Slips quick action
- [x] Clear Generated quick action

### Discipline Module
- [x] Rotating discipline banner (always visible at top of app)
- [x] Multiple rotating messages (configurable)
- [x] Daily slip limit (configurable in History tab settings)
- [x] Today's staked count display
- [x] Limit enforcement on stake action (block + message)
- [x] Confirmation dialogs on ALL destructive actions:
  - Mark as staked
  - Settle slip (won/lost)
  - Undo stake
  - Delete history
  - Clear all history
  - Break chain

### Data Persistence
- [x] localStorage for all application data
- [x] Survives app restart (Tauri desktop app)
- [x] Export ALL data as JSON (one-click backup)
- [x] Import from JSON backup (restore)
- [x] Settings persist independently
- [x] Planned: SQLite via tauri-plugin-sql (schema ready in Rust backend)

### API Providers
- [x] Football-Data.org — PRIMARY (API key required, 10 req/min, 12 leagues)
- [x] TheSportsDB — SECONDARY (no key needed, test key "3", limited to ~9 matches per league)
- [x] ESPN — ADDED but NOT WORKING (no results returned)
- [x] Provider selector dropdown in Search UI
- [x] League selection checkboxes (selections persist)
- [x] Rate limiting (6.2s between Football-Data.org calls)
- [x] All HTTP via Rust backend (`http_get` Tauri command) — bypasses CORS and JS truncation
- [x] 30-second timeout on all API requests
- [x] Error handling with first-error capture for debugging

### Match Search
- [x] Provider selector (TheSportsDB / ESPN / Football-Data.org)
- [x] Timeframe options: 3 days / 5 days / 1 week / 2 weeks
- [x] League selection checkboxes (multi-select)
- [x] Filters: Strong Home / Home Scoring / Weak Away / High Scoring / All
- [x] Position gap display (from standings data)
- [x] Select individual matches → Add to Selections
- [x] Select All / Deselect All

### Match Scout (Dashboard Integration)
- [x] API key setup panel (multi-provider)
- [x] Scout button with timeframe selector
- [x] Results cached for 12 hours
- [x] "NO BET TODAY" discipline display (when insufficient confidence)
- [x] Confidence scoring per scouted match
- [x] "Add to Slip" button per suggestion
- [x] Value detection concept (when Odds-API key available)

---

## Section 2: Known Issues

### API Issues
| Issue | Severity | Details |
|-------|----------|---------|
| ESPN returns no data | Medium | Endpoint may be incorrect or API changed |
| Stats columns show 50% | Low | No form data actually fetched — rate limits prevent bulk team history calls |
| Football-Data.org slow for multi-league | Low | 6.2s delay per request × 12 leagues = ~75s for full scan |
| TheSportsDB limited matches | Low | Returns max ~9 upcoming per league (vs 30+ from Football-Data.org) |

### UI/UX Issues
| Issue | Severity | Details |
|-------|----------|---------|
| Max Picks auto-calculation | Low | Sometimes shows wrong value on initial load before user interaction |
| Safe Odds Range display | Low | "Max" field can be confusing — shows "4" which is the upper bound |

---

## Section 3: API Provider Assessment (Complete)

### Currently Working

| Provider | Status | Free Limit | Key Required | Leagues | Best For |
|----------|--------|-----------|-------------|---------|----------|
| Football-Data.org | ✅ Working | 10 req/min, unlimited daily | Yes | 12 competitions | Fixtures, standings, position gap |
| TheSportsDB | ✅ Working (limited) | Unlimited | No (test key "3") | 9 leagues | Past events for stats calculation |

### To Add in v2.1.0

| Provider | Status | Free Limit | Key Required | Leagues | Best For | Registration |
|----------|--------|-----------|-------------|---------|----------|-------------|
| KickoffAPI | 🆕 To add | 100 req/day | Yes (free) | 900+ | Stats, H2H, Form, Predictions | https://kickoffapi.com/ |
| SportScore | 🆕 To add | ~10,000/day | No | All major | Live results, kick-off tracking | No registration needed |
| Sportmonks | 🆕 To add | Free forever | Yes (free) | Danish + Scottish | xG, deep predictions | https://www.sportmonks.com/football-api/free-plan/ |
| API-Football | 🔧 Needs fix | 100 req/day | Yes (free) | All leagues | AI predictions, full stats | https://dashboard.api-football.com/register |
| OpenLigaDB | 🧪 To test | Unlimited | No | European | Backup fixture source | No registration needed |

### To Test Later

| Provider | Free Limit | Key Required | Notes | Registration |
|----------|-----------|-------------|-------|-------------|
| Big Balls Sports Data | 1,000-2,000/day | Yes | Multi-sport, could replace multiple providers | Investigate signup |
| FieldFunded | 10,000/month | Yes | Soccer + Basketball combined | https://www.fieldfunded.com/ |

### Future (v3.0.0 — Basketball Expansion)

| Provider | Free Limit | Key Required | Sport | Registration |
|----------|-----------|-------------|-------|-------------|
| SportScore | 10,000/day | No | Basketball (same as football) | Already available |
| balldontlie | Free | Yes | NBA stats, players, games | https://www.balldontlie.io/ |
| API-Basketball | 100/day | Yes | Full basketball data | https://api-basketball.com/ |
| Big Balls Sports Data | Same key | Same | Basketball (multi-sport) | Same as above |

### Rejected Providers (With Reasons)

| Provider | Reason for Rejection |
|----------|---------------------|
| SportsDataIO | Free tier data is scrambled/fake — paid only |
| foot.io | Closed beta, not accepting users |
| Zafronix | Only 28 competitions, too niche |
| ESPN (unofficial) | Endpoint not returning data, undocumented API |
| Odds-API.io | Hangs/times out, endpoint issues |
| iSports API | No clear free tier documentation |
| AllSportDB | Unclear terms of service |
| Broadage | Trial period only, then paid |
| ClearSports | 1,000 req/month — too low for daily use |
| API4Sports | Unclear pricing structure |
| Entity Sport | League restrictions on free tier too severe |
| Scorebat | Video content only, no fixture/stats data |
| OpenFootball | Dataset dumps (CSV), not a live API |
| Football-Data.co.uk | CSV downloads only, no REST API |
| NBA Stats API (unofficial) | Unreliable, rate limited, may break without notice |
| MySportsFeeds | Complex authentication, limited free tier |
| NCAA | Irrelevant markets for this system |

### Multi-Provider Strategy

```
┌────────────────────────────────────────────────────────────────────┐
│                    MULTI-PROVIDER ARCHITECTURE                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  FIXTURES (what's playing when)                                    │
│  ├── PRIMARY:   Football-Data.org (12 leagues, standings, H2H)     │
│  └── BACKUP:    TheSportsDB (no key, unlimited, 9 leagues)         │
│                                                                    │
│  STATISTICS (form, percentages, averages)                          │
│  ├── PRIMARY:   KickoffAPI (100/day — use wisely for key matches)  │
│  └── CALCULATE: TheSportsDB past events (last 15 per league)       │
│                                                                    │
│  HEAD-TO-HEAD (direct meetings)                                    │
│  ├── PRIMARY:   KickoffAPI                                         │
│  └── BACKUP:    Football-Data.org /matches/{id}/head2head          │
│                                                                    │
│  LIVE RESULTS (kick-off tracking)                                  │
│  └── PRIMARY:   SportScore (no key, 10k/day, real-time)            │
│                                                                    │
│  PREDICTIONS (AI/model scores)                                     │
│  ├── PRIMARY:   API-Football (fix endpoint first)                  │
│  └── SECONDARY: Sportmonks (Danish/Scottish leagues only)          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Section 4: Intelligence System Roadmap

### v2.1.0 — Data + Scoring (Next Release)

| Feature | Priority | Description |
|---------|----------|-------------|
| Smart Pick Scoring | P1 | Confidence score 0-100 per pick from H2H + form + position + home/away record |
| Stats in Search | P1 | O2.5%, BTTS%, Win%, Form string columns in search results |
| H2H Quick View | P2 | Expandable match detail showing last 5 meetings |
| Lock Search Results | P1 | Pin matches to curated shortlist across searches |
| Multi-tier Generation | P2 | Generate slips at 2/3/5 odds simultaneously |
| "Suggest Best Slip" Button | P2 | One-click safest slip from scored picks |
| Kick-off Tracker | P3 | Live match status polling for active slips |
| Pre-stake Checklist | P2 | Safety verification before staking |
| KickoffAPI Integration | P1 | Add provider for stats + H2H (100 req/day) |
| SportScore Integration | P2 | Add provider for live results tracking |
| Exclude Past Losers | P3 | Flag repeat failures from personal history |

### v2.2.0 — Learning + Context

| Feature | Description |
|---------|-------------|
| Pattern Detection | Analyze personal history for systematic failure patterns |
| Exclude Past Losers (advanced) | Auto-flag + warning when repeating losing picks |
| Progressive Confidence Threshold | Chain step 1-3: 65% min → Step 4+: 75% min → Step 6+: 85% min |
| Fixture Congestion Detection | Flag teams playing 3+ games in 7 days (fatigue risk) |
| Momentum/Form Velocity | Not just "won last 5" but "improving from bad run" vs "declining from peak" |
| "Never Bet" Database | Hard blocks on specific teams/leagues/markets that consistently lose |
| Slip Survival Simulator | "If pick X loses, how many of your slips survive?" |
| Time-of-Day Performance | Track win rate by kick-off time slot |

### v2.3.0 — Weather + Referee + Advanced

| Feature | Description |
|---------|-------------|
| Weather Integration | OpenWeatherMap free tier — flag rain/extreme conditions |
| Referee Profiling | From API-Football — referee card/penalty tendencies |
| Cross-Match Dependency | Detect when two picks are correlated (same league, same day) |
| Market Correlation Discovery | After 200+ picks: which stat combos predict which markets |
| Self-Learning Model | Confidence scoring auto-calibrates from your actual results |
| Automated Daily Brief | "Today's top 5 picks based on your history + live data" |

### v3.0.0 — Expansion + Notifications

| Feature | Description |
|---------|-------------|
| Basketball Module | NBA/Euroleague with same compounding system |
| System Tray | Minimize to Windows tray, always accessible |
| Windows Notifications | Match started, match finished, slip won/lost toasts |
| Telegram/WhatsApp Alerts | Optional push notifications |
| Mobile Companion | Responsive web version or native mobile |
| Bet9ja Parser | Second bookmaker format support |
| Full Bankroll Tracker | Real money tracking: deposits, withdrawals, ROI |

---

## Section 5: Technical Stack & File Structure

### Technology Choices

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| Desktop Framework | Tauri v2 | 2.5.0 | Native performance, small bundle, Rust backend for HTTP |
| Frontend | React | 18.3.1 | Component-based UI, proven ecosystem |
| Language | TypeScript | 5.6.3 | Type safety for complex data structures |
| Styling | Tailwind CSS | 3.4.17 | Utility-first, rapid UI development |
| Build Tool | Vite | 6.0.7 | Fast HMR, optimized production builds |
| Backend HTTP | Rust (reqwest) | via Tauri | Bypasses browser CORS restrictions and JS body truncation |
| Database (current) | localStorage | — | Simple, works now, sufficient for single-user |
| Database (planned) | SQLite | via tauri-plugin-sql | Structured queries, migrations, proper relational data |
| ID Generation | uuid | 11.1.0 | RFC4122 UUIDs for all entities |
| Plugins | tauri-plugin-sql, tauri-plugin-http, tauri-plugin-log, tauri-plugin-single-instance | — | Database, HTTP fetch, logging, prevent multiple windows |

### Complete File Structure

```
c:\Development\Roll-Over\
├── package.json                    — NPM config, scripts, dependencies
├── package-lock.json               — Locked dependency versions
├── tsconfig.json                   — TypeScript compiler configuration
├── vite.config.ts                  — Vite bundler configuration
├── tailwind.config.js              — Tailwind CSS configuration
├── postcss.config.js               — PostCSS plugins (Tailwind + Autoprefixer)
├── index.html                      — HTML entry point (Vite SPA)
├── .gitignore                      — Git ignore rules
├── PROJECT_ROADMAP.md              — Original project planning doc
│
├── docs/
│   ├── VISION.md                   — Product vision & philosophy
│   ├── CURRENT_STATUS.md           — THIS FILE — technical status
│   ├── IMPLEMENTATION_GUIDE.md     — Technical implementation reference
│   ├── PARSER_SPEC_SPORTYBET.md    — SportyBet parser specification
│   └── FUTURE_IMPROVEMENTS.md      — Feature ideas & research notes
│
├── src/
│   ├── main.tsx                    — React entry point (renders App)
│   ├── App.tsx                     — Main app component, all state management, routing
│   ├── index.css                   — Tailwind CSS imports (@tailwind directives)
│   ├── vite-env.d.ts               — Vite TypeScript environment declarations
│   │
│   ├── engine/                     — Core logic (no UI)
│   │   ├── types.ts                — All TypeScript interfaces (ParsedSelection, Slip, Chain, GroupingConfig, etc.)
│   │   ├── parser-sportybet.ts     — SportyBet paste parser (Context A/B/C/D detection & parsing)
│   │   ├── grouping-engine.ts      — Combinatorial slip generation algorithm
│   │   ├── market-interpreter.ts   — Market abbreviation & categorization engine
│   │   ├── match-scout.ts          — Scout analysis logic (confidence scoring, suggestions)
│   │   ├── football-data-org.ts    — Football-Data.org API client (PRIMARY)
│   │   ├── thesportsdb.ts          — TheSportsDB API client (SECONDARY, no key)
│   │   ├── espn.ts                 — ESPN API client (NOT WORKING)
│   │   ├── api-football.ts         — API-Football client (unused, needs endpoint fix)
│   │   └── odds-api.ts             — Odds-API.io client (value detection, hangs)
│   │
│   ├── components/                 — React UI components
│   │   ├── DisciplineBanner.tsx    — Rotating discipline messages (always visible)
│   │   ├── PasteInput.tsx          — Paste/import interface (textarea + file upload)
│   │   ├── SelectionList.tsx       — Parsed selections table with filters & actions
│   │   ├── SlipGenerator.tsx       — Configuration panel for slip generation
│   │   ├── GeneratedSlips.tsx      — Generated slips display with stake/remove/copy
│   │   ├── ActiveSlips.tsx         — Staked slips with per-match result tracking
│   │   ├── ChainStatus.tsx         — Chain management panel (create/advance/break)
│   │   ├── SlipHistory.tsx         — History tab with accuracy stats & export/import
│   │   ├── MatchScout.tsx          — Dashboard scout UI (API integration)
│   │   ├── MatchSearch.tsx         — Search tab (provider selector, leagues, filters)
│   │   └── ConfirmDialog.tsx       — Reusable confirmation modal component
│   │
│   └── lib/                        — Utility libraries
│       ├── storage.ts              — localStorage persistence (save/load/export/import)
│       ├── clipboard.ts            — Copy to clipboard utility
│       ├── accuracy.ts             — Hit rate calculation (by market, odds range)
│       └── database.ts             — SQLite database interface (planned migration)
│
├── src-tauri/                      — Rust backend (Tauri v2)
│   ├── Cargo.toml                  — Rust dependencies (reqwest, serde, tauri plugins)
│   ├── Cargo.lock                  — Locked Rust dependency versions
│   ├── build.rs                    — Tauri build script
│   ├── tauri.conf.json             — App configuration (window size, title, bundle settings)
│   │
│   ├── src/
│   │   ├── main.rs                 — Tauri main entry (calls lib::run)
│   │   └── lib.rs                  — Core: http_get command, SQLite migrations, plugin setup
│   │
│   ├── capabilities/
│   │   └── default.json            — Tauri permissions (HTTP, SQL, filesystem)
│   │
│   ├── gen/schemas/                — Auto-generated Tauri capability schemas
│   │
│   ├── icons/                      — App icons (all required sizes for Windows/Mac)
│   │
│   └── target/                     — Rust build output (release binary here)
│       └── release/
│           └── roll-over.exe       — The built desktop application
│
└── dist/                           — Vite production build output (frontend assets)
```

### State Management Architecture

All state lives in `App.tsx` using React `useState` hooks:

| State | Type | Persistence |
|-------|------|------------|
| `selections` | `ParsedSelection[]` | Session only (re-paste each session) |
| `generatedSlips` | `Slip[]` | Session only |
| `stakedSlips` | `StakedSlip[]` | localStorage |
| `history` | `StakedSlip[]` | localStorage |
| `chains` | `Chain[]` | localStorage |
| `settings` | `AppSettings` | localStorage |
| `view` | `View` | Session only (defaults to 'home') |

---

## Section 6: Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| 1.0.0 | August 17, 2026 | Initial build: SportyBet parser (all contexts), grouping engine (combinatorial), chain management, discipline banner, basic UI |
| 2.0.0 | August 17, 2026 | Market interpreter (28+ markets), Match Search (multi-provider), Match Scout, API integration (Football-Data.org + TheSportsDB), position gap, per-match result tracking, dashboard command center, history analytics, export/import, daily limits |

### What Changed: v1.0.0 → v2.0.0
- Added market interpreter system (raw market strings → clean abbreviations)
- Added API provider architecture (Football-Data.org primary, TheSportsDB secondary)
- Added Match Search tab (find fixtures from APIs instead of only pasting)
- Added Match Scout (dashboard-integrated suggestions with confidence)
- Added per-match result marking (✓/✗ per selection, not just whole-slip)
- Added position gap display from standings
- Added accuracy breakdown (by market type, by odds range)
- Added export/import (full JSON backup/restore)
- Added daily slip limits with enforcement
- Added merge slips, remove pick from slip
- Added league checkboxes with persistence
- Upgraded chain management (portfolio view, quick restart)
- Added single-instance enforcement (Tauri plugin)
- Added SQLite migration schema (ready but not yet active)

---

## Quick Reference

### How to Build & Run
```bash
# Development (hot-reload)
npx tauri dev

# Production build
npx tauri build

# Run built app
.\src-tauri\target\release\roll-over.exe
```

### Key Configuration Defaults
| Setting | Default | Location |
|---------|---------|----------|
| Target odds | 3.0 | SlipGenerator config |
| Odds range | 2.1 – 3.9 (±30%) | Calculated from target |
| Safe odds range | 1.20 – 1.50 | GroupingConfig |
| Max picks per slip | 8 | GroupingConfig |
| Min picks per slip | 2 | GroupingConfig |
| Max slips generated | 50 | GroupingConfig |
| No same team | ON | GroupingConfig |
| No same kickoff | OFF | GroupingConfig |
| Daily slip limit | 5 | AppSettings |
| API timeout | 30 seconds | Rust http_get |
| Rate limit (FD.org) | 6.2s between calls | football-data-org.ts |
| Scout cache | 12 hours | MatchScout |


---

## CRITICAL: Paste & Build Page as Central Hub

### Current Issue
- Paste & Build selections are session-only (lost on close)
- API Search results go to Paste & Build but don't persist
- No way to save/load selection lists

### Required Behavior (v2.1.0)

**Paste & Build is the MASTER SELECTION LIST** — everything flows INTO it:
- Pasted from SportyBet clipboard → goes here
- Imported from file → goes here
- Locked matches from Search → go here
- "Add to Slip" from Scout → goes here
- API fixture search results → go here

**It persists across sessions:**
- Selections saved to localStorage (like staked slips and history)
- On app reopen, last selection list is still there
- Can be cleared manually when starting fresh

**It supports export/import of the selection list itself:**
- "Export Selections" → saves current list as JSON file
- "Import Selections" → loads a previously saved list
- Useful for: saving a day's research, sharing between sessions, backup before clearing

**Dashboard shows summary from Paste & Build:**
- "Active Selections: 47 picks loaded"
- "Ready to generate: 47 picks across 12 leagues"
- Quick stats: breakdown by market type, date range, avg odds

### Data Flow (Corrected)

```
ALL SOURCES                    PASTE & BUILD (Master List)         SLIP BUILDER
───────────                    ─────────────────────────           ────────────
SportyBet paste     ──┐
File import         ──┤
API Search results  ──┼──►  PERSISTED SELECTIONS  ──►  Generate Slips
Scout suggestions   ──┤       (localStorage)              ↓
Manual additions    ──┘       • Deduplication            Generated Slips
                              • Sort by kickoff           ↓
                              • Filter by pick/market    Mark as Staked
                              • Export/Import list        ↓
                                                        Active Slips
                                                         ↓
                                                        History
```

### Implementation Notes
- Save selections to `localStorage.setItem('rollover_selections', JSON.stringify(selections))`
- Load on app init: `useState(() => loadSelections())`
- Add "Export Selections" button (JSON file of current list)
- Add "Import Selections" button (load JSON, merge or replace)
- Add "Clear All Selections" button (with confirmation)
- Dashboard shows selections count + summary stats


---

## FEATURE: Compare/Omit List (Speed Staking)

### User Workflow
1. Place 50-match accumulator on SportyBet at ₦10 (placeholder bet)
2. Paste the 50-match output into Roll-Over
3. Roll-Over generates 3-odds slips (e.g., 7 matches each)
4. Go back to SportyBet → click "Rebet" on the 50-match slip
5. **Roll-Over shows: "REMOVE these 43 matches"** (the omitted ones)
6. Delete the 43 from the re-bet, leaving only the 7 desired
7. Stake at real amount
8. Repeat for each generated slip

### Implementation

**"Compare" or "Show Omitted" button on each generated slip:**
- Input: full 50-match pasted list + generated slip (7 matches)
- Output: the 43 matches NOT in this slip (the ones to remove)
- Display as a simple list: team names only (for fast visual matching on SportyBet)
- Copy "omit list" to clipboard for reference while editing on bookmaker

**UI Location:** Each generated/staked slip gets a "Show Omitted" button
- Clicking it shows: "Remove these from your 50-match rebet:"
- List of all matches from the master list that are NOT in this slip
- "Copy Omit List" button

### Why This Matters
- Running 100 slips per day = 100× faster with this feature
- Instead of finding 7 matches in a sea of 50, you just remove what's listed
- Works with SportyBet's "Rebet" feature perfectly
- The master 50-match bet costs only ₦10 but serves as a template for all derived slips

### Example Output
```
SLIP #3 (3.12 odds, 7 picks)
Your slip includes: Bayern, Inter, PSG, Celtic, Man City, Atletico, Bologna

REMOVE THESE 43 from your 50-match rebet:
1. Arsenal v Coventry
2. Brentford v Tottenham
3. Brighton v Aston Villa
... (40 more)

[Copy Omit List]
```


---

## QA/Brainstorm Insights (ChatGPT Review — August 2026)

### Key Philosophy Shifts Accepted

1. **Optimization engine, not combination finder** — Generator should rank and optimize, not just find valid combos
2. **Estimated Probability ≠ Confidence** — Separate scores: Confidence (data quality), Probability (win likelihood), Calibration (historical accuracy at that score)
3. **Portfolio-level optimization** — Don't optimize each slip independently. Optimize the 100-slip portfolio as a whole (fixture exposure, correlation, diversification)
4. **Selection minimization** — Fewer picks is better. 2 picks at 3 odds beats 3 picks at 3 odds.
5. **Three separate KPIs** — Pick accuracy, Slip accuracy, Chain survival rate (track independently)

### Features to Implement (from ChatGPT review)

#### v2.1.0 (Add to current sprint)
- [ ] Estimated Probability (separate from confidence score)
- [ ] Paper-trading / Simulation mode (generate slips, settle against results, no real money)
- [ ] Chain survival rate tracking (not just win rate)
- [ ] Time-to-death metric per chain (how many rounds before break)
- [ ] Timestamp all predictions (prediction time, data retrieval time, kickoff time, odds at prediction)
- [ ] Three explicit metrics: Pick accuracy / Slip accuracy / Chain survival
- [ ] Selection minimization (prefer 2-pick slips over 3-pick slips at same odds)

#### v2.2.0 (Learning + Optimization)
- [ ] Calibration engine ("When system says 85 confidence, actual win rate is X%")
- [ ] Portfolio-level optimization (fixture/team/market/league/kickoff exposure analysis)
- [ ] Correlation penalty (same-match alternatives, same-team picks in portfolio)
- [ ] Portfolio Health Score (0-100) with breakdown:
  - Fixture diversification
  - Market diversification
  - League diversification
  - Kickoff diversification
  - Maximum exposure metrics
- [ ] Slip Quality Score upgrade (multi-factor: probability, calibration, edge, efficiency, correlation)
- [ ] Hard capital accounting (bankroll ledger: deposits, withdrawals, active value, realized P&L)
- [ ] Model versioning (v2.1, v2.2 — compare accuracy between versions)

#### v2.3.0 (Edge + Advanced)
- [ ] Edge Score (estimated probability − market-implied probability)
- [ ] Dynamic target range (let historical data show which range survives best)
- [ ] API reliability scoring (per-provider accuracy tracking)
- [ ] Ultimate dashboard (model version, calibration score, portfolio health, survival rates)
- [ ] Candidate model → validation pipeline (before changing scoring rules)

#### v3.0.0 (Backtesting)
- [ ] Historical replay ("Replay 10 Aug 2025 — what would the system have generated?")
- [ ] Out-of-sample validation (prove the system works on data it hasn't seen)

### Success Criterion (Upgraded)

OLD: "Can ₦100 become ₦218,700?"
NEW: "Can the system demonstrate, through properly timestamped out-of-sample evidence, that its selection process produces a measurable and repeatable improvement over the relevant baseline?"

### Key Metrics to Track (from Day 1)

```
PICK ACCURACY     — Did individual selections win?
SLIP ACCURACY     — Did complete 2-3 pick combinations win?  
CHAIN SURVIVAL    — Did chains survive to next round?
CALIBRATION       — When system says 80%, does it win 80%?
PORTFOLIO HEALTH  — How diversified is the 100-slip portfolio?
EDGE              — Does system beat market-implied probability?
```


---

## ChatGPT Response Round 2 — Architecture Refinements (August 2026)

### Scoring Formula (Revised for v2.1)

```
OLD:
  Form: 25%, Position Gap: 20%, H2H: 20%, Scoring: 15%, Venue: 10%, Momentum: 10%

NEW (accepted):
  Recent Contextual Form:    30%
  Home/Away Performance:     20%
  Scoring/Conceding Pattern: 15%
  Position/Strength Gap:     15%
  H2H:                       10%  (down from 20% — teams change over time)
  Momentum/Context:          10%

NOTE: These are v2.1 hypotheses, not truths. 
      Will recalibrate based on measured performance.
      Weights are PER MARKET TYPE (not universal).
```

### Market-Specific Models (Critical Architecture Decision)

Don't use one scoring formula for all markets:
- Home Win model (form + position + H2H + venue dominate)
- Over/Under model (scoring patterns + league avg + both teams' attack dominate)
- BTTS model (both teams' scoring rate + defensive weakness dominate)
- Team Goals model (team-specific attacking form + opponent defense)
- Handicap model (position gap + recent goal differences)
- 1UP/Early Payout model (strong start patterns + first half stats)

Shared features, separate calibrations.

### Data Snapshot Per Prediction (Store ALL Inputs)

```typescript
interface PredictionSnapshot {
  // Identification
  predictionId: string;
  modelVersion: string;
  createdAt: string;          // When prediction was made
  dataRetrievedAt: string;    // When API data was fetched
  kickOffAt: string;          // Match start time
  
  // Match context
  homeTeam: string;
  awayTeam: string;
  league: string;
  
  // Features used
  homeForm: string;           // "WWWDW"
  awayForm: string;           // "LDWLL"
  homePosition: number;
  awayPosition: number;
  positionGap: number;
  h2hRecord: string;          // "H4 D1 A0 (last 5)"
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeConcededAvg: number;
  awayConcededAvg: number;
  homeVenueWinRate: number;
  momentum: string;           // "improving" | "declining" | "stable"
  
  // Prediction output
  market: string;
  pick: string;
  confidenceScore: number;
  estimatedProbability: number;
  oddsAtPrediction: number | null;
  
  // Result (filled after settlement)
  outcome: 'won' | 'lost' | null;
  settledAt: string | null;
}
```

### Portfolio Optimization Algorithm (Greedy + Local Swap)

```
Phase 1: Score all candidate slips
  SlipScore = Quality + Probability + OddsEfficiency
            - CorrelationPenalty
            - FixtureExposurePenalty  
            - TeamExposurePenalty
            - MarketExposurePenalty
            - KickoffConcentrationPenalty

Phase 2: Greedy selection
  1. Sort all candidates by SlipScore
  2. Select best slip
  3. Update exposure counters
  4. Re-penalize remaining candidates based on new exposure
  5. Select next best
  6. Repeat until 100 slips

Phase 3: Local swap improvement
  For each selected slip:
    Can any unselected slip replace it with higher portfolio score?
    If YES → swap
    If NO → retain
  Repeat until no improvement found
```

### Event Exposure Tracking

```
Bayern vs Freiburg (total event exposure across portfolio):
  Bayern Win:     in 7 slips
  Bayern O1.5:    in 5 slips
  Bayern 1UP:     in 3 slips
  Bayern O2.5:    in 2 slips
  ─────────────────────────────
  Total event exposure: 17/100 slips (17%)
  
  RISK: If Bayern underperforms, 17% of portfolio is at risk
  
  THRESHOLD: No single event > 10% of portfolio (configurable)
```

### Calibration Strategy

```
Picks 1-49:     Observe only (record confidence vs outcome)
Picks 50-99:    Preliminary calibration report (warning: small sample)
Picks 100-199:  Diagnostic calibration (identify severe miscalibrations)
Picks 200-499:  Candidate weight adjustment (if miscalibration > 10%)
Picks 500+:     Stronger recalibration (market-specific)

ALWAYS calibrate per bucket AND per market:
  Confidence 80-89 × Home Win: predicted 84%, actual 79% → calibrated
  Confidence 80-89 × Over 1.5: predicted 84%, actual 87% → calibrated  
  Confidence 80-89 × BTTS:     predicted 84%, actual 68% → SEVERE miscalibration
```

### Baseline Comparisons (Essential for Validation)

```
Baseline A: Random eligible selections → expected ~50%
Baseline B: Highest-odds-only selections → expected ~45% (bookmaker edge)
Baseline C: Simple form model (last 5 W/L only) → expected ~55-60%
Baseline D: Roll-Over v2.1 full model → measured X%

If Roll-Over ≤ Baseline C → intelligence layer adds nothing
If Roll-Over > Baseline C by 5%+ → system has genuine predictive value
```

### Paper Trading Milestones

```
Stage 1: 200 individual selections → Test prediction engine accuracy
Stage 2: 500 selections → First meaningful calibration analysis
Stage 3: 1,000+ selections → Statistical strength for pattern claims
Stage 4: 100+ complete portfolios → Evaluate portfolio construction quality
Stage 5: 500+ simulated chains → Evaluate rollover behavior and survival
```

### Philosophy Shift (Accepted)

OLD success criterion:
  "Can ₦100 become ₦218,700?"

NEW success criterion:
  "Can the system demonstrate, through properly timestamped out-of-sample evidence, 
   that its selection process produces a measurable and repeatable improvement 
   over the relevant baseline?"

Remove "70% target" from architecture. Let the system discover reality.
The number it finds IS the number. Don't manufacture it.

### v2.1 Architecture (ChatGPT's Proposed Flow — Accepted)

```
DATA SNAPSHOT → MODEL ENGINE → CANDIDATE PICKS → SLIP GENERATOR → PORTFOLIO OPTIMIZER → 100-SLIP PORTFOLIO → PAPER TRADING → ACTUAL RESULTS → CALIBRATION + BASELINES + CHAIN SURVIVAL → MODEL EVALUATION → NEXT VERSION
```

### Culture Statement

"Hypothesis → prediction → timestamp → paper trade → result → calibration → comparison → model version → repeat."

Evidence, not belief. Discovery, not manufacturing.


---

## FEATURE: Live Match Indicator on Active Slips

### Behavior
- Active Slips page checks kick-off times against current time
- Matches that have kicked off but not yet finished show a LIVE indicator
- Slip-level status derived from its matches:
  - All matches not started → "Upcoming" (gray)
  - At least one match in play → "LIVE" (pulsing green dot)
  - All matches finished → "Ready to settle" (blue)
  - Mix of finished + upcoming → "In progress" (yellow)

### Display
```
┌─────────────────────────────────────────────────┐
│ ● LIVE  Slip #3 (3.12 odds, 3 picks)  Chain A  │
│                                                  │
│ 1. Bayern v Freiburg    H @1.22  ● LIVE (62')   │
│ 2. Inter v Monza        H @1.30  ✓ Won (FT 2-0) │
│ 3. Celtic v LASK        H @1.85  ○ 19:45        │
└─────────────────────────────────────────────────┘
```

### Logic
```typescript
function getMatchStatus(kickOffTime: Date): 'upcoming' | 'live' | 'finished' {
  const now = Date.now();
  const kickoff = new Date(kickOffTime).getTime();
  const elapsed = now - kickoff;
  
  if (elapsed < 0) return 'upcoming';           // Not started
  if (elapsed < 120 * 60 * 1000) return 'live'; // Within 2 hours of kickoff
  return 'finished';                             // 2+ hours past kickoff
}

function getSlipStatus(selections, selectionResults): string {
  const statuses = selections.map(s => getMatchStatus(s.kickOffDateTime));
  const results = Object.values(selectionResults);
  
  if (statuses.every(s => s === 'upcoming')) return 'upcoming';
  if (statuses.some(s => s === 'live')) return 'live';
  if (results.every(r => r !== 'pending')) return 'ready_to_settle';
  return 'in_progress';
}
```

### Implementation
- Uses the existing 60-second refresh timer in ActiveSlips
- No API needed for basic indicator (just compares current time vs kickoff time)
- When SportScore integration is added, replace time-based with actual live score data
- Sort active slips: LIVE first, then In Progress, then Upcoming


---

## CRITICAL FIX: Match Scout Must Use Provider Orchestrator

### Current Problem
- Match Scout (Dashboard) only uses Football-Data.org + API-Football
- Match Search (Search tab) uses provider-orchestrator.ts with ALL providers
- Dashboard shows limited fixtures because it only queries one source

### Required Fix
- Wire `provider-orchestrator.ts` into `MatchScout.tsx` and `match-scout.ts`
- Scout should call `fetchAllProviders()` from orchestrator
- Then apply scoring/analysis to ALL returned fixtures
- Dashboard becomes the SINGLE SOURCE OF TRUTH for all opportunities

### Implementation
1. In `match-scout.ts`: replace `getAllUpcomingMatches()` with orchestrator's merged fetch
2. In `MatchScout.tsx`: remove individual provider imports, use orchestrator
3. Remove API key requirement for Scout (TheSportsDB + SportScore need no key)
4. Scout should work out-of-the-box with zero configuration

### Result
- Dashboard shows 50-100+ fixtures across ALL leagues
- Each scored by confidence
- No key needed for basic functionality
- Football-Data.org key adds position data (bonus, not required)


---

## UI FIX NEEDED: Remove Dedicated API Setup from Match Scout

### Current Problem
- Dashboard's Match Scout still shows the old API key setup UI (Football-Data.org, Odds-API, API-Football)
- This gives the impression that Scout ONLY works with those 3 providers
- In reality, the Scout now uses the Provider Orchestrator (ALL 8 providers)
- TheSportsDB, ESPN, OpenLigaDB, SportScore need NO key — Scout should work immediately

### Required Fix
1. Remove the "API Setup" panel from MatchScout.tsx
2. Create a dedicated **Settings page** (new tab or section in History tab) for ALL API key management
3. Scout should work out-of-the-box with no keys (TheSportsDB + ESPN + OpenLigaDB + SportScore = 4 providers, no key)
4. Adding keys (Football-Data.org, API-Football, KickoffAPI, Sportmonks, Odds API) ENHANCES results but isn't required
5. Scout shows: "Searching 4 providers..." or "Searching 8 providers (5 with API keys configured)"

### Settings Page Should Have
- List of ALL 8 providers
- Key input field per provider (or "No key needed" label)
- Status indicator: ✓ Active / ⚠ No key / ✗ Failed
- "Test Connection" button per provider
- Link to registration page per provider
- Clear explanation: "Providers without keys still work (TheSportsDB, ESPN, OpenLigaDB, SportScore)"

### Implementation
- Move all `setApiKey`, `setFootballDataKey`, `setOddsApiKey` logic to a central Settings component
- MatchScout.tsx removes `isSetup` / `showSettings` state — always shows Scout directly
- On first app load with no keys: Scout still works (4 no-key providers)
- Settings accessible from nav bar or Dashboard link


---

## UI REDESIGN: Widgets, Modals & Full-Page Layout

### Issues
1. Scout only shows 6 providers in badges — missing KickoffAPI and Sportmonks
2. No API test/connection test feature
3. Chains section takes permanent sidebar space
4. Layout feels cramped — needs full-page view with collapsible widgets

### Required Changes

#### 1. All 8 Providers in Scout Display
Scout must show ALL 8 providers:
- TheSportsDB ✓ (no key)
- ESPN ✓ (no key)
- OpenLigaDB ✓ (no key)
- SportScore ✓ (no key)
- Football-Data (key: configured/missing)
- API-Football (key: configured/missing)
- KickoffAPI (key: configured/missing)
- Sportmonks (key: configured/missing)
- Odds-API (key: configured/missing)

#### 2. API Settings as Collapsible Widget/Modal
- NOT a separate page — a floating modal/overlay accessible from any tab
- Trigger: gear icon or "API Settings" button (always visible in nav or footer)
- Content: all 8 providers, key fields, "Test Connection" button per provider
- Shows: ✓ Connected / ⚠ No key / ✗ Connection failed
- Collapsible sections per provider (expand to see details/register link)
- Close button returns to previous view

#### 3. Chains as Collapsible Widget
- Chains section becomes a floating/docked widget
- Can be collapsed to just show: "3 Active Chains | +₦4,200 P&L"
- Expand to see full chain details (current step, stake, controls)
- Does NOT take a full sidebar — appears as overlay or bottom panel
- Always accessible from any tab (floating button or pinned bar)

#### 4. Full-Page Layout Vision
```
┌────────────────────────────────────────────────────────────────────┐
│ [Dashboard] [Paste & Build] [Search] [Active Slips] [History]      │
│                                                    [⚙ Settings] [🔗 Chains (3)] │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  FULL WIDTH CONTENT (no permanent sidebar)                         │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Match Scout (full width)                                  │      │
│  │ 8 providers active | 47 fixtures found | 12 high-conf    │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Suggested Slips / Generated Slips (full width)            │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ [Chains Widget ▼]  3 active | Step 4 | +₦4,200              [expand]│
└────────────────────────────────────────────────────────────────────┘

MODALS (overlay, not page navigation):
- ⚙ Settings modal → API keys, test connections
- 🔗 Chains modal → full chain management (expand from bottom bar)
- Pre-Stake Checklist → overlay before staking
- Confirm dialogs → overlay for destructive actions
```

#### 5. API Connection Test Feature
Each provider in Settings gets a "Test" button:
- Calls a lightweight endpoint (e.g., list sports or get one fixture)
- Shows: ✓ "Connected (245ms)" or ✗ "Failed: 403 Unauthorized"
- Stored result: last test time + result
- Helps user know which providers are actually working
