# Roll-Over — Technical Implementation Guide

## Document Version: 1.0 | August 2026

This document is the definitive technical reference for implementing new features. Any developer (or the same developer in a future session) should be able to pick up where the last session ended and implement the next feature without asking questions.

---

## Section 1: Development Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ (LTS recommended) | Frontend build, npm packages |
| Rust | stable (latest) | Tauri backend compilation |
| Visual Studio Build Tools | 2022+ | Windows C++ compiler (Rust dependency) |
| npm | 9+ | Package management |

### Installation

```bash
# Clone and install dependencies
cd c:\Development\Roll-Over
npm install

# Rust dependencies install automatically on first build
```

### How to Run (Development)

```bash
# Start Tauri dev server (hot-reload frontend + Rust backend)
npx tauri dev

# This opens the desktop window with hot-reload enabled
# Rust backend recompiles automatically on changes to src-tauri/
```

### How to Build (Production)

```bash
# Full production build (frontend + Rust → .exe)
npx tauri build

# Output location:
# .\src-tauri\target\release\roll-over.exe
# .\src-tauri\target\release\bundle\ (installer packages)
```

### How to Run Built App

```bash
# Direct execution
.\src-tauri\target\release\roll-over.exe

# Or use the generated installer from:
# .\src-tauri\target\release\bundle\msi\
# .\src-tauri\target\release\bundle\nsis\
```

### Project Structure Overview

```
Frontend (src/)     → React + TypeScript + Tailwind
                      Handles all UI, state management, user interaction
                      
Engine (src/engine/) → Pure logic: parser, grouping, market interpretation, API clients
                      No React dependencies, can be tested independently
                      
Backend (src-tauri/) → Rust: HTTP proxy, SQLite database, system plugins
                      Handles everything the browser can't (CORS bypass, native IO)
                      
Docs (docs/)        → All project documentation
```

---

## Section 2: How the Parser Works

### Overview

The parser (`src/engine/parser-sportybet.ts`) transforms raw pasted text from SportyBet's interface into structured `ParsedSelection[]` objects that the rest of the system uses.

### Context Detection

The first step is detecting which of SportyBet's 4 paste formats is present:

```typescript
function detectContext(lines: string[]): 'betlist' | 'settled_ticket' | 'running_ticket' | 'compact_unsupported' {
  // Scan first 10 lines for identifying markers
  // "Ticket Details (ID: ...)" → settled_ticket
  // "Bet ID: ..."             → running_ticket
  // Indented picks with "v"   → compact_unsupported (REJECTED)
  // None of the above         → betlist (default, most common)
}
```

| Context | Source | Has Game ID | Has Results | Eligible for Grouping |
|---------|--------|-------------|-------------|----------------------|
| A (betlist) | Open bet list | Yes | Some | Yes (not_started only) |
| B (settled_ticket) | Bet history | Sometimes | All | No |
| C (running_ticket) | Active bets | Sometimes | Partial | Yes (not_started only) |
| D (compact) | Share/betslip | No | No | REJECTED — insufficient data |

### Block Structure

Each selection in the paste is a repeating block. The parser scans line-by-line:

```
[index]           ← Standalone integer (block start detection: /^\d+$/)
[DD/MM HH:MM]     ← Date and time
Game ID: [id]     ← Optional (absent in settled tickets)
[Status]          ← "Not Started" | "Check Live Tracker >" | "Won" | "Lost" | "Void"
[Home Team]       ← Next non-empty line
[Away Team]       ← Next non-empty line
[Score or --]     ← "--" if not started, or two digit lines (home\naway)
Pick
[pick] @[odds]    ← e.g., "Home @1.20" or "Over 2.5 @1.65"
Market
[market type]     ← Full market string e.g., "1X2 - 1UP" or "Double Chance & Over/Under 4.5"
Result
[result or --]    ← "--" if pending, or "Home"/"Away"/"Draw"
[result message]  ← Optional ("1UP achieved! Enjoy your early success!")
```

### Pick Extraction

The critical regex for extracting picks:

```typescript
const PATTERNS = {
  pick: /^(.+)\s+@(\d+\.\d+)$/,
  // Captures: group 1 = pick value, group 2 = odds
  // Examples:
  //   "Home @1.20"              → pick="Home", odds=1.20
  //   "Over 2.5 @1.65"         → pick="Over 2.5", odds=1.65
  //   "Draw or Away @1.38"     → pick="Draw or Away", odds=1.38
  //   "Home/Away & Under 4.5 @1.42" → pick="Home/Away & Under 4.5", odds=1.42
  //   "Away (0:2) @1.23"       → pick="Away (0:2)", odds=1.23
};
```

### Market Categorization Logic

After extracting the raw market string, it's categorized into a `MarketType`:

```typescript
function categorizeMarket(market: string): { type: MarketType; variant: string | null } {
  const lower = market.toLowerCase();
  
  // Order matters — more specific checks first
  if (lower.startsWith('1x2'))                                    → '1x2' + variant (e.g., "1UP")
  if (lower.includes('double chance') && lower.includes('over'))  → 'combo'
  if (lower.includes('double chance'))                            → 'double_chance' + variant
  if (lower === 'gg/ng' || lower.includes('both teams'))          → 'gg_ng'
  if (lower.includes('handicap'))                                 → 'handicap'
  if (lower === 'goal bounds')                                    → 'goal_bounds'
  if (lower.includes('over/under') && team-specific-check)        → 'over_under_team'
  if (lower.includes('over/under'))                               → 'over_under' + variant
  if (lower.includes('correct score'))                            → 'correct_score'
  if (lower.includes('goals in a row'))                           → 'special'
  default                                                         → 'other'
}
```

### Market Interpreter Abbreviation System

The market interpreter (`src/engine/market-interpreter.ts`) converts verbose pick descriptions into compact, scannable abbreviations:

**Processing order (top to bottom, first match wins):**

1. Combo markets (contains "&") → `abbreviatePick(pick)` directly
2. Conditional "or" markets → Compact label with Yes/No
3. Win Either Half → `H WEH` / `A WEH`
4. Win Both Halves → `H WBH` / `A WBH`
5. Score In Both Halves → `H SBH` / `A SBH`
6. Highest Scoring Half → `H Best: [half]`
7. Multigoals → `H 1-3G` / `A 2-4G` / `M 1-5G`
8. Multiscores → `MS: 2-0/3-0`
9. 2nd Half GG/NG → `2H GG` / `2H NG`
10. GG/NG 2+ → `GG2+` / `No GG2+`
11. Lead by X goals → `3GL`
12. Goals in a Row → `H 2+GR`
13. 1st/2nd Half 1X2 → `1H H` / `2H A`
14. 1st/2nd Half DC → `1H H/D` / `2H D/A`
15. 1st/2nd Half O/U → `1H O1.5` / `2H U0.5`
16. 1st/2nd Half Handicap → `1H Hcp H(0:1)`
17. Corners O/U → `Cor O8.5`
18. Cards O/U → `Crd O3.5`
19. Early Goals → `EG O0.5`
20. Team-specific O/U → Word-matching algorithm to detect home/away
21. Plain O/U → `M O2.5` / `M U1.5`
22. 1X2 → `H` / `A` / `D`
23. Double Chance → `H/D` / `D/A` / `H/A`
24. GG/NG → `GG` / `NG`
25. Handicap → `Hcp H(0:2)`
26. Goal Bounds → `GB 0-4`
27. HT/FT → `HT/FT H/H`
28. Fallback → `abbreviatePick(pick)`

**Team-specific Over/Under detection algorithm:**

The interpreter strips "Over/Under" from the market string, then tries to match the remaining text to home or away team using:
1. Direct exact match
2. Contains match (either direction)
3. Word-based matching (3+ character words)
4. First significant word fallback

### Deduplication & Sorting

After parsing all selections:
1. **Dedup:** Key = `homeTeam|awayTeam|pick|market` (all lowercase). First occurrence kept.
2. **Sort:** By `kickOffDateTime` ascending (earliest match first).
3. **Filter:** Only `isEligibleForGrouping: true` selections passed to active pool.

Eligibility requires: `status === 'not_started' && !isVoid && !isSuspended`

---

## Section 3: How the Grouping Engine Works

### Combinatorial Algorithm

The grouping engine (`src/engine/grouping-engine.ts`) generates all valid slip combinations from a pool of eligible selections.

**Algorithm: Depth-first backtracking with pruning**

```
Input: eligible selections (sorted by odds ascending)
Output: all valid Slip[] within odds range

function buildCombinations(startIdx, currentGroup, currentOdds):
  // Pruning: stop if we've hit the generation limit
  if slips.length >= maxSlipsToGenerate: return
  
  // Pruning: odds already exceed maximum
  if currentOdds > oddsRange.max: return
  
  // Check if current group is a valid slip
  if currentGroup.length >= minPicksPerSlip:
    if currentOdds >= oddsRange.min AND currentOdds <= oddsRange.max:
      ADD SLIP (don't return — keep looking for larger combos)
  
  // Pruning: reached max picks
  if currentGroup.length >= effectiveMax: return
  
  // Try adding each remaining selection
  for i = startIdx to sorted.length:
    candidate = sorted[i]
    
    // Constraint check: no conflicts with current group
    if conflictsWithGroup(candidate, currentGroup, config): continue
    
    // Pruning: adding this pick would exceed max odds
    if currentOdds * candidate.odds > oddsRange.max: continue
    
    // Recurse
    currentGroup.push(candidate)
    buildCombinations(i + 1, currentGroup, currentOdds * candidate.odds)
    currentGroup.pop()
```

### Constraint System

Three constraints, checked via `hasConflict()`:

| Constraint | Rule | Toggleable | Default |
|-----------|------|-----------|---------|
| Same match | Same homeTeam AND awayTeam (case-insensitive) | NO (always enforced) | Always ON |
| Same team | Any team appears in both selections | YES | ON |
| Same kickoff | Identical kickOffDateTime | YES | OFF |

**Same Match** is a hard rule — it's physically impossible to have two bets from the same match in one accumulator on SportyBet. The other two are user preferences.

### Odds Range Calculation

```
Target: 3.0 (user-configurable)
Range: target × 0.7 to target × 1.3
       = 2.1 to 3.9

This ±30% window ensures:
- Slightly under-target slips still qualify (useful 2-pick combos)
- Slightly over-target slips included (3-pick combos that overshoot slightly)
```

### Quality Scoring Formula

```typescript
function calculateQuality(selections, config): number {
  // Count picks within the "safe zone" (1.20–1.50 odds)
  safeCount = selections.filter(s => s.odds >= 1.20 && s.odds <= 1.50).length
  safeRatio = safeCount / selections.length
  
  // Safe ratio score (80% weight)
  safeScore = safeRatio × 80
  
  // Pick count bonus (more picks = more distributed risk)
  countBonus = min(selections.length × 5, 20)
  
  // Final score: 0-100
  return round(safeScore + countBonus)
}
```

**Interpretation:**
- Score 80-100: All picks in safe zone + good pick count
- Score 50-80: Mix of safe and risky picks
- Score 0-50: Mostly risky picks

### How Max Picks Auto-Adjusts

```
Target 2.0 → min 1 pick, max 2-3 picks  (each pick ~1.4-2.0)
Target 3.0 → min 2 picks, max 4-5 picks  (each pick ~1.3-1.8)
Target 5.0 → min 3 picks, max 6-8 picks  (each pick ~1.3-1.7)
Target 10.0 → min 4 picks, max 10+ picks (each pick ~1.3-1.6)
```

