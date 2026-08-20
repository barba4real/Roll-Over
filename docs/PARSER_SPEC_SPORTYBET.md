# SportyBet Paste Format — Parser Specification

## Overview

This document defines how to parse raw pasted text from SportyBet's betslip/bet list view into structured selection data.

---

## Paste Contexts

SportyBet data can be pasted from different views:

### Context A: Open Betlist (Pre-match selections)

- Contains: Selections user is considering/preparing
- Has: Game IDs, "Not Started" status, no scores
- Use case: **Primary input for Roll-Over group generation**

### Context B: Settled Ticket (Bet history)

- Contains: Completed bet with results
- Has: Ticket header (ID, stake, odds, return), all results, scores
- Use case: **Historical analysis, performance tracking (Phase 2+)**

### Context C: Running Ticket (Active bet)

- Contains: Mix of settled and pending selections
- Has: Bet header (ID, stake, odds, potential win), partial results
- Use case: **Import active selections for re-grouping, analysis**

### Context D: Compact/Share View (Betslip summary)

- Contains: Condensed list of selections without dates or match details
- Has: Pick, teams, market, odds — one selection per 3 lines
- Missing: Dates, kick-off times, Game IDs, status, results
- **NOT SUPPORTED** — Insufficient data for group generation (no dates/times means time-based constraints and scheduling are impossible)
- If detected, app should prompt user to paste the full detailed format instead

---

## Header Formats

### Format 1: Settled Ticket Header (Context B)

```
Ticket Details (ID: [ticketId])
[DD/MM/YYYY] [HH:MM]
[IP] | [Device]
\n
[BetType]
[OverallResult]
Free Bet Gift : - [amount]     ← optional
Total Stake : [amount]
Total Odds : [totalOdds]
Total Return : [amount]
```

### Format 2: Running/Active Bet Header (Context C)

```
Bet ID: [betId]
[BetType]
[Status]
Total Return
[amount or --]
Stake [amount]
Odds [totalOdds]
Bonus [amount]
Pot. Win  [amount]
Selection Details
```

### Parsed Ticket/Bet Header

```typescript
interface TicketHeader {
  ticketId: string;             // From "Ticket Details (ID: ...)" or "Bet ID: ..."
  datePlaced: Date | null;
  device: string | null;        // "Desktop" | "Mobile" | null
  betType: string;              // "Multiple" | "Single"
  overallResult: string;        // "Won" | "Lost" | "Running" | "Pending"
  freeBetGift: number | null;
  totalStake: number;
  totalOdds: number;
  totalReturn: number | null;   // null if running (shown as --)
  bonus: number | null;         // Only in running bet format
  potentialWin: number | null;  // Only in running bet format
}
```

---

## Ticket Footer (Context B only)

```
Number of Bets: [count]
Check Bet Details
Cashout Details
Total Cashout
[amount]
Total Used Stake
[amount]
```

---

## Block Structure

Each selection is a repeating block separated by visual whitespace. The format varies slightly between **Not Started** and **Settled/Live** matches.

### Standard Block (Not Started — Context A)

```
[index]
[DD/MM] [HH:MM]
Game ID: [gameId]
Not Started
[homeTeam]
\n
[awayTeam]
\n
--
Pick
[pickValue] @[odds]
\n
Market
[marketType]
\n
Result
--
```

### Settled/Live Block (Context A or B)

```
[index]
[DD/MM] [HH:MM]
Game ID: [gameId]                ← Present in Context A only
Check Live Tracker >
[statusLabel]                    ← Optional (e.g., "1UP Early Payout")
[homeTeam]
\n
[awayTeam]
\n
[homeScore]
[awayScore]
Pick
[pickValue] @[odds]
\n
Market
[marketType]
\n
Result
[resultValue]
\n
[resultMessage]                  ← Optional
```

**Note:** In Context B (settled tickets), the Game ID line may be absent.

---

## Field Definitions

