# Roll-Over: Future Improvements & Enhancement Ideas

## Status: Saved for later implementation after real usage data is collected

---

## Phase 3: System Integration (After 1-2 weeks of use)

### 1. System Tray & Notifications
- App minimizes to Windows system tray instead of closing
- Tray icon always accessible with one click
- Windows toast notifications when:
  - A staked match kicks off ("Bayern v Freiburg — STARTED")
  - A staked match finishes ("✓ Bayern won 2-0" or "✗ Lost")
  - All matches in a slip are settled
  - A chain advances or breaks
- Tray context menu: "Open", "Active slips (3)", "Quick status", "Quit"

### 2. Auto Result-Checking
- Background polling of Football-Data.org every 30 minutes
- Automatically detect when staked matches have finished
- Auto-settle slips without manual input (won/lost)
- Auto-advance/break linked chains
- Show "Auto-settled" badge on automatically resolved slips
- Fallback: manual input still available if API misses a result

### 3. Odds Movement Alert
- When a pick is added to selections, record the odds at that time
- Periodically check if odds have shifted significantly (±10%)
- Alert: "Bayern v Freiburg odds moved from 1.30 to 1.45 — market uncertainty increasing"
- Or: "Odds shortened from 1.35 to 1.20 — market agrees with your pick"

### 4. Multi-Chain Visualization
- Simple step-line graph showing chain progression over time
- X-axis: days, Y-axis: chain value
- Each chain as a separate colored line
- Clearly shows when chains break and restart
- Longest surviving chain highlighted

### 5. Weekly Summary Report
- Auto-generated every Sunday (or configurable day)
- Shows: total slips that week, won/lost, win rate
- Best performing market type
- Best performing league
- Best performing day of week
- Longest chain that week
- Comparison to previous week

---

## Phase 4: Intelligence Improvements (After data proves patterns)

### 6. Correlation Detector
- After 50+ settled picks, analyze failure patterns
- Identify: "Serie A 1X2 picks fail 40% — consider avoiding"
- Identify: "Monday fixtures have 30% lower win rate for you"
- Surface these as warnings when building slips with risky patterns

### 7. Adaptive Confidence Threshold
- Instead of fixed 65% minimum confidence, make it dynamic
- If your actual hit rate at 65% confidence is only 50%, raise the threshold
- If 60% confidence picks win 70% of the time, lower it
- Self-calibrating system based on YOUR results, not theory

### 8. Slip Diversification Score
- Warn if generated slips all depend on:
  - Same league (one bad day = all slips fail)
  - Same time slot (correlated outcomes)
  - Same market type (systematic bias)
- Score: 0-100 where 100 = perfectly diversified

---

## Phase 5: Advanced Features (Long-term)

### 9. Bet9ja Parser
- Add parser for Bet9ja paste format
- Support their event code system for quick match loading
- shop.bet9ja.com integration for match lookup

### 10. League Deep-Dive Mode
- For a single league, show all upcoming matchweek fixtures
- Color-coded by home advantage strength
- Sortable table: position, form, H2H, goals stats
- One-click add multiple picks from same league

### 11. "What-If" Simulator
- After generating slips, simulate: "If pick X loses, how many slips survive?"
- Show vulnerability: "Pick 3 (Bayern) appears in 60% of your slips — single point of failure"
- Help distribute risk before staking

### 12. Bankroll Tracker
- Track actual money: deposits, withdrawals, current balance
- Show real monetary P&L (not just win/loss count)
- ROI calculation: "Invested ₦3,000 total, returned ₦7,200 = +140% ROI"
- Monthly breakdown

### 13. Form Streak Detection
- Flag teams on hot streaks (5+ wins) — momentum plays
- Flag teams on cold streaks (3+ losses) — avoid regardless of stats
- "Bayern won last 8 home games" vs "Everton lost last 4 at home"

### 14. Derby/Rivalry Database
- Maintain a list of known derbies and rivalries
- Auto-flag when a match is a derby: "⚠ Manchester Derby — form stats unreliable"
- Skip these in scout/search results by default