The effectiveMax is `Math.max(config.maxPicksPerSlip, eligible.length)` — so if the user has 15 picks, all 15 are considered even if maxPicksPerSlip is 8.

### Diverse Slip Generation (for parallel chains)

`generateDiverseSlips()` generates slips with minimal match overlap:

1. Generate 10× the requested count of slips
2. Greedily select slips where no match appears in an already-selected slip
3. If can't fill the request with non-overlapping, add remaining best-quality slips

---

## Section 4: How API Integration Works

### Architecture: Rust HTTP Backend

All API calls go through the Tauri Rust backend, NOT the browser's `fetch`:

```
Frontend (TypeScript)
    │
    ├── invoke('http_get', { url, headers })
    │
    ▼
Tauri IPC Bridge
    │
    ▼
Rust Backend (lib.rs)
    │
    ├── reqwest::Client::get(url)
    ├── Add headers (API keys, Accept: application/json)
    ├── 30-second timeout
    ├── Parse response as JSON
    │
    ▼
Return serde_json::Value to frontend
```

**Why Rust instead of browser fetch?**
1. **CORS bypass:** APIs don't allow browser-origin requests. Rust has no CORS restrictions.
2. **No truncation:** Browser fetch can truncate large JSON responses. Rust reads the full body.
3. **Reliable timeout:** Browser fetch timeout behavior is inconsistent.

### The `http_get` Command (src-tauri/src/lib.rs)

```rust
#[tauri::command]
async fn http_get(url: String, headers: HashMap<String, String>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    
    let mut request = client.get(&url);
    for (key, value) in headers {
        request = request.header(&key, &value);
    }
    
    let response = request.send().await?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP {}: {}", status, body));
    }
    
    let text = response.text().await?;
    let json: Value = serde_json::from_str(&text)?;
    Ok(json)
}
```

### Rate Limiting Implementation

```typescript
// Football-Data.org: 10 requests/minute = 1 every 6 seconds
let lastRequestTime = 0;

async function rateLimitedFetch(endpoint: string): Promise<any> {
  const timeSinceLastRequest = Date.now() - lastRequestTime;
  if (timeSinceLastRequest < 6200) {  // 6.2s buffer
    await new Promise(resolve => setTimeout(resolve, 6200 - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return apiFetch(endpoint);
}
```

### Football-Data.org Endpoint Structure

| Endpoint | Purpose | Rate Limit |
|----------|---------|-----------|
| `/competitions/{code}/matches?status=SCHEDULED` | Upcoming fixtures | 10/min |
| `/competitions/{code}/standings` | League table (for position gap) | 10/min |
| `/teams/{id}/matches?status=FINISHED&limit=10` | Team form (last 10) | 10/min |
| `/matches/{id}/head2head?limit=5` | H2H between two teams | 10/min |

**Free plan competitions:** PL, BL1, SA, PD, FL1, DED, PPL, CL, EC, WC, ELC, BSA

### TheSportsDB Endpoint Structure

| Endpoint | Purpose | Rate Limit |
|----------|---------|-----------|
| `eventsnextleague.php?id={leagueId}` | Next 15 upcoming events | Unlimited |
| `eventspastleague.php?id={leagueId}` | Last 15 results | Unlimited |

**League IDs:** 4328 (EPL), 4335 (La Liga), 4332 (Serie A), 4331 (Bundesliga), 4334 (Ligue 1), 4337 (Eredivisie), 4344 (Primeira Liga), 4480 (Champions League), 4329 (Championship)

No API key required — use test key "3" in URL path.

### How to Add a New Provider (Step by Step)

1. **Create the client file:** `src/engine/{provider-name}.ts`

```typescript
import { invoke } from '@tauri-apps/api/core';

const API_HOST = 'https://api.example.com/v1';

// Optional: API key management
let apiKey: string | null = null;
export function setApiKey(key: string) { apiKey = key; }
export function getApiKey(): string | null { return apiKey; }

// Core fetch function (through Rust)
async function apiFetch(endpoint: string): Promise<any> {
  const url = `${API_HOST}${endpoint}`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  
  const result = await invoke('http_get', { url, headers });
  return result;
}

// Rate limiter (adjust timing for provider's limits)
let lastRequestTime = 0;
async function rateLimitedFetch(endpoint: string): Promise<any> {
  const minDelay = 1000; // Adjust based on provider limits
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < minDelay) {
    await new Promise(r => setTimeout(r, minDelay - elapsed));
  }
  lastRequestTime = Date.now();
  return apiFetch(endpoint);
}

// Main data function — map to common format
export async function getUpcomingMatches(options: any): Promise<CommonFixture[]> {
  const data = await rateLimitedFetch('/matches?upcoming=true');
  return data.matches.map(mapToCommonFormat);
}

// Map provider-specific format to common fixture format
function mapToCommonFormat(raw: any): CommonFixture {
  return {
    homeTeam: raw.home_team_name,
    awayTeam: raw.away_team_name,
    kickOff: new Date(raw.start_time),
    league: raw.competition_name,
    // ... add position, form, etc. if available
  };
}
```

2. **Add to MatchSearch.tsx:** Add provider option in the selector dropdown and handle the new data format.

3. **Add leagues/competitions mapping:** Map the provider's league identifiers to display names.

4. **Test:** Verify data returns correctly through Tauri's Rust backend.

5. **Document:** Add to the API Provider Assessment table in CURRENT_STATUS.md.

---

## Section 5: How to Implement v2.1.0 Features

### Feature 1: Smart Pick Scoring

**What it does:** Every selection gets a confidence score (0-100) based on available data.