| Field | Format | Example | Notes |
|-------|--------|---------|-------|
| **index** | Integer | `1`, `23`, `50` | Sequential position in bet list |
| **date** | DD/MM | `23/08`, `16/08` | No year — infer from context |
| **time** | HH:MM | `11:45`, `06:00` | Assumed to be in user's timezone or provider default |
| **gameId** | Integer | `40246`, `32134` | SportyBet's internal match ID |
| **status** | String | `Not Started`, `Check Live Tracker >`, `Won`, `Lost`, `Void` | Determines block variant & settlement state |
| **statusLabel** | String (optional) | `1UP Early Payout` | Only present on settled/live matches |
| **homeTeam** | String | `PSG`, `Real Madrid` | Home team name |
| **awayTeam** | String | `Rennes`, `Real Sociedad` | Away team name |
| **score** | String | `--` or `[h]\n[a]` | `--` for not started; two lines for live/settled |
| **pickValue** | String | `Home @1.20`, `Over 3.5 @2.65`, `Draw or Away @1.38`, `0-4 @1.25`, `Yes @1.80`, `Away (0:2) @1.23`, `Home/Away & Under 4.5 @1.42` | Full pick including market-specific values |
| **pickSide** | String | `Home`, `Away`, `Draw`, `Over 3.5`, `Under 2.5`, `Draw or Away`, `0-4`, `Yes`, `No`, `Away (0:2)`, `Home/Away & Under 4.5` | Extracted pick selection (everything before @) |
| **odds** | Decimal | `1.20`, `2.65`, `1.92` | Decimal odds at time of selection |
| **marketType** | String | `1X2`, `1X2 - 1UP`, `Over/Under`, `Over/Under - Early Goals`, `2nd Half - Over/Under`, `Double Chance - 1UP`, `Goal Bounds`, `GG/NG`, `Handicap 0:2`, `1st Half - Handicap`, `Double Chance & Over/Under 4.5`, `Any Team To Score 2 or More Goals in a Row`, `Bayern Munich Over/Under` | Full market string as displayed |
| **result** | String | `--` or `Home`/`Away`/`Draw` | Match outcome if settled |
| **resultMessage** | String (optional) | `1UP achieved! Enjoy your early success!` | Only on settled winners |

---

## Parsing Rules

### 1. Block Detection

- A new block starts when a line matches the pattern: a standalone integer (the index)
- The next line will always be the date/time in `DD/MM HH:MM` format
- Use regex: `^\d+$` followed by `^\d{2}/\d{2}\s+\d{2}:\d{2}$`

### 2. Status Detection

- `Not Started` → active, eligible for group generation
- `Check Live Tracker >` → live/settled (next line may have status label)
- `Won` → settled as won
- `Lost` → settled as lost
- `Void` → voided (match cancelled/postponed) — **automatically excluded from grouping**

### 3. Void Detection

- A selection with status `Void` is excluded
- Additionally, a line reading `This bet has been settled as void.` may appear after the Result block
- Void selections are parsed but flagged `isVoid: true`

### 3. Team Extraction

- After status line(s), the next non-empty line is **Home Team**
- The next non-empty line after that is **Away Team**

### 4. Score Extraction

- After away team, the next non-empty content before "Pick" is the score
- `--` = not started
- Two consecutive lines of digits = settled score (home first, away second)

### 5. Pick Extraction

- Line immediately after the literal `Pick` keyword
- Multiple formats supported:
  - **1X2 market**: `Home @1.20`, `Away @1.60`, `Draw @3.50`
  - **Over/Under market**: `Over 3.5 @2.65`, `Under 2.5 @1.45`
  - **Other markets** (future): capture full string before `@` as pick value
- Pattern: `(.+)\s+@(\d+\.\d+)`

### 6. Market Extraction

- Line immediately after the literal `Market` keyword
- Full string capture (e.g., `1X2 - 1UP`)

### 7. Result Extraction

- Line immediately after the literal `Result` keyword
- `--` = pending
- Otherwise, the result value (e.g., `Home`, `Away`)
- Optional: next non-empty line may contain a result message (informational, can be discarded or stored)

