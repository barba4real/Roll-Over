# Roll-Over — Sports Evidence & Probability Engine

## Design Philosophy

> Don't build a bigger score calculator.
> Build a Sports Evidence & Probability Engine.

The model should NOT ask "Who looks likely to win?"
It should ask "What evidence supports each possible outcome, how strong is that evidence, how independent is it, and under what conditions would the prediction fail?"

---

## Architecture: Modular Evidence Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                        MATCH INPUT                                │
│              Teams / League / Venue / Date / Context              │
└─────────────────────────────┬────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────────┐
         │                    │                        │
         ▼                    ▼                        ▼
   TEAM ANALYSIS         MATCH CONTEXT           EVIDENCE QUALITY
         │                    │                        │
   ┌─────┴─────┐        ┌────┴────────┐          ┌───┴────────┐
   │           │        │             │          │            │
  HOME       AWAY      League       Schedule    Data         Provider
  Module     Module    Strength     Congestion  Freshness    Agreement
   │           │        │             │          │            │
   └─────┬─────┘        └──────┬──────┘          └─────┬──────┘
         │                     │                        │
         └─────────────────────┼────────────────────────┘
                               ▼
                      PROBABILITY ENGINE
                               │
               ┌───────────────┼───────────────┐
               │               │               │
          OUTCOME         GOALS MODEL      MARKET-SPECIFIC
          PROBS           (Expected Goals)  PROBABILITIES
               │               │               │
               └───────────────┼───────────────┘
                               ▼
                      CALIBRATION LAYER
                               │
               ┌───────────────┼───────────────┐
               │               │               │
          CONTRADICTION    SCENARIO         CONFIDENCE
          DETECTOR         ANALYSIS         ASSESSMENT
               │               │               │
               └───────────────┼───────────────┘
                               ▼
                      FINAL ANALYSIS CARD
                               │
                               ▼
                      SLIP / PORTFOLIO ENGINE