**What data it needs:**
- Team form (last 5-10 results) → TheSportsDB `eventspastleague.php` or Football-Data.org `getTeamMatches()`
- Position gap (league standings) → Football-Data.org `getStandings()`
- H2H record → KickoffAPI or Football-Data.org `getH2H()`
- Home/away win rate → Calculated from past results

**Scoring formula:**

```typescript
function calculateConfidence(match: MatchData, pick: string): number {
  let score = 50; // Base score
  
  // Factor 1: Position gap (0-25 points)
  // If picking home win and home team is 10+ positions above away team
  const posGap = match.homePosition - match.awayPosition;
  if (pick === 'Home' && posGap < -5) score += Math.min(Math.abs(posGap) * 2, 25);
  if (pick === 'Away' && posGap > 5) score += Math.min(posGap * 2, 25);
  
  // Factor 2: Form (0-20 points)
  // Last 5 results: W=3, D=1, L=0 → max 15, normalized to 20
  const form = pick === 'Home' ? match.homeForm : match.awayForm;
  const formScore = form.reduce((sum, r) => sum + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  score += Math.round((formScore / 15) * 20);
  
  // Factor 3: H2H dominance (0-15 points)
  const h2hWins = match.h2h?.filter(r => favoredTeamWon(r, pick)).length || 0;
  score += h2hWins * 3;
  
  // Factor 4: Home/Away advantage (0-10 points)
  const venueWinRate = pick === 'Home' ? match.homeWinRateHome : match.awayWinRateAway;
  score += Math.round(venueWinRate * 10);
  
  // Factor 5: For Over/Under markets
  if (pick.startsWith('Over')) {
    const overRate = match.combinedOver25Pct;
    score = 50 + Math.round((overRate - 50) * 0.8); // Centered on 50%
  }
  
  return Math.min(Math.max(score, 0), 100); // Clamp 0-100
}
```

**Color coding:**
- Green (75-100): High confidence — safe to include
- Yellow (60-74): Medium confidence — acceptable with other strong picks
- Red (0-59): Low confidence — warning flag, avoid in chains

**Where in the UI:**
- Selection list: new column after odds showing colored score badge
- Generated slips: average confidence displayed per slip
- Search results: confidence column

**Dependencies:** Stats in Search (Feature 2), H2H Quick View (Feature 3)

---

### Feature 2: Stats in Search (O2.5%, BTTS%, Win%, Form)

**What it does:** Displays statistical columns alongside search results for informed pick selection.

**What data it needs:**
- Last 10-15 results per team (home AND away) → TheSportsDB `eventspastleague.php` or Football-Data.org
- Calculate: O2.5%, BTTS%, Win%, Clean Sheet%, Form string

**How to calculate:**

```typescript
interface TeamStats {
  overallWinPct: number;      // Wins / total matches × 100
  homeWinPct: number;         // Home wins / home matches × 100
  awayWinPct: number;         // Away wins / away matches × 100
  over25Pct: number;          // Matches with 3+ total goals / total × 100
  bttsPct: number;            // Matches where both scored / total × 100
  cleanSheetPct: number;      // Matches where team conceded 0 / total × 100
  avgGoalsScored: number;     // Total goals scored / matches
  avgGoalsConceded: number;   // Total goals conceded / matches
  form: ('W' | 'D' | 'L')[];  // Last 5 results
}

function calculateStats(pastMatches: MatchResult[], teamName: string): TeamStats {
  const relevant = pastMatches.filter(m => 
    m.homeTeam === teamName || m.awayTeam === teamName
  );
  
  let wins = 0, over25 = 0, btts = 0, cleanSheets = 0;
  let goalsScored = 0, goalsConceded = 0;
  const form: ('W' | 'D' | 'L')[] = [];
  
  for (const match of relevant) {
    const isHome = match.homeTeam === teamName;
    const scored = isHome ? match.homeScore : match.awayScore;
    const conceded = isHome ? match.awayScore : match.homeScore;
    const totalGoals = match.homeScore + match.awayScore;
    
    goalsScored += scored;
    goalsConceded += conceded;
    
    if (scored > conceded) { wins++; form.push('W'); }
    else if (scored === conceded) { form.push('D'); }
    else { form.push('L'); }
    
    if (totalGoals >= 3) over25++;
    if (match.homeScore > 0 && match.awayScore > 0) btts++;
    if (conceded === 0) cleanSheets++;
  }
  
  const total = relevant.length || 1;
  return {
    overallWinPct: Math.round((wins / total) * 100),
    over25Pct: Math.round((over25 / total) * 100),
    bttsPct: Math.round((btts / total) * 100),
    cleanSheetPct: Math.round((cleanSheets / total) * 100),
    avgGoalsScored: Math.round((goalsScored / total) * 10) / 10,
    avgGoalsConceded: Math.round((goalsConceded / total) * 10) / 10,
    form: form.slice(0, 5),
    // ... home/away split
  };
}
```

**Which API provides it:**
- PRIMARY: TheSportsDB `eventspastleague.php` — returns last 15 results per league (free, unlimited)
- SECONDARY: Football-Data.org `getTeamMatches()` — returns last N finished matches (rate limited)
- FUTURE: KickoffAPI — pre-calculated stats (100/day)

**Caching strategy:**
```typescript
const STATS_CACHE_KEY = 'team-stats-cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getCachedStats(teamName: string): TeamStats | null {
  const cache = JSON.parse(localStorage.getItem(STATS_CACHE_KEY) || '{}');
  const entry = cache[teamName.toLowerCase()];
  if (entry && Date.now() - entry.cachedAt < CACHE_DURATION) {
    return entry.stats;
  }
  return null;
}
```

**Where in the UI:**

Search results table gets new columns:

```
# | Match              | Date  | League | H.Win% | O2.5% | BTTS% | Form(H) | Form(A) | Gap
1 | Man City v Wolves  | 23/08 | PL     | 85%    | 78%   | 55%   | WWWWW   | LLWLD   | +14
2 | Bayern v Freiburg  | 24/08 | BL     | 90%    | 82%   | 48%   | WWWDW   | LDWLL   | +12
```

Form string displayed as colored characters: W=green, D=gray, L=red.

**File to create:** `src/engine/stats-calculator.ts`

**Dependencies:** None (uses existing API providers)

---

### Feature 3: H2H Quick View

**What it does:** Expandable row in search results showing head-to-head history between two teams.

**What data it needs:**
- Last 5 direct meetings between the two teams
- Score of each meeting
- Date of each meeting

**Which API provides it:**
- Football-Data.org: `getH2H(matchId)` → returns head-to-head with scores
- KickoffAPI: H2H endpoint (when integrated)

**How to display:**

```
▼ Man City v Wolves (click to expand)
  ┌─────────────────────────────────────────────────┐
  │ Last 5 H2H: Man City 4 | Draw 1 | Wolves 0     │
  │                                                  │
  │ 15/04/26  Man City 3-0 Wolves                   │
  │ 02/12/25  Wolves 1-2 Man City                   │
  │ 20/08/25  Man City 1-1 Wolves                   │
  │ 12/03/25  Man City 5-1 Wolves                   │
  │ 08/11/24  Wolves 0-2 Man City                   │
  │                                                  │
  │ Avg goals: 3.2 per meeting                      │
  │ Man City wins: 80% | BTTS in H2H: 40%          │
  └─────────────────────────────────────────────────┘
```

**Where in the UI:** Expandable section below each match row in MatchSearch results.

**Dependencies:** Football-Data.org H2H endpoint already implemented (`getH2H()`)

---

### Feature 4: Lock Search Results

**What it does:** User can "pin" matches from search results to a persistent shortlist.

**What data it needs:**
- Match data structure (same as search result)
- Persistence across search refreshes and provider switches

**Implementation:**

```typescript
// In App.tsx or a new store
const [lockedMatches, setLockedMatches] = useState<LockedMatch[]>(() => 
  JSON.parse(localStorage.getItem('locked-matches') || '[]')
);

interface LockedMatch {
  id: string; // generated UUID
  homeTeam: string;
  awayTeam: string;
  kickOff: string; // ISO date
  league: string;
  provider: string;
  lockedAt: string; // ISO date
  suggestedPick?: string;
  confidence?: number;
}
```

**Where in the UI:**
- Search results: "🔒 Lock" button per match row
- Locked panel: Persistent sidebar or top section showing all locked matches
- "Add all locked to Selections" button
- "Unlock" button per locked match
- Visual indicator on search results if match is already locked

**Dependencies:** None

---

### Feature 5: Multi-Tier Generation

**What it does:** Generate slips at multiple target odds simultaneously from the same selection pool.

**Implementation:**

```typescript
function generateMultiTier(
  selections: ParsedSelection[],
  tiers: { target: number; count: number }[]
): Map<number, Slip[]> {
  const results = new Map<number, Slip[]>();
  
  for (const tier of tiers) {
    const config: GroupingConfig = {
      ...DEFAULT_CONFIG,
      targetOdds: tier.target,
      oddsRange: { 
        min: tier.target * 0.7, 
        max: tier.target * 1.3 
      },
      maxSlipsToGenerate: tier.count,
    };
    
    const slips = generateSlips(selections, config);
    results.set(tier.target, slips);
  }
  
  return results;
}

// Usage:
const tiers = [
  { target: 2, count: 5 },   // Safe tier (early chain steps)
  { target: 3, count: 10 },  // Standard tier
  { target: 5, count: 5 },   // Bold tier (later chain steps)
];
```

**Where in the UI:**
- SlipGenerator: New button "Generate Multi-Tier"
- Results displayed in grouped sections: "2-Odds Tier (5 slips)" / "3-Odds Tier (10 slips)" / "5-Odds Tier (5 slips)"
- Each tier color-coded (green/yellow/orange)

**Dependencies:** Existing grouping engine (works as-is, just called multiple times)

---

### Feature 6: "Suggest Best Slip" Button

**What it does:** One-click auto-build of the mathematically safest slip from available selections.

**Implementation:**

```typescript
function suggestBestSlip(
  selections: ParsedSelection[],
  targetOdds: number,
  confidenceScores: Map<string, number>  // selectionId → confidence
): Slip | null {
  // 1. Filter to only high-confidence picks (75+)
  const highConf = selections.filter(s => 
    (confidenceScores.get(s.id) || 0) >= 75
  );
  
  // 2. Sort by confidence (highest first)
  const sorted = [...highConf].sort((a, b) => 
    (confidenceScores.get(b.id) || 0) - (confidenceScores.get(a.id) || 0)
  );
  
  // 3. Greedily build combination closest to target
  const picked: ParsedSelection[] = [];
  let currentOdds = 1.0;
  
  for (const sel of sorted) {
    if (currentOdds * sel.odds > targetOdds * 1.3) continue; // Would exceed
    if (conflictsWithGroup(sel, picked, DEFAULT_CONFIG)) continue;
    
    picked.push(sel);
    currentOdds *= sel.odds;
    
    if (currentOdds >= targetOdds * 0.7) break; // Within range
  }
  
  if (picked.length < 2 || currentOdds < targetOdds * 0.7) return null;
  
  return {
    id: uuidv4(),
    selections: picked,
    accumulatedOdds: Math.round(currentOdds * 100) / 100,
    qualityScore: calculateQuality(picked, DEFAULT_CONFIG),
    hasHighRiskPick: false,
    selectionCount: picked.length,
  };
}
```