### 15. Season Context Awareness
- Early season (matchday 1-5): Flag as "insufficient data"
- End of season: Flag teams with nothing to play for (mid-table, safe from relegation)
- Flag relegation battles (desperate teams = unpredictable)
- Flag title deciders (high stakes = unpredictable)

---

## Implementation Priority (After Usage Data)

| Priority | Feature | Trigger to implement |
|----------|---------|---------------------|
| HIGH | #2 Auto Result-Checking | After manually settling 20+ slips gets tedious |
| HIGH | #1 System Tray | After finding you forget to check results |
| HIGH | #7 Adaptive Confidence | After 50+ picks show confidence ≠ actual hit rate |
| MEDIUM | #5 Weekly Summary | After 2+ weeks of consistent use |
| MEDIUM | #6 Correlation Detector | After 50+ settled picks |
| MEDIUM | #12 Bankroll Tracker | When chains start producing real profit |
| LOW | #4 Chain Visualization | Nice to have, not critical |
| LOW | #3 Odds Movement | Only if odds shifting causes losses |
| LOW | #8 Diversification | Only if correlated failures are a problem |
| FUTURE | #9-15 | Build as needed based on experience |

---

## Decision Criteria

Before implementing any feature, ask:
1. Does my usage data show this is actually needed?
2. Will this directly improve win rate or discipline?
3. Is this solving a real problem I've experienced, or a theoretical one?

If the answer to any is "no" — skip it.

---

*Document Version: 1.0*
*Created: August 2026*
*Review after: 2 weeks of daily use*


---

## NEXT SESSION: API Provider Fixes (Priority)

### Priority 1: TheSportsDB (No key needed, truly free)
- URL: `https://www.thesportsdb.com/api/v1/json/3/`
- Endpoints: `eventsnextleague.php?id=LEAGUE_ID`, `eventspastleague.php?id=LEAGUE_ID`
- League IDs: 4328 (EPL), 4335 (La Liga), 4332 (Serie A), 4331 (Bundesliga), 4334 (Ligue 1)
- No rate limit issues, fast responses
- No API key required (test key "3" works for free)
- Add as PRIMARY default provider

### Priority 2: ESPN Unofficial API (No key needed)
- URL: `https://site.api.espn.com/apis/site/v2/sports/soccer/`
- Leagues: `eng.1` (EPL), `esp.1` (La Liga), `ger.1` (Bundesliga), `ita.1` (Serie A), `fra.1` (Ligue 1)
- Endpoint: `/{league}/scoreboard` for fixtures
- No key, no rate limit, fast, reliable
- Undocumented but widely used and stable

### Priority 3: Fix API-Football
- Key already supported in app
- Needs correct endpoint URL debugging
- Host: v3.football.api-sports.io

### Priority 4: Fix Odds-API.io
- Was hanging/timing out — incorrect endpoint URL
- Correct URL from docs: `https://api.odds-api.io/v3/events?apiKey=KEY&sport=football`
- Need to verify with actual key

### Current Working:
- Football-Data.org ✓ (Premier League confirmed, rate limited to 10 req/min)


---

## Phase 3: Statistical Intelligence (Inspired by FootyStats)

### Goal
Transform Search from "show fixtures" to "show fixtures with statistical confidence" — filter by actual percentages, not just team names.

### Features to Build

#### HIGH Priority

1. **Over 2.5% Display**
   - Calculate from team's last 10 home/away matches
   - Show in Search results: "O2.5: 73%"
   - Filter: "Only show matches where combined O2.5% > 65%"
   - Source: TheSportsDB past events or Football-Data.org finished matches

2. **BTTS% (Both Teams Score)**
   - Calculate: % of matches where both teams scored
   - Home BTTS% + Away BTTS% = Match BTTS likelihood
   - Filter: "Only show matches where BTTS% > 60%"

3. **Clean Sheet%**
   - Per team: how often they keep clean sheet at home/away
   - Useful for "Home Win to nil" or "Under" bets

