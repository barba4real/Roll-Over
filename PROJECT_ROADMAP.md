# Roll-Over: Personal Betting Compounding Tool

## Foundation Document

---

## 1. What This Is

Roll-Over is a personal desktop tool built by a developer, for that developer. It is not a product for sale, not a public app, not a betting platform. It is a disciplined research assistant and compounding tracker that:

1. Scouts upcoming matches using free football APIs
2. Suggests the safest possible picks based on data (form, H2H, stats)
3. Builds optimized accumulator slips targeting specific odds (typically ~2.0)
4. Tracks the rollover journey: ₦100 → 200 → 400 → 800 → target
5. Enforces discipline through simple reminders and rules

The philosophy: **small, consistent wins compounded over time beat one lucky jackpot.**

---

## 2. The Rollover Strategy

Start with a small stake. Win a 2-odds slip. Roll the entire win into the next slip. Repeat until the target is reached.

```
₦100 → ₦200 → ₦400 → ₦800 → ₦1,600 → ₦3,200 → ₦6,400 → ₦12,800 → ...
```

Each slip targets ~2.0 accumulated odds, built from:
- 2–3 selections at 1.20–1.50 each
- Occasionally one "worthy" pick at ~2.00 odds when data strongly supports it

The chain breaks if ONE slip loses. So the tool's entire purpose is making each slip as safe as humanly possible through research and data.

---

## 3. Core Functions

### 3.1 Match Scout (Online)

Query free football APIs for upcoming fixtures (1–7 days ahead). For each match, build a **team behavior profile**:

**Home team (at home):**
- Win rate (last 10-15 home games)
- Goals scored average
- Goals conceded average
- Scoring rate (% games they score in)
- Clean sheet rate
- Form string (WWDLW)

**Away team (away from home):**
- Win rate (last 10-15 away games)
- Goals scored average
- Goals conceded average
- Scoring rate (% games they score in)
- Clean sheet rate
- Form string (LWLWL)

**Context:**
- League positions (gap = predictability indicator)
- Head-to-head at this venue
- Red flag check (derby? fatigue? rotation? new manager?)

**Output:** Ranked list of matches where outcomes are most predictable, with specific pick suggestions and confidence scores. Only matches with 70%+ confidence on at least one pick make the cut.

### 3.2 Selection Intelligence (Pick Suggestion Engine)

The brain of the tool. Doesn't just look at odds — analyzes **team behavior patterns** to determine why a pick is safe.

**Core factors evaluated per match:**

| Factor | What it reveals | Pick it supports |
|--------|----------------|-----------------|
| Home win rate (>80%) | Fortress team — rarely loses at home | Home Win @ 1.20–1.40 |
| Home scoring avg (>2.0) | Goal machine at home | Over 1.5 match goals |
| Home scoring rate (>90%) | Almost always finds the net at home | Home Team Over 0.5 |
| Away scoring rate (>75%) | Reliable scorers on the road | Away Team Over 0.5 |
| High scoring + conceding | Open game, goals flow both ways | Over 2.5, GG/Both Teams Score |
| Large league position gap (>10) | Big quality difference | Favorite wins |
| H2H dominance (4/5+ wins) | Historical pattern repeats | Matches H2H trend |
| Clean sheet rate at home (>50%) | Strong home defense | Home Win, Under for opponent |

**Pick suggestion logic:**

```
For each upcoming match:
  1. Pull home team's home record (last 10-15 games)
  2. Pull away team's away record (last 10-15 games)
  3. Pull H2H at this venue (last 5 meetings)
  4. Calculate scoring/conceding averages
  5. Identify dominant patterns
  6. Suggest picks that align with MULTIPLE factors
  7. Score confidence (0-100) based on how many factors agree
  8. Only recommend if confidence > 70%
```

**What makes a pick "safe" (multiple factors must agree):**

- Home Win: Home team wins 80%+ at home AND opponent loses 60%+ away AND H2H favors home
- Over 1.5: Home team scores 2+ avg at home AND away team concedes 1.5+ avg away
- Away Over 0.5: Away team scores in 75%+ of away games
- GG/Both Score: Both teams score in 60%+ of respective home/away games

**"Worthy" 2.0 picks (allowed one per slip if):**

- Confidence is > 75% despite higher odds
- At least 3 factors strongly support the pick
- No red flags present

**Red flags that SKIP a match entirely:**