**Where in the UI:**
- Dashboard: "Suggest Best 3-Odds Slip" prominent button
- Can offer variants: "Safest 2-Odds" / "Safest 3-Odds" / "Safest 5-Odds"
- Generated slip shown with explanation of why each pick was chosen

**Dependencies:** Smart Pick Scoring (Feature 1)

---

### Feature 7: Kick-off Tracker

**What it does:** Polls API for live match status and shows real-time progress on active slips.

**What data it needs:**
- Match status: Not Started / In Play / Finished
- Current score (if in play or finished)
- Match outcome (for auto-settlement suggestion)

**Which API provides it:**
- SportScore (no key, 10,000 req/day) — real-time scores
- TheSportsDB `eventspastleague.php` — recent results (delayed)

**Implementation:**

```typescript
// Poll every 5 minutes when matches are live
function useKickoffTracker(activeSlips: StakedSlip[]) {
  const [matchStatuses, setMatchStatuses] = useState<Map<string, MatchStatus>>(new Map());
  
  useEffect(() => {
    const interval = setInterval(async () => {
      // Only poll if there are active matches happening NOW
      const liveMatches = getMatchesInProgress(activeSlips);
      if (liveMatches.length === 0) return;
      
      for (const match of liveMatches) {
        const status = await fetchMatchStatus(match);
        setMatchStatuses(prev => new Map(prev).set(matchKey(match), status));
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    return () => clearInterval(interval);
  }, [activeSlips]);
  
  return matchStatuses;
}

interface MatchStatus {
  status: 'not_started' | 'first_half' | 'halftime' | 'second_half' | 'finished';
  score: { home: number; away: number } | null;
  minute: number | null;
  suggestedResult: 'won' | 'lost' | null; // Based on current score vs pick
}
```

**Where in the UI:**
- Active Slips: Status badge per match (gray=not started, yellow=live, green=finished-won, red=finished-lost)
- Score display next to each match when available
- "Auto-settle" button appears when all matches finished

**Dependencies:** SportScore integration

---

### Feature 8: Pre-stake Checklist

**What it does:** Before staking, displays a safety verification dialog.

**Implementation:**

```typescript
interface ChecklistItem {
  label: string;
  passed: boolean;
  severity: 'warning' | 'blocker';
  detail?: string;
}

function generateChecklist(slip: Slip, history: StakedSlip[], chains: Chain[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  
  // Check 1: No same kickoff time (unless intentional)
  const kickoffs = slip.selections.map(s => s.kickOffDateTime.getTime());
  const duplicateKickoffs = kickoffs.filter((k, i) => kickoffs.indexOf(k) !== i);
  items.push({
    label: 'No overlapping kick-off times',
    passed: duplicateKickoffs.length === 0,
    severity: 'warning',
    detail: duplicateKickoffs.length > 0 ? `${duplicateKickoffs.length} matches start at the same time` : undefined,
  });
  
  // Check 2: No repeat losers from history
  const pastLosers = getRepeatLosers(slip.selections, history);
  items.push({
    label: 'No repeat losing picks',
    passed: pastLosers.length === 0,
    severity: 'warning',
    detail: pastLosers.length > 0 ? pastLosers.join(', ') : undefined,
  });
  
  // Check 3: All picks have confidence data
  items.push({
    label: 'All picks have data backing',
    passed: slip.selections.every(s => getConfidence(s) > 0),
    severity: 'warning',
  });
  
  // Check 4: Combined confidence above threshold
  const avgConf = slip.selections.reduce((sum, s) => sum + getConfidence(s), 0) / slip.selectionCount;
  items.push({
    label: `Average confidence above 65% (current: ${Math.round(avgConf)}%)`,
    passed: avgConf >= 65,
    severity: 'blocker',
  });
  
  // Check 5: No team on 3+ losing streak
  // (requires form data)
  
  return items;
}
```

**Where in the UI:**
- Appears as a modal/dialog when user clicks "Mark as Staked"
- Shows all checks with ✓/✗ indicators
- Green "Proceed" button if all pass
- Yellow "Proceed Anyway" if only warnings
- Blocked if any "blocker" items fail

**Dependencies:** Smart Pick Scoring (Feature 1), History data (existing)

---

### Feature 9: Exclude Past Losers

**What it does:** Automatically flags picks that have historically failed for this user.

**What data it needs:**
- Full history of settled picks (already stored)
- Grouping by: team + market type + pick category

**Implementation:**

```typescript
function getLoserWarnings(
  selections: ParsedSelection[],
  history: StakedSlip[]
): Map<string, string> {
  const warnings = new Map<string, string>();
  
  // Build personal loss database from history
  const lossTracker: Record<string, { wins: number; losses: number }> = {};
  
  for (const staked of history) {
    for (const sel of staked.slip.selections) {
      const result = staked.selectionResults[sel.id];
      const key = `${sel.homeTeam.toLowerCase()}|${sel.pickCategory}|${sel.marketType}`;
      
      if (!lossTracker[key]) lossTracker[key] = { wins: 0, losses: 0 };
      if (result === 'won') lossTracker[key].wins++;
      if (result === 'lost') lossTracker[key].losses++;
    }
  }
  
  // Check current selections against loss database
  for (const sel of selections) {
    const key = `${sel.homeTeam.toLowerCase()}|${sel.pickCategory}|${sel.marketType}`;
    const record = lossTracker[key];
    
    if (record && record.losses >= 3 && record.losses > record.wins) {
      warnings.set(sel.id, 
        `⚠ ${sel.homeTeam} ${sel.pickCategory} lost ${record.losses} of your last ${record.wins + record.losses} bets`
      );
    }
  }
  
  return warnings;
}
```

**Where in the UI:**
- Selection list: Orange warning icon next to flagged picks
- Tooltip showing the warning message on hover
- Pre-stake checklist: Included as a check item
- Optional: "Hide repeat losers" filter toggle