4. **Form String (Last 5)**
   - Display: "WWDLW" next to each team in Search
   - Color coded: green W, gray D, red L
   - Instant visual confidence

5. **Stats-Based Search Filters**
   - Replace generic "Strong Home Teams" with:
     - "Home Win% > X%"
     - "Over 2.5% > X%"  
     - "BTTS% > X%"
     - "Clean Sheet% > X%"
   - User sets the threshold slider

#### MEDIUM Priority

6. **H2H Summary**
   - When match is expanded: "Last 5 H2H: Home won 3, Draw 1, Away won 1"
   - Average goals in H2H
   - Source: TheSportsDB or Football-Data.org

7. **Corner Averages**
   - Per team: AVG corners won home/away
   - For corner market bets (Over 8.5 corners etc.)

8. **Card Averages**  
   - Per team: AVG cards received home/away
   - For card market bets

9. **Goals Scored/Conceded Averages**
   - Per team split by home/away
   - AVG Scored: 2.1 | AVG Conceded: 0.8
   - Key for Over/Under and team-specific markets

#### LOW Priority

10. **FTS% (First Team to Score)**
    - Which team scores first more often
    - Useful for "first goal" markets

11. **xG Integration**
    - If available from API: expected goals per team
    - Shows "true" scoring probability vs actual results

12. **Win Streak / Loss Streak Detection**
    - Flag teams on 4+ win streak (confidence boost)
    - Flag teams on 3+ loss streak (avoid or back opponent)

### Data Sources for Stats
- **TheSportsDB**: `eventspastleague.php` returns last 15 results — calculate stats from these
- **Football-Data.org**: `getTeamMatches()` returns last N finished matches — calculate from scores
- **ESPN**: Historical scoreboard data
- **Self-calculated**: Store results in localStorage cache, recalculate daily

### Implementation Approach
1. Create a `stats-calculator.ts` module
2. Fetch last 10-15 finished matches per team
3. Calculate: Win%, Over2.5%, BTTS%, CS%, AVG Goals, Form
4. Cache results in localStorage (expire after 24 hours)
5. Display in Search results table as additional columns
6. Add filter sliders to Search UI

### UI Mockup (Search Results with Stats)
```
# | Match              | Date  | League  | H.Win% | O2.5% | BTTS% | Form(H) | Form(A) | Gap | Pick
1 | Man City v Wolves  | 23/08 | PL      | 85%    | 78%   | 55%   | WWWWW   | LLWLD   | +14 | Home
2 | Bayern v Freiburg  | 24/08 | BL      | 90%    | 82%   | 48%   | WWWDW   | LDWLL   | +12 | Home
3 | Inter v Lecce      | 23/08 | SA      | 75%    | 71%   | 62%   | WWDWW   | LLDWL   | +11 | O2.5
```


---

## NEXT SESSION: Confirmed Priorities

### 1. Lock/Save Search Results
- When user finds matches they like, "Lock" button pins them
- Locked matches stay visible even when new search is run
- Locked list acts as a curated shortlist across providers
- Can unlock/remove individual matches
- "Add all locked to Selections" button

### 2. Stats in Search (Phase 3 stats)
- Over 2.5%, BTTS%, Home Win%, Form per match
- Calculate from TheSportsDB past events
- Football-Data.org already shows position gap — add more stats columns

### 3. Filter by Stats Thresholds
- Sliders: Over 2.5% > X, Home Win% > X, BTTS% > X

### 4. H2H Quick View
- Expand match → show head-to-head history

### 5. Kick-off Tracker for Active Slips
- Poll APIs for live/finished match results
- Show status: Not Started / In Play / Finished
- Auto-suggest won/lost based on actual results

### API Provider Status (Confirmed August 2026)
- Football-Data.org: ✅ WORKS BEST — multiple leagues, position gap, key required
- TheSportsDB: ✅ Works — 9 matches, no key, fast but limited data
- ESPN: ❌ No results — endpoint may be wrong or not returning data
- API-Football: ❌ Removed — 100 req/day too limiting
- Odds-API.io: ❌ Removed — endpoint issues, hangs