```

---

## Layer 1: Basic Match Identity

### What we have now:
- Home team, away team, league, kickoff (from ESPN/TheSportsDB)
- Team alias resolution (350+ teams)
- League registry (47 leagues)

### What we need:
- **Venue tracking** (home/away/neutral)
- **Match importance** (title race, relegation battle, dead rubber, cup knockout)
- **Data quality score** per fixture (provider agreement %, freshness)
- **Season context** (round number, early/mid/late season)

---

## Layer 2: H2H Analysis (Enhanced)

### What we have now:
- Last 10 H2H meetings (from local DB)
- Basic record (W/D/L, goals)

### What we need:
- **Venue-specific H2H** (at this ground vs overall)
- **Recency weighting** (exponential decay: last 2 years 100%, 4+ years 35%)
- **Competition filter** (league H2H vs cup H2H vs all)
- **Tactical relevance check** — flag if managers/squads have changed significantly
- **H2H goal patterns** (BTTS%, Over rates specifically in H2H, not league average)

---

## Layer 3: Home/Away Performance (Separate Modules)

### What we have now:
- Last 20 home/away matches with form stats
- Win rate, goals avg, clean sheet %, BTTS%, O1.5/O2.5 rates

### What we need:
- **First half vs Second half scoring** (early goals vs late goals tendency)
- **Goal timing distribution** (0-15, 16-30, 31-45, 46-60, 61-75, 76-90)
- **Winning margin analysis** (scrappy 1-0 wins vs dominant 3-0)
- **Home strength rating** vs **Away weakness rating** (separate independent scores)
- **Trend detection** (last 5 vs previous 5 — is form improving or declining?)

---

## Layer 4: Team Strength Model

### What we have now:
- Form-based win rate
- Position gap from standings

### What we need:
- **Composite strength score** per team:
  - Attack strength (goals scored rate, shooting efficiency)
  - Defensive strength (goals conceded rate, clean sheet rate)
  - Home performance rating
  - Away performance rating
  - Recent form momentum
  - League position points
- **Attack vs Defense Matchup**: How does Team A's attack interact with Team B's defense?

---

## Layer 5: Goals Model

### What we have now:
- Average goals scored/conceded
- Over 1.5/2.5 rates from historical data

### What we need:
- **Expected goals per team** in this specific fixture:
  - Home team expected goals = f(home attack, away defense, league average, H2H)
  - Away team expected goals = f(away attack, home defense, league average, H2H)
  - Expected total = home + away
- **Derive ALL goal markets** from expected totals:
  - Over 0.5, 1.5, 2.5, 3.5
  - Home over 0.5, 1.5
  - Away over 0.5
  - BTTS probability

---

## Layer 6: League Context

### What we have now:
- League-specific baselines (30+ leagues with home/draw/away %)
- Average goals per league

### What we need:
- **Full league profile** per competition:
  - Average goals, BTTS%, O2.5%, clean sheet frequency
  - First-half goal frequency
  - Home advantage strength
  - Average corners, cards
- **League adjustment factor** — raw team probability adjusted for league environment
- **Cross-league awareness** — team in UCL shouldn't use only domestic stats

---

## Layer 7: Match Context

### What we have now:
- Basic league/cup classification

### What we need:
- **Match importance classifier**:
  - Title race / Relegation battle / Mid-table / Dead rubber
  - Cup round (group, knockout, final)
  - Promotion/relegation at stake
- **Schedule congestion**:
  - Matches in last 7/14 days
  - European midweek fixture before domestic weekend
  - Fatigue/rotation risk
- **Season timing**:
  - Early season (first 5 rounds) — less reliable data
  - Mid-season — normal
  - Late season — motivation varies wildly

---

## Layer 8: Market-Specific Models

### What we have now:
- One prediction that outputs Home/Draw/Away/O1.5/O2.5/BTTS all from same formula

### What we need:
- **Independent models per market**:
  - 1X2 model (uses form, H2H, strength, league context)
  - Goals model (uses scoring rates, defensive weaknesses, league avg)
  - BTTS model (uses scoring frequency, clean sheet rates, H2H BTTS)
  - Each market has its own confidence that doesn't contaminate others

---

## Layer 9: Team-Specific Market Tendencies

### What we have now:
- Global rates (BTTS%, O1.5%, O2.5%) per team

### What we need:
- **Home-specific vs Away-specific** market tendencies:
  ```
  Arsenal HOME: O1.5 94%, O2.5 71%, BTTS 48%, CS 63%
  Arsenal AWAY: O1.5 82%, O2.5 57%, BTTS 58%, CS 39%
  ```
- This means "Arsenal home Over 1.5" is a DIFFERENT confidence than "Arsenal away Over 1.5"

---

## Layer 10: Contradiction Detector

### What we have now:
- Consensus engine flags "disagreement" between providers

### What we need:
- **Internal contradiction detection**:
  - H2H says Home → but home team's form is terrible
  - Stats say Over 2.5 → but away team's last 5 games are all Under
  - League says home advantage → but this home team loses at home frequently
- **Show contradictions explicitly** rather than averaging them away
- **Prediction stability score** (how much would the prediction change if one factor shifted?)

---

## Layer 11: Confidence vs Probability vs Data Quality

### What we have now:
- Single "confidence %" that blends everything

### What we need — THREE separate metrics:

| Metric | Meaning |
|--------|---------|
| **Data Confidence** | How trustworthy/complete is the underlying data? (provider agreement, freshness, sample size) |
| **Model Probability** | What probability does the model estimate for this outcome? |
| **Evidence Convergence** | How strongly do independent evidence sources agree? |

Example output:
```
Data Confidence:        96%  (6 providers agree, data is 2h fresh)
Model Probability:      73%  (based on form + H2H + league context)
Evidence Convergence:   88%  (no major contradictions)
```

---

## Layer 12: Promoted/Relegated Team Handling

### What we have now:
- Nothing specific

### What we need:
- Detect teams new to a league (no historical data in this division)
- Pull data from their PREVIOUS league
- Apply a "league jump" adjustment (promoted teams typically underperform vs established teams)
- Flag clearly in the UI: "This team was promoted from Serie B"

---

## Layer 13: Scenario Analysis

### What we have now:
- Single point prediction

### What we need:
- **Base scenario**: normal conditions
- **Conservative scenario**: what if key player missing, fatigue, rotation?
- **Optimistic scenario**: full strength, high motivation, home crowd

Output:
```
Home Win:
  Base:         71%
  Conservative: 64%
  Optimistic:   78%
  Range:        64–78%