---

## Edge Cases

| Case | Handling |
|------|----------|
| Team names with special characters | `Borussia M´gladbach` — preserve as-is |
| Team names with location suffixes | `SE Palmeiras SP`, `CR Vasco da Gama RJ` — preserve full string |
| Year inference for dates | If paste spans Dec–Jan, earlier months = previous year. Otherwise assume current year. |
| Empty lines between sections | Treated as delimiters; skip during parsing |
| Settled matches in unsettled list | Parse fully but flag as `settled: true` — **automatically excluded** from group generation (non-negotiable rule) |
| "Check Live Tracker >" status | Treat as in-progress/settled; may still have result |
| Void selections | Parse fully, flag `isVoid: true` — **automatically excluded** from group generation |
| Running tickets with mixed states | Only "Not Started" selections are eligible for grouping |
| Combo markets (e.g., "Double Chance & Over/Under") | Treat as single market type `combo`; pick value may contain `&` |
| Bet ID format varies | Can be numeric or alphanumeric string (e.g., "260812153103bet07307303") |
| Game ID absent in settled view | `gameId` will be null — use teams + date as unique identifier fallback |
| "Selection Details" line | Header separator in running bet format — skip during parsing |
| **Context D: Not supported** | Detected and rejected — app prompts user to paste full detailed format |

---

## Regex Patterns (TypeScript)

```typescript
const PATTERNS = {
  // Header detection
  ticketHeader: /^Ticket Details \(ID:\s*(\d+)\)$/,
  betIdHeader: /^Bet ID:\s*(.+)$/,
  
  // Block start: standalone integer (Context A/B/C)
  blockStart: /^\d+$/,
  
  // Date/time: DD/MM HH:MM
  dateTime: /^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/,
  
  // Full date (in ticket header): DD/MM/YYYY HH:MM
  fullDateTime: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/,
  
  // Game ID
  gameId: /^Game ID:\s*(\d+)$/,
  
  // Status indicators
  statusNotStarted: /^Not Started$/,
  statusLive: /^Check Live Tracker\s*>?$/,
  statusWon: /^Won$/,
  statusLost: /^Lost$/,
  statusVoid: /^Void$/,
  statusRunning: /^Running$/,
  voidMessage: /^This bet has been settled as void\.$/,
  
  // Pick line (Context A/B/C): captures everything before @odds
  pick: /^(.+)\s+@(\d+\.\d+)$/,
  
  // Compact format (Context D) — DETECTED BUT NOT SUPPORTED
  // App will prompt user to paste full format instead
  compactPick: /^\s+(.+)$/,                          // Detection only
  compactMatch: /^(.+)\s+v\s+(.+)$/,                 // Detection only
  
  // Score: standalone "--" or digit
  scorePending: /^--$/,
  scoreDigit: /^\d+$/,
  
  // Ticket metadata (Context B - settled)
  totalStake: /^Total Stake\s*:\s*([\d,]+\.\d+)$/,
  totalOdds: /^Total Odds\s*:\s*([\d,]+\.\d+)$/,
  totalReturn: /^Total Return\s*:\s*([\d,]+\.\d+)$/,
  freeBetGift: /^Free Bet Gift\s*:\s*-?\s*([\d,]+\.\d+)$/,
  
  // Bet metadata (Context C - running)
  stake: /^Stake\s+([\d,]+\.\d+)$/,
  odds: /^Odds\s+([\d,]+\.\d+)$/,
  bonus: /^Bonus\s+([\d,]+\.\d+)$/,
  potWin: /^Pot\.\s*Win\s+([\d,]+\.\d+)$/,
};
```

---

## Output: Parsed Selection Object