**Dependencies:** History data (existing), works better with more history

---

## Section 6: Data Flow Diagrams

### Search Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SEARCH FLOW                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  User Action          Frontend                 Backend       API       │
│  ─────────────        ────────                 ───────       ───       │
│                                                                        │
│  Select Provider  →  MatchSearch.tsx                                   │
│  Select Leagues   →  Update state                                     │
│  Click "Search"   →  Call provider function                           │
│                       │                                               │
│                       ├─ football-data-org.ts                         │
│                       │  getAllUpcomingMatches()                       │
│                       │       │                                       │
│                       │       ├─ invoke('http_get', {url, headers})   │
│                       │       │       │                               │
│                       │       │       └── lib.rs::http_get()   →  Football-Data.org API
│                       │       │              │                         │
│                       │       │              ←  JSON response          │
│                       │       │                                       │
│                       │       ├─ Rate limit (6.2s between calls)      │
│                       │       ├─ Loop through selected competitions   │
│                       │       └─ Aggregate all matches                │
│                       │                                               │
│                       ├─ Parse response → display format              │
│                       ├─ Apply filter (Strong Home, etc.)             │
│                       └─ Render results table                         │
│                                                                        │
│  Select matches   →  Add to selections[]                              │
│  Click "Add"      →  Navigate to Paste & Build tab                    │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Generation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                       GENERATION FLOW                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  selections[]                                                         │
│       │                                                               │
│       ├── Filter: isEligibleForGrouping === true                      │
│       │                                                               │
│       ▼                                                               │
│  SlipGenerator.tsx                                                    │
│       │                                                               │
│       ├── Read config: targetOdds, constraints, safe range            │
│       ├── Calculate: oddsRange = target × [0.7, 1.3]                 │
│       │                                                               │
│       ▼                                                               │
│  grouping-engine.ts::generateSlips()                                  │
│       │                                                               │
│       ├── Sort selections by odds (ascending)                         │
│       ├── Backtracking algorithm: buildCombinations()                 │
│       │   ├── Check constraints (no same match, no same team)         │
│       │   ├── Check odds range (prune if exceeds max)                 │
│       │   ├── Track seen combinations (dedup via Set)                 │
│       │   └── Stop at maxSlipsToGenerate                              │
│       │                                                               │
│       ├── Score each slip: calculateQuality()                         │
│       ├── Sort by quality (highest first)                             │
│       │                                                               │
│       ▼                                                               │
│  generatedSlips[] → Display in GeneratedSlips.tsx                     │
│       │                                                               │
│       ├── Show: selections, accumulated odds, quality badge           │
│       ├── Actions: Stake / Remove / Remove Pick / Copy                │
│       └── Sort options: Quality / Odds / Picks / Kickoff              │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Staking Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         STAKING FLOW                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Generated Slip                                                       │
│       │                                                               │
│       ├── Click "Mark as Staked"                                      │
│       │                                                               │
│       ▼                                                               │
│  Validation                                                           │
│       │                                                               │
│       ├── Check: duplicate matches across active slips?               │
│       │   └── If conflict → BLOCK with error message                  │
│       │                                                               │
│       ├── Check: daily slip limit reached?                            │
│       │   └── If limit → BLOCK with discipline message                │
│       │                                                               │
│       ├── [Future: Pre-stake checklist dialog]                        │
│       │                                                               │
│       ▼                                                               │
│  Create StakedSlip                                                    │
│       │                                                               │
│       ├── slip: the generated Slip object                             │
│       ├── stakedAt: ISO timestamp                                     │
│       ├── result: 'pending'                                           │
│       ├── selectionResults: { [selId]: 'pending' } for each pick      │
│       ├── chainId: linked chain (or null)                             │
│       ├── label: user-defined name                                    │
│       │                                                               │
│       ▼                                                               │
│  Save to localStorage (stakedSlips[])                                 │
│  Remove from generatedSlips[]                                         │
│       │                                                               │
│       ▼                                                               │
│  Active Slips View                                                    │
│       │                                                               │
│       ├── Per-match result buttons (✓/✗)                              │
│       │   ├── Mark "won": update selectionResults[id] = 'won'         │
│       │   │   └── If ALL won → slip auto-completes → move to history  │
│       │   │       └── If linked chain → advanceChain(winAmount)       │
│       │   │                                                           │
│       │   └── Mark "lost": selectionResults[id] = 'lost'             │
│       │       └── ENTIRE SLIP auto-lost → move to history             │
│       │           └── If linked chain → breakChain("Match lost")      │
│       │                                                               │
│       ├── Undo Stake: return to generated list                        │
│       └── Copy to clipboard: for sharing/reference                    │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Learning Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         LEARNING FLOW                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  History (settled slips)                                              │
│       │                                                               │
│       ▼                                                               │
│  accuracy.ts::calculateAccuracy()                                     │
│       │                                                               │
│       ├── Group by market type:                                       │
│       │   "1X2: 73% (22/30)"                                         │
│       │   "Over/Under: 65% (13/20)"                                  │
│       │   "GG/NG: 58% (7/12)"                                        │
│       │                                                               │
│       ├── Group by odds range:                                        │
│       │   "1.20-1.40: 82% hit rate"                                  │
│       │   "1.41-1.60: 71% hit rate"                                  │
│       │   "1.61-1.80: 63% hit rate"                                  │
│       │   "1.81-2.00: 55% hit rate"                                  │
│       │                                                               │
│       ├── Overall: "68% (87/128 picks)"                               │
│       │                                                               │
│       ▼                                                               │
│  [Future v2.2.0: Pattern Detection]                                   │
│       │                                                               │
│       ├── Detect: "Serie A picks lose 40% of the time"               │
│       ├── Detect: "Monday picks have 30% lower win rate"             │
│       ├── Detect: "Over 2.5 in low-scoring leagues fails"            │
│       │                                                               │
│       ▼                                                               │
│  [Future v2.2.0: Scoring Adjustment]                                  │
│       │                                                               │
│       ├── Feed accuracy data into confidence scoring                  │
│       ├── Penalize markets/leagues where user historically loses      │
│       ├── Boost markets/leagues where user historically wins          │
│       └── Progressive threshold: chain step 5+ requires 80%+ conf    │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Common Patterns & Conventions