```

This is more honest than pretending the model knows exactly 71%.

---

## Layer 14: Failure Analysis (Learning Loop)

### What we have now:
- Prediction tracking + hit rates

### What we need:
- **Classify WHY predictions fail**:
  - Red card / injury during match (unforeseeable)
  - Bad form estimate (model error)
  - League anomaly (unusual league behavior)
  - Low data quality (shouldn't have predicted)
  - Random variance (correct process, unlucky result)
- **Feed failures back** into model calibration:
  - "We systematically overestimate home teams after European midweek"
  - "Our BTTS predictions are 5% too high in Italian Serie A"

---

## Layer 15: Final Analysis Card (Target Output)

```
══════════════════════════════════════════════════════════════
              ARSENAL vs FULHAM
              Premier League | Matchday 3
══════════════════════════════════════════════════════════════

DATA
Provider agreement             6/6
Data freshness                 97%
Data confidence                95%

TEAM STRENGTH
Arsenal                        91/100
Fulham                         72/100
Strength gap                   +19 (Home advantage: STRONG)

HOME vs AWAY
Arsenal home win rate          78% (last 20 home)
Fulham away win rate           19% (last 20 away)

FORM (with trend)
Arsenal     WWWDW  (89/100, trending ↑)
Fulham      LDWDL  (47/100, trending ↓)

H2H (filtered: league only, last 5 years)
Recent H2H                     Arsenal 5W, 1D, 0L
Home H2H                       Arsenal 4W, 0D, 0L
H2H goals avg                  3.2 per match
H2H BTTS                       33%

GOALS MODEL
Expected Arsenal goals         2.18
Expected Fulham goals          0.79
Expected total                 2.97

PROBABILITIES
Home win                       73%
Draw                           17%
Away win                       10%
Over 1.5                       84%
Over 2.5                       65%
BTTS                           48%
Arsenal O1.5                   69%

CONTEXT
Season position                Early (Matchday 3)
Schedule congestion            LOW
Match importance               MEDIUM (league match)
Promoted/Relegated             No

CONTRADICTIONS
⚠ Fulham away xG improving (but sample size only 3 matches)

SCENARIO RANGE
Home win: 64% (conservative) → 78% (optimistic)

CALIBRATION
73% predictions historically → actual success: 71% (n=347)

─────────────────────────────────────────
DATA CONFIDENCE                95%
MODEL PROBABILITY              73%
EVIDENCE CONVERGENCE           88%
─────────────────────────────────────────

VERDICT: ★★★★☆ STRONG CANDIDATE
══════════════════════════════════════════════════════════════
```

---

## Implementation Priority

| Phase | What | Effort |
|-------|------|--------|
| **Phase A** | DB auto-update (results auto-save, background growth) | Medium |
| **Phase B** | Goals model (expected goals per team per fixture) | Medium |
| **Phase C** | Independent market models (1X2, Goals, BTTS as separate engines) | High |
| **Phase D** | Enhanced Analysis Card (side-by-side, venue H2H, trends) | High |
| **Phase E** | Contradiction detector + scenario ranges | Medium |
| **Phase F** | Team strength composite + attack vs defense matchup | Medium |
| **Phase G** | Match context (importance, congestion, season timing) | Medium |
| **Phase H** | Three-metric display (data confidence, probability, convergence) | Low |
| **Phase I** | Failure classification + learning loop | High |
| **Phase J** | Promoted/relegated detection + league-jump adjustment | Medium |

---

## What We're NOT Building (Per User Request)

- Odds comparison / value detection
- Market movement tracking
- Bookmaker-specific analysis
- Betting bankroll management (beyond the existing chain system)
- Live in-play betting features

---

## Key Principle: Modularity

> Don't put 30 factors into one giant weighted formula.
> Build independent analytical modules, let them produce evidence/probabilities,
> then have a higher-level ensemble/calibration layer combine them.

Each module should:
1. Run independently
2. Produce a clear output (probability or evidence score)
3. Report its own confidence/reliability
4. Be testable in isolation
5. Feed into the ensemble layer without knowing about other modules