```typescript
interface ParsedSelection {
  index: number;
  date: string;           // "DD/MM"
  time: string;           // "HH:MM"
  kickOffDateTime: Date;  // Full datetime (year inferred)
  gameId: string | null;  // null in settled ticket context
  homeTeam: string;
  awayTeam: string;
  status: "not_started" | "live" | "won" | "lost" | "void";
  score: { home: number; away: number } | null;
  pick: string;           // Full pick value: "Home", "Over 3.5", "Draw or Away", "0-4", "Yes", "Away (0:2)", "Home/Away & Under 4.5"
  pickCategory: PickCategory;
  odds: number;
  market: string;         // Full market string as displayed
  marketType: MarketType; // Normalized market category
  marketVariant: string | null;  // e.g., "1UP", "2UP", "Early Goals", or null
  marketHalf: "full" | "1st" | "2nd" | null;  // Which half the market applies to
  result: string | null;  // null if pending
  resultMessage: string | null;
  isSettled: boolean;
  isVoid: boolean;
  isSuspended: boolean;       // Odds were suspended at time of paste
  isWon: boolean | null;      // null if not settled
  isEligibleForGrouping: boolean;  // true only if not_started AND not void AND not suspended
}

type PickCategory = 
  | "home"           // "Home"
  | "away"           // "Away"
  | "draw"           // "Draw"
  | "home_or_draw"   // "Home or Draw"
  | "draw_or_away"   // "Draw or Away"
  | "home_or_away"   // "Home or Away" (in combo: "Home/Away & Under 4.5")
  | "over"           // "Over X.X"
  | "under"          // "Under X.X"
  | "yes"            // "Yes" (GG/NG, special markets)
  | "no"             // "No"
  | "goal_range"     // "0-4", "1-3" etc.
  | "handicap"       // "Home (0:2)", "Away (0:1)"
  | "combo"          // Combined picks like "Home/Away & Under 4.5"
  | "other";         // Catch-all for unrecognized

type MarketType =
  | "1x2"                    // Match result
  | "over_under"             // Total goals over/under
  | "over_under_team"        // Team-specific over/under (e.g., "Bayern Munich Over/Under")
  | "double_chance"          // Double Chance
  | "gg_ng"                  // Both Teams to Score
  | "handicap"              // Handicap (Asian/European)
  | "goal_bounds"           // Goal range bands (0-4, 1-3)
  | "correct_score"         // Correct score
  | "combo"                 // Combined market (Double Chance & Over/Under)
  | "special"               // Special markets (Any Team To Score 2+ in a Row, etc.)
  | "other";                // Catch-all

interface ParsedTicket {
  ticketId: string | null;       // null if pasted from open betlist
  datePlaced: Date | null;
  device: string | null;
  betType: string | null;        // "Multiple", "Single"
  overallResult: string | null;  // "Won", "Lost", "Running", "Pending"
  totalStake: number | null;
  totalOdds: number | null;
  totalReturn: number | null;    // null if running
  bonus: number | null;
  potentialWin: number | null;
  freeBetGift: number | null;
  selections: ParsedSelection[];
  activeSelections: ParsedSelection[];  // Only "not_started" — used for group generation
}
```

---

## Sample Parse Output (Selection #1)

```json
{
  "index": 1,
  "date": "23/08",
  "time": "11:45",
  "kickOffDateTime": "2026-08-23T11:45:00",
  "gameId": "40246",
  "homeTeam": "PSG",
  "awayTeam": "Rennes",
  "status": "not_started",
  "score": null,
  "pick": "Home",
  "odds": 1.20,
  "market": "1X2 - 1UP",
  "marketVariant": "1UP",
  "result": null,
  "resultMessage": null,
  "isSettled": false,
  "isWon": null
}
```

---

## Notes for Multi-Provider Support

This parser is specific to SportyBet. The adapter architecture should:

1. Auto-detect provider from paste format (each has unique markers)
2. Route to the correct parser
3. Output the same normalized `ParsedSelection` interface regardless of source

Future adapters (Bet9ja, 1xBet, BetKing) will have their own spec documents following this same structure.

---

*Version: 1.0*
*Based on: 50-selection sample paste provided August 2026*