### Adding a New Component

1. Create `src/components/NewComponent.tsx`
2. Import and render in `App.tsx` within the appropriate view
3. Pass state and callbacks as props (all state lives in App.tsx)
4. Use Tailwind for styling (dark theme: `bg-gray-800`, `text-gray-100`, etc.)

### Adding a New Engine Module

1. Create `src/engine/new-module.ts`
2. Export pure functions (no React, no side effects)
3. Define interfaces in `src/engine/types.ts`
4. Import and use in components via props/callbacks

### localStorage Key Convention

| Key | Contents |
|-----|----------|
| `stakedSlips` | StakedSlip[] |
| `slipHistory` | StakedSlip[] |
| `chains` | Chain[] |
| `appSettings` | AppSettings |
| `team-stats-cache` | Cached team statistics (planned) |
| `locked-matches` | LockedMatch[] (planned) |

### Styling Convention (Tailwind Dark Theme)

| Element | Classes |
|---------|---------|
| Background (main) | `bg-gray-900` |
| Background (card) | `bg-gray-800` |
| Background (nav) | `bg-gray-800 border-b border-gray-700` |
| Text (primary) | `text-gray-100` |
| Text (secondary) | `text-gray-300` |
| Text (muted) | `text-gray-400` / `text-gray-500` |
| Accent (active) | `bg-blue-600 text-white` |
| Success | `bg-green-600` / `text-green-400` |
| Danger | `bg-red-900` / `text-red-400` |
| Warning | `bg-yellow-600` / `text-yellow-400` |
| Button (primary) | `px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium` |
| Button (ghost) | `px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium text-gray-300` |
| Badge | `px-2 py-1 rounded-full text-xs font-bold` |

### Error Handling Pattern

```typescript
// API calls: try/catch with user-friendly error
try {
  const data = await rateLimitedFetch(endpoint);
  // process data
} catch (e: any) {
  // Store first error for debugging, continue if possible
  if (!firstError) firstError = `${context}: ${e.message}`;
}

// If ALL calls failed, throw aggregated error
if (results.length === 0 && firstError) {
  throw new Error(`API failed — ${firstError}`);
}
```

---

## Appendix B: SQLite Schema (Ready, Not Yet Active)

The Rust backend has migrations ready for SQLite. Currently not used (localStorage handles everything), but the schema is defined for future migration:

```sql
-- Chains table
CREATE TABLE chains (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    starting_stake REAL NOT NULL,
    target_amount REAL,
    current_step INTEGER DEFAULT 0,
    current_stake REAL NOT NULL,
    status TEXT DEFAULT 'active',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    break_reason TEXT
);

-- Slips table (linked to chains)
CREATE TABLE slips (
    id TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    accumulated_odds REAL NOT NULL,
    quality_score REAL,
    stake_amount REAL NOT NULL,
    potential_return REAL NOT NULL,
    status TEXT DEFAULT 'staked',
    staked_at TEXT NOT NULL,
    settled_at TEXT,
    FOREIGN KEY (chain_id) REFERENCES chains(id)
);

-- Individual selections within slips
CREATE TABLE slip_selections (
    id TEXT PRIMARY KEY,
    slip_id TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    kick_off_time TEXT NOT NULL,
    market TEXT NOT NULL,
    pick TEXT NOT NULL,
    odds REAL NOT NULL,
    confidence REAL,
    league TEXT,
    provider TEXT,
    result TEXT,
    FOREIGN KEY (slip_id) REFERENCES slips(id)
);

-- Match analysis cache
CREATE TABLE match_cache (
    id TEXT PRIMARY KEY,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    kick_off_time TEXT NOT NULL,
    league TEXT,
    analysis_json TEXT NOT NULL,
    cached_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- Financial transactions
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,      -- 'deposit', 'withdrawal', 'win', 'loss'
    amount REAL NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
);

-- App settings (key-value)
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## Appendix C: Testing Strategy

### Manual Testing Checklist (Before Each Release)

1. **Parser:** Paste a fresh SportyBet selection → verify all fields parsed correctly
2. **Dedup:** Paste same data twice → verify no duplicates
3. **Generation:** Generate slips → verify all are within odds range
4. **Constraints:** Enable "no same team" → verify no team appears twice in any slip
5. **Staking:** Stake a slip → verify it moves to active, not in generated
6. **Settlement:** Mark one match lost → verify entire slip moves to history as lost
7. **Chain:** Link slip to chain → win → verify chain advances with correct amount
8. **Chain break:** Link slip → lose → verify chain status = broken
9. **Daily limit:** Stake up to limit → verify next stake is blocked
10. **Export/Import:** Export → clear data → import → verify all restored
11. **Search:** Search with Football-Data.org → verify results display with leagues
12. **Rate limit:** Search multiple leagues → verify no 429 errors

### Future: Automated Testing

When the codebase grows, add:
- Unit tests for `parser-sportybet.ts` (many edge cases documented in spec)
- Unit tests for `grouping-engine.ts` (constraint validation, odds range)
- Unit tests for `market-interpreter.ts` (all 28+ market types)
- Integration tests for API providers (mock responses)

---

*This document should be sufficient for any developer to understand the entire system architecture, implement the next set of features, and maintain consistency with existing patterns.*