- Derby/rivalry match (emotion > form)
- End of season dead rubber or relegation battle
- Team playing 3rd game in 7 days (fatigue/rotation)
- Manager sacked or appointed within 2 weeks
- Both teams have similar home/away records (coin flip)
- Newly promoted team early in season (no reliable data)
- Cup match where stronger team may rotate squad

**The tool should also say "NO BET TODAY" when:**

- Available matches don't produce slips with 70%+ confidence on ALL picks
- Data is inconclusive or patterns conflict
- Only risky matches are available

"The best rollover move some days is no move at all."

### 3.3 Slip Builder (Offline Core)

User pastes their match list from SportyBet (or selects from suggestions). The engine:
- Parses the pasted data into structured selections
- Groups selections into slips targeting the desired accumulated odds
- Applies constraints:
  - No team appearing twice in a slip
  - **No two matches with same kick-off time in a slip (default rule — always on unless explicitly overridden)**
  - No duplicate matches across parallel chains in the same cycle
  - At most one "risky" (>1.50) pick per slip (configurable)
  - Minimum confidence threshold per pick
- Generates multiple slip options ranked by quality/safety
- Staggered kick-offs preferred (watch results come in sequentially)

**Slip lifecycle:**
```
GENERATED (temp, in-memory) → user marks "STAKED" → SAVED (monitored) → WON/LOST (archived)
                            → not staked → DISCARDED (never saved)
```

- Only slips marked as **"STAKED"** are persisted to database
- Unstaked suggestions are temporary — regenerated or discarded on next session
- Staked slips are actively monitored for results (auto via API or manual)
- Won slips advance the chain; lost slips break and archive the chain

### 3.4 Rollover Tracker

Tracks multiple concurrent compounding chains:

**Chain rules:**
- Multiple chains run simultaneously (e.g., 3 chains at ₦100 each)
- No duplicate matches across chains in the same cycle (diversification)
- Chain break = restart from minimum stake (always, no exceptions)
- At a defined profit milestone: withdraw initial investment, let profits continue
- Each chain is independent — one breaking doesn't affect others

**Tracks per chain:**
- Current step (e.g., "Step 4: Stake ₦800")
- History of wins/losses per step
- Running P&L
- Longest successful chain
- Average chain length before break

**Across all chains:**
- Total active chains
- Total capital deployed
- Combined P&L
- "Investment recovered" milestone tracker
- "You need X more successful steps across chains to recover initial stake"

When a chain breaks:
- Log it
- Reset that chain to minimum starting stake
- No emotion — just restart

### 3.5 Result Tracking (Auto + Manual)

- **Auto mode (primary):** Query APIs for match results after kick-off time passes. Mark slips as won/lost automatically.
- **Manual fallback:** If API fails or match isn't covered, manually mark slip result.
- **Paste mode:** Paste settled ticket from SportyBet — parser extracts outcomes and maps to active slips.

Auto-check schedule:
- Poll for results 2 hours after last match in a slip kicks off
- Retry every 30 minutes if result not yet available
- Mark slip won only when ALL picks confirmed won
- Mark slip lost as soon as any pick confirmed lost

### 3.6 Discipline Module

Simple, ever-present reminders:
- **"STICK TO THE RULES"** — always visible
- "Don't chase losses"
- "If the data doesn't support it, don't pick it"
- "2 odds is enough. Don't get greedy."
- "One bad pick kills the chain. Be ruthless with selection."

Not a complex system — just a flasher/banner that keeps the developer honest.

### 3.7 Main Screen Layout

Side-by-side view on launch:

```
┌──────────────────────────────┬──────────────────────────────┐
│  TODAY'S SUGGESTIONS          │  CHAIN STATUS                 │
│                               │                               │
│  Match 1: Bayern v Freiburg   │  Chain A: Step 5 (₦1,600)    │
│  → Home @1.25 [88% conf]     │  Chain B: Step 3 (₦400)      │
│                               │  Chain C: Step 1 (₦100) 🔄   │
│  Match 2: Inter v Monza       │                               │
│  → Home @1.30 [82% conf]     │  Total deployed: ₦2,100      │
│                               │  Total P&L: +₦1,900          │
│  Match 3: Celtic v Ross Co    │  Longest chain: 7 steps      │
│  → Home @1.22 [79% conf]     │                               │
│                               │  ──────────────────────────── │
│  ───────────────────────────  │  DISCIPLINE                   │
│  Suggested slip: 2.01 odds    │  🔴 STICK TO THE RULES       │
│  Quality: ★★★★☆              │                               │
│                               │  "2 odds is enough."          │
│  [Build Slip] [Scout More]    │  "Trust the data."            │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 4. Data Sources

### 4.1 Paste Input (Primary - Offline)

User pastes match selections from:
- **SportyBet** — Full detailed format (Context A, B, or C as documented in parser spec)
- **Bet9ja** — Using their event codes to quickly locate matches

Parser handles multiple formats and extracts: teams, kick-off time, market, pick, odds, status.

### 4.2 Free Football APIs (Online Enhancement)

| API | Purpose | Free Tier |
|-----|---------|-----------|
| API-Football | Fixtures, team stats, H2H, form | 100 requests/day |
| Football Prediction API (RapidAPI) | Win probabilities, model predictions | Free tier |
| The Odds API | Odds comparison across bookmakers | 500 requests/month |

These power the Match Scout and Pick Suggestion features.

### 4.3 Bet9ja Quick Codes

Bet9ja's shop (shop.bet9ja.com) allows loading matches by event code. The app can display Bet9ja-friendly match codes alongside suggestions so the developer can quickly build slips on that platform without scrolling.

---

## 5. Data Storage

**Engine: SQLite** (single file, local, no server, easy backup)

**Package:** `better-sqlite3` (synchronous, fast, reliable in Electron)

**Database schema:**

```sql
-- Active and archived chains
CREATE TABLE chains (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,              -- "Chain A", "Chain B"
  starting_stake REAL NOT NULL,
  target_amount REAL,
  current_step INTEGER DEFAULT 0,
  current_stake REAL NOT NULL,
  status TEXT DEFAULT 'active',     -- active | completed | broken
  started_at TEXT NOT NULL,
  ended_at TEXT,
  break_reason TEXT                 -- why it broke (which slip lost)
);

-- Only staked slips are saved here
CREATE TABLE slips (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  accumulated_odds REAL NOT NULL,
  quality_score REAL,
  stake_amount REAL NOT NULL,
  potential_return REAL NOT NULL,
  status TEXT DEFAULT 'staked',     -- staked | won | lost
  staked_at TEXT NOT NULL,
  settled_at TEXT,
  FOREIGN KEY (chain_id) REFERENCES chains(id)
);

-- Picks within a staked slip
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
  provider TEXT,                    -- sportybet | bet9ja
  result TEXT,                      -- won | lost | void | pending
  FOREIGN KEY (slip_id) REFERENCES slips(id)
);

-- Scouting cache (expires after 7 days)
CREATE TABLE match_cache (
  id TEXT PRIMARY KEY,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kick_off_time TEXT NOT NULL,
  league TEXT,
  analysis_json TEXT NOT NULL,      -- Full MatchAnalysis as JSON
  cached_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Withdrawals and deposits
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- deposit | withdrawal
  amount REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- User settings and rules
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Persistence rules:**
| Data | Stored? | Lifetime |
|------|---------|----------|
| Generated suggestions (not staked) | NO — in-memory only | Until app closes or regenerated |
| Staked slips | YES | Permanent (archived after settle) |
| Chain progress | YES | Permanent |
| Broken chain history | YES | Permanent (for analytics) |
| Match scouting cache | YES | 7 days, then auto-purged |
| User preferences | YES | Permanent |
| Transactions (withdraw/deposit) | YES | Permanent |

**Backup:** Single `rollover.db` file — copy it anywhere for backup.

## 6. Technical Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Desktop Framework | Electron | Cross-platform, full Node.js access for APIs |
| UI | React + TypeScript | Fast development, type safety |
| Styling | Tailwind CSS | Quick, functional styling (not pretty — functional) |
| Local Database | SQLite (better-sqlite3) | History, tracking, performance data |
| API Client | Axios | HTTP calls to free football APIs |
| Build | Vite + electron-builder | Fast builds, easy packaging |

---

## 7. System Architecture

```
┌────────────────────────────────────────────┐
│              ROLL-OVER                       │
├────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ MATCH SCOUT                          │   │
│  │ • Query APIs for upcoming fixtures   │   │
│  │ • Score match predictability         │   │
│  │ • Surface safest picks               │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ PARSER ENGINE                        │   │
│  │ • SportyBet format parser            │   │
│  │ • Bet9ja format parser               │   │
│  │ • Auto-detect paste context          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ GROUPING ENGINE                      │   │
│  │ • Build 2-odds slips from picks      │   │
│  │ • Apply constraints                  │   │
│  │ • Rank by quality/confidence         │   │
│  │ • Allow one "worthy" high-odds pick  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ ROLLOVER TRACKER                     │   │
│  │ • Track current chain step           │   │
│  │ • Log wins/losses                    │   │
│  │ • Calculate P&L                      │   │
│  │ • Show progress to target            │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ DISCIPLINE MODULE                    │   │
│  │ • "STICK TO THE RULES" banner        │   │
│  │ • Anti-greed reminders               │   │
│  │ • Chain-break reset logic            │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ DATA STORE (SQLite)                  │   │
│  │ • Rollover history                   │   │
│  │ • Pick performance                   │   │
│  │ • League/team stats cache            │   │
│  │ • User preferences                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
└────────────────────────────────────────────┘
```

---

## 8. Data Models

```typescript
// A single match pick
interface Selection {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickOffTime: Date;
  market: string;
  pick: string;
  odds: number;
  league: string;
  provider: "sportybet" | "bet9ja";
  confidence: number;         // 0-100, from analysis
  isHighRisk: boolean;        // odds > 1.50
  gameId: string | null;
  status: "not_started" | "won" | "lost" | "void";
}

// Match behavior analysis (from APIs)
interface MatchAnalysis {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickOffTime: Date;
  league: string;

  // Home team patterns (at home)
  homeWinRate: number;           // % of home games won
  homeGoalsScoredAvg: number;    // Avg goals scored at home per game
  homeGoalsConcededAvg: number;  // Avg goals conceded at home per game
  homeCleanSheetRate: number;    // % home games with clean sheet
  homeScoringRate: number;       // % home games where they score at least 1
  homeForm: string;              // e.g., "WWDWW" (last 5 home games)

  // Away team patterns (away from home)
  awayWinRate: number;           // % of away games won
  awayGoalsScoredAvg: number;    // Avg goals scored away per game
  awayGoalsConcededAvg: number;  // Avg goals conceded away per game
  awayCleanSheetRate: number;    // % away games with clean sheet
  awayScoringRate: number;       // % away games where they score at least 1
  awayForm: string;              // e.g., "LWLDL" (last 5 away games)

  // Context
  leaguePositionHome: number;
  leaguePositionAway: number;
  leaguePositionGap: number;
  h2hAtVenue: { homeWins: number; draws: number; awayWins: number; total: number };

  // Derived suggestions
  suggestedPicks: SuggestedPick[];
  redFlags: string[];
  isSkipRecommended: boolean;    // True if match is too unpredictable
}

interface SuggestedPick {
  market: string;               // "1X2", "Over/Under", "GG/NG"
  pick: string;                 // "Home", "Over 1.5", "Yes"
  confidence: number;           // 0-100
  factorsSupporting: string[];  // ["Home win rate 85%", "H2H: 4/5 home wins", "Opponent lost 8/10 away"]
  factorsAgainst: string[];     // ["Derby match", "3rd game in 7 days"]
  expectedOddsRange: { min: number; max: number };
  isRecommended: boolean;       // Passes all safety thresholds
  isWorthyHighRisk: boolean;    // A calculated >1.50 pick backed by strong data
}

// A generated slip
interface Slip {
  id: string;
  selections: Selection[];
  accumulatedOdds: number;
  qualityScore: number;       // Higher = safer (avg confidence of all picks)
  hasHighRiskPick: boolean;   // Contains a >1.50 pick
  createdAt: Date;
  result: "pending" | "won" | "lost" | null;
}

// Rollover journey
interface RolloverChain {
  id: string;
  label: string;              // "Chain A", "Chain B", etc.
  startDate: Date;
  startingStake: number;      // Always resets to this on break
  targetAmount: number;
  currentStep: number;
  currentStake: number;
  steps: RolloverStep[];
  status: "active" | "completed" | "broken";
}

interface RolloverStep {
  stepNumber: number;
  stakeIn: number;
  targetOdds: number;
  slip: Slip;
  result: "won" | "lost" | "pending";
  amountOut: number | null;
  date: Date;
}

// Portfolio-level tracking across all chains
interface RolloverPortfolio {
  activeChains: RolloverChain[];
  completedChains: RolloverChain[];
  brokenChains: RolloverChain[];
  totalDeployed: number;         // Sum of all active chain stakes
  totalPnL: number;              // Running profit/loss
  initialInvestmentRecovered: boolean;
  withdrawals: { amount: number; date: Date }[];
  longestChainEver: number;      // Steps
  averageChainLength: number;
}

// Discipline config
interface DisciplineRules {
  maxOddsPerPick: number;          // Default: 1.50
  maxHighRiskPerSlip: number;      // Default: 1
  targetSlipOdds: number;          // Default: 2.0
  slipOddsRange: { min: number; max: number };  // Default: 1.8 - 2.5
  dailyMaxAttempts: number;        // How many slips per day max
  stopOnConsecutiveLosses: number; // Pause after X chain breaks in a day
  reminderMessage: string;         // "STICK TO THE RULES"
  noBetThreshold: number;          // Min confidence to allow bet (default: 70)
}
```

---

## 9. Development Phases

### Phase 1: Core Offline Engine (Weeks 1-3)

- [ ] Project scaffolding (Electron + React + TypeScript)
- [ ] SportyBet parser (Context A, B, C)
- [ ] Source list display
- [ ] Grouping engine (target ~2.0 odds slips)
- [ ] Basic constraints (no duplicate team, max one high-risk pick)
- [ ] Generated slips display with accumulated odds
- [ ] Discipline banner ("STICK TO THE RULES")
- [ ] Basic rollover tracker (current step, stake history)

### Phase 2: Match Scout (Weeks 4-6)

- [ ] API-Football integration (fixtures, team stats, form)
- [ ] Match scoring algorithm (predict safest outcomes)
- [ ] Pick suggestions display (this week's safest matches)
- [ ] Confidence scoring per selection
- [ ] Red flag detection (derbies, cup matches, end-of-season)
- [ ] Slip quality ranking based on confidence data

### Phase 3: Intelligence & Tracking (Weeks 7-9)

- [ ] Full rollover journey tracker with history
- [ ] Performance analytics (win rate by market, league, odds range)
- [ ] Chain analysis (average chain length, best strategies)
- [ ] Bet9ja format parser
- [ ] Slip result logging (manual input: won/lost)
- [ ] Learning feedback: which picks/leagues work best for you

### Phase 4: Refinement (Weeks 10-12)

- [ ] Advanced scouting (H2H deep dive, goals trends, injury awareness)
- [ ] Strategy templates (conservative, balanced, one-bold-pick)
- [ ] Profit/loss dashboard
- [ ] Data export for personal records
- [ ] Performance optimization
- [ ] Polish and daily-driver reliability

---

## 10. Constraints & Rules Engine

Default rules (configurable):

| Rule | Default | Purpose |
|------|---------|---------|
| Target slip odds | 1.8 – 2.5 | Sweet spot for rollover |
| Max odds per pick | 1.50 | Stay in safe zone |
| Allow one high-risk pick | Yes (if confidence > 75%) | Calculated aggression |
| No duplicate team in slip | Always on | Avoid correlated failure |
| No same kick-off time in slip | Always on (override available) | Staggered results, avoid correlated time risk |
| No duplicate match across chains | Always on | Diversification across parallel chains |
| Min confidence per pick | 65% | Don't include uncertain picks |
| Max picks per slip | 4 | Keep it tight and safe |
| Min picks per slip | 2 | Must accumulate, not single |

---

## 11. The Discipline Philosophy

This section exists because the developer knows himself. The tool must:

- Never let excitement override data
- Always show the current chain status (grounding)
- Remind that one slip loss resets to zero — pick carefully
- Discourage "just one more bet today" after a chain break
- Celebrate milestones (chain step 5+, new personal best)
- Show long-term progress even when individual chains break

**The mantra: "I'm not gambling. I'm compounding."**

---

## 12. Success Criteria

- The tool reliably suggests 5-10 safe picks per day from API data
- Generated slips are consistently in the 1.8–2.5 odds range
- Rollover chains last 3+ steps on average (measured over months)
- The developer trusts the tool's suggestions over gut feeling
- Clear P&L visibility at all times
- Runs daily as part of betting routine

---

## 13. Open Questions

1. What free API gives the best prediction accuracy? (Will test during Phase 2)
2. Bet9ja event code format — need sample to understand structure
3. At what chain step should profits be partially withdrawn? (Risk management)
4. Should the tool support multiple concurrent chains? (Diversification)
5. How to handle matches where APIs disagree on predicted outcome?

---

*Document Version: 2.0*
*Rewritten: August 2026*
*For: Personal use only*
*Philosophy: Discipline + Data + Compounding = Freedom*
