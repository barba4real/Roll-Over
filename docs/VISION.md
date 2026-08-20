# Roll-Over — Product Vision & Philosophy

## Document Version: 2.0 | August 2026

---

## What Roll-Over IS

Roll-Over is a **personal income generation intelligence system** that uses sports data to systematically compound small stakes into meaningful returns through disciplined 3-odds accumulation.

It is NOT a betting app. It does not place bets. It does not connect to bookmakers. It does not encourage gambling.

**What it actually is:**
- A research engine that aggregates 8+ data sources into actionable confidence scores
- A decision support system that eliminates bad picks before they happen
- A compounding tracker that manages parallel rollover chains
- A learning system that gets measurably better with use
- A discipline enforcer that prevents emotional decisions

**Built by one developer. For that developer. Not for sale.**

---

## Core Philosophy

### The Mantra

> "I'm not gambling. I'm compounding. The data decides. I execute with discipline."

### Principles

1. **Compounding, not gambling** — Each slip is one step in a multiplication chain. The goal is sustained exponential growth from a tiny seed, not one-off wins.

2. **Data decides, human executes** — The system scores, filters, and recommends. The human only needs to follow the system's recommendations and stake with discipline.

3. **Eliminate before you stake** — Every feature exists to remove bad picks before they cost money. The system is defensive by design.

4. **One bad pick kills the chain** — In an accumulator, one loss = total loss. This reality drives every architectural decision. Fewer picks at higher individual confidence beats more picks at lower confidence.

5. **Discipline is the edge** — The math only works if you follow the rules consistently. No chasing losses. No "gut feeling" overrides. No emotional stakes.

6. **Measure everything** — If it can't be tracked, it can't be improved. Every pick, every outcome, every pattern gets recorded and analyzed.

---

## Why 3-Odds Accumulation

### The Math

3 odds is the compounding sweet spot. Here's why:

| Metric | 2-Odds Strategy | 3-Odds Strategy | 5-Odds Strategy |
|--------|----------------|----------------|----------------|
| Steps to ₦200K from ₦100 | 11 steps | 7 steps | 5 steps |
| Picks per slip | 1-2 picks | 2-3 picks | 3-5 picks |
| Individual pick odds | 1.8-2.0 | 1.4-1.8 | 1.3-1.7 |
| Slip win probability* | ~55% | ~50% | ~35% |
| Expected chain length | 2.2 steps | 2.0 steps | 1.5 steps |

*With base intelligence. The system's job is to push these probabilities higher.*

### Why Not 2-Odds?
- Too many steps (11 to reach ₦200K)
- Growth feels painfully slow
- Still requires discipline for 11 consecutive wins

### Why Not 5-Odds?
- Too many picks per slip (more failure points)
- Slip probability drops below 40% even with good picks
- Chains break faster — frustrating and unprofitable

### Why 3-Odds is Optimal
- Only 7 steps to reach ₦218,700 from ₦100
- Achievable with just 2-3 safe picks (odds 1.4-1.8 each)
- Individual pick odds stay in the empirically safest zone
- Balance between speed and survivability
- Each step is meaningful growth (3x)

### Example Combinations That Hit 3 Odds

| Picks | Individual Odds | Combined |
|-------|----------------|----------|
| 2 picks | 1.70 × 1.76 | = 2.99 |
| 2 picks | 1.80 × 1.67 | = 3.01 |
| 3 picks | 1.45 × 1.45 × 1.43 | = 3.01 |
| 2 picks | 1.50 + 1 pick at 1.35 | = 3.04 |
| 3 picks | 1.40 × 1.40 × 1.53 | = 3.00 |

### The Progression Table: ₦100 → ₦218,700

| Step | Stake (₦) | Return at 3x (₦) | Cumulative Growth |
|------|-----------|-------------------|-------------------|
| 1 | 100 | 300 | 3x |
| 2 | 300 | 900 | 9x |
| 3 | 900 | 2,700 | 27x |
| 4 | 2,700 | 8,100 | 81x |
| 5 | 8,100 | 24,300 | 243x |
| 6 | 24,300 | 72,900 | 729x |
| 7 | 72,900 | 218,700 | 2,187x |

**₦100 becomes ₦218,700 in 7 successful steps.**

### Probability Analysis

If individual pick win probability = 75% (no intelligence):
- 2-pick slip: 0.75 × 0.75 = 56.3% win rate
- 3-pick slip: 0.75³ = 42.2% win rate

If the intelligence system pushes individual pick probability to 85%:
- 2-pick slip: 0.85 × 0.85 = 72.3% win rate
- 3-pick slip: 0.85³ = 61.4% win rate

**That 10% improvement per pick translates to 16% improvement per slip.** This is why the intelligence system exists — small improvements in pick confidence compound into dramatically better chain survival.

Expected chain length at 72% slip rate: 3.57 steps (average return: 45.6x the seed)
Expected chain length at 61% slip rate: 2.56 steps (average return: 16.8x the seed)

The system targets 2-pick slips with 85%+ individual confidence as the default.

---

## The 5-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    LAYER 5: LEARNING & ADAPTATION                │
│  Pattern Detection → Self-Calibration → Progressive Thresholds  │
├─────────────────────────────────────────────────────────────────┤
│                    LAYER 4: EXECUTION & TRACKING                 │
│  Paste/Import → Generate → Stake → Track → Settle → Compound   │
├─────────────────────────────────────────────────────────────────┤
│                    LAYER 3: DECISION SUPPORT                     │
│  Suggest Best → Pre-Stake Check → Never Bet → Simulator         │
├─────────────────────────────────────────────────────────────────┤
│                    LAYER 2: ANALYSIS & SCORING                   │
│  Confidence Score → Multi-Factor → Correlation → Momentum       │
├─────────────────────────────────────────────────────────────────┤
│                    LAYER 1: DATA COLLECTION                      │
│  8+ API Providers → Cross-Reference → Cache → Rate Limit        │
└─────────────────────────────────────────────────────────────────┘
```

### Layer 1: Data Collection

**Purpose:** Gather comprehensive, real-time sports data from multiple sources to eliminate single points of failure.

| Feature | Description |
|---------|-------------|
| Multi-provider architecture | 8+ API providers, each specializing in different data types |
| Fixture aggregation | Upcoming matches across all major European leagues |
| Standing/position data | Current league positions for gap analysis |
| Historical results | Past match results for form and statistics calculation |
| Head-to-head records | Direct meeting history between two teams |
| Live results | Real-time scores for tracking active slips |
| Weather data (future) | Match-day weather affecting outdoor play |
| Referee data (future) | Referee tendencies (cards, penalties awarded) |
| Cross-referencing | Multiple providers validate the same data point |
| Caching | Results cached 12-24h to minimize API calls |
| Rate limiting | Respect provider limits, queue requests intelligently |
| Rust HTTP backend | All API calls go through Tauri's Rust backend to avoid CORS/truncation |

### Layer 2: Analysis & Scoring

**Purpose:** Transform raw data into actionable confidence scores per pick.

| Feature | Description |
|---------|-------------|
| Confidence scoring (0-100) | Multi-factor score per pick based on all available data |
| Form analysis | Last 5-10 match results, weighted by recency |
| Position gap analysis | League position difference (larger gap = higher confidence in favorite) |
| Home/away performance split | Team stats separated by venue |
| Over 2.5% calculation | Historical percentage of high-scoring matches |
| BTTS% calculation | Both Teams to Score historical rate |
| Clean sheet% | How often each team keeps a clean sheet |
| H2H dominance | Historical head-to-head record between the two teams |
| Momentum/form velocity | Direction of performance (improving/declining), not just current state |
| Market correlation (future) | Discover which stat combinations predict which markets best |
| Time-of-day patterns (future) | Performance differences by kick-off time |
| Fixture congestion (future) | Teams playing 3 games in 7 days = fatigue risk |

### Layer 3: Decision Support

**Purpose:** Help the user make the final decision with maximum information and minimum bias.

| Feature | Description |
|---------|-------------|
| "Suggest Best Slip" | One-click auto-build from highest-confidence picks targeting desired odds |
| Multi-tier generation | Simultaneously generate slips at 2/3/5 odds for different chain steps |
| Pre-stake checklist | Safety verification before committing real money |
| Slip survival simulator (future) | "If pick X loses, how many slips survive?" vulnerability analysis |
| "Never Bet" database (future) | Hard blocks on known-loss patterns |
| Exclude past losers | Flag picks that have historically failed for this user |
| Diversification warnings | Alert if all slips depend on same league/time/market |
| Confidence threshold | Minimum score required — rises with chain step (higher stakes = stricter) |

### Layer 4: Execution & Tracking

**Purpose:** Seamless workflow from decision to result with full traceability.

| Feature | Description |
|---------|-------------|
| SportyBet parser | Paste directly from SportyBet bet list (Context A/B/C) |
| Combinatorial slip generation | All valid combinations within odds range and constraints |
| Mark as staked | Move from generated to active with chain linking |
| Per-match result tracking | Mark each selection independently (✓/✗) |
| Auto-settlement | One match lost = entire slip auto-lost |
| Kick-off countdown | Time until each match starts |
| Live result polling (future) | Auto-detect results from API providers |
| Chain management | Parallel chains, advance/break/restart |
| Duplicate prevention | Same match cannot appear in multiple active slips |
| Daily limit enforcement | Configurable maximum slips per day |
| Copy to clipboard | Quick export for staking on bookmaker site |

### Layer 5: Learning & Adaptation

**Purpose:** The system gets measurably better with use by learning from your personal results.

| Feature | Description |
|---------|-------------|
| Accuracy by market type | Which markets do YOU personally win most? |
| Accuracy by odds range | Which odds ranges perform best for you? |
| Accuracy by league | Which leagues are most predictable for your style? |
| Win streak tracking | Current streak and historical best |
| Pattern detection (future) | "You always lose X type picks on Mondays" |
| Self-calibrating confidence (future) | If 65% confidence picks only win 50%, raise threshold |
| Progressive thresholds (future) | Chain step 5+ = require 80%+ confidence |
| Export/import | Full data backup for continuity across sessions |

---

## The Complete Daily Workflow

```
┌──────────────────────────────────────────────────────────────┐
│                    DAILY WORKFLOW (~15 min)                    │
│                                                              │
│  1. SEARCH   → Find today's fixtures (multiple providers)    │
│  2. SCORE    → Auto-confidence scoring per match             │
│  3. LOCK     → Pin best matches to curated shortlist         │
│  4. FILTER   → By market, date, confidence threshold         │
│  5. GENERATE → Multi-tier slips (2/3/5 odds)                 │
│  6. SUGGEST  → "Build Safest Slip" for fast mode             │
│  7. CHECKLIST→ Pre-stake safety verification                 │
│  8. STAKE    → Mark staked, link to chain                    │
│  9. TRACK    → Kick-off tracker shows live progress          │
│ 10. SETTLE   → Auto-suggest won/lost from live data          │
│ 11. LEARN    → History logs what worked, flags losers         │
│ 12. COMPOUND → Chain advances, next step begins              │
│                                                              │
│  Every step reduces risk. By the time you stake, you've      │
│  verified data, history, patterns, diversity, and discipline. │
└──────────────────────────────────────────────────────────────┘
```

### Step-by-Step Detail

| # | Step | What Happens | Time |
|---|------|-------------|------|
| 1 | Search | Open Search tab, select leagues, click Search. Fixtures load from Football-Data.org / KickoffAPI / TheSportsDB. | 1 min |
| 2 | Score | Each fixture automatically gets O2.5%, BTTS%, Win%, Form, Position Gap. Confidence score calculated. | Auto |
| 3 | Lock | Click "Lock" on 5-10 promising matches. These persist across searches. | 1 min |
| 4 | Filter | Apply market filter (Home Win, Over 2.5, BTTS, etc.) and confidence threshold (65%+). | 30 sec |
| 5 | Generate | Click Generate. System produces all valid 3-odds combinations from your filtered picks. | Auto |
| 6 | Suggest | Or click "Suggest Best Slip" — system auto-selects highest-confidence combination. | Auto |
| 7 | Checklist | Before staking, review: no repeat losers, no fixture congestion, all data-backed, diversified. | 1 min |
| 8 | Stake | Mark as Staked, link to current chain, enter the bet on bookmaker site. | 2 min |
| 9 | Track | Throughout the day, check Active Slips tab. Kick-off countdown shows when each match starts. | Passive |
| 10 | Settle | When matches finish, mark results (✓/✗) per match. One loss = slip auto-lost. | 1 min |
| 11 | Learn | Results flow to History. Accuracy stats update. Patterns surface over time. | Auto |
| 12 | Compound | If slip won: chain advances, stake next step. If lost: restart chain from seed. | 1 min |

**Total active time: ~10-15 minutes per day.**

---

## Target User

- **One developer** (the creator)
- Personal productivity tool, not a product
- Optimized for one person's workflow and patterns
- All learning data is personal — the system learns YOUR patterns, not generic averages
- Not for distribution, not for sale, no multi-user considerations

---

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Slip win rate | 60%+ | 30-day rolling average |
| Average chain length | 3+ steps | Measured over months |
| System vs gut feeling | System wins | Track both, compare |
| Daily workflow time | < 15 minutes | Time from open to staked |
| Learning improvement | Measurable | Month-over-month accuracy trend |
| Income generated | Fund other projects | Actual ₦ withdrawn |

---

## Future Expansion

### Basketball Module (v3.0.0)

Same intelligence principles applied to a different sport:

- **Data:** NBA, Euroleague fixtures via SportScore, balldontlie, API-Basketball
- **Markets:** Spread, total points, moneyline, player props
- **Analysis:** Team form, home/away split, H2H, pace statistics
- **Compounding:** Same 3-odds rollover chain system
- **Integration:** Same UI, same chain management, different sport module

### Other Expansions
- System tray + Windows notifications
- Telegram/WhatsApp alerts (optional)
- Mobile companion (or responsive web)
- Bet9ja parser (second bookmaker)
- Full bankroll tracker (real money P&L)

---

## The Discipline Philosophy

The system is designed to make discipline the path of least resistance:

1. **Rotating banner** — Discipline messages always visible
2. **Daily limits** — Hard cap on slips per day
3. **Confirmation dialogs** — Every destructive action requires explicit confirmation
4. **Pre-stake checklist** — Safety verification before committing
5. **"NO BET TODAY"** — Scout can recommend taking the day off
6. **Progressive thresholds** — Higher chain steps require higher confidence
7. **History flags** — Past losses surface automatically when you repeat patterns

**The system protects you from yourself.** Emotional decisions, chasing losses, gut-feeling overrides — these are the behaviors that break chains. The system's job is to make the disciplined choice the easy choice.

---

## Technical Vision

### Desktop-First (Tauri)
- Fast, native performance
- Full filesystem access for exports
- Rust HTTP backend bypasses browser CORS/truncation limitations
- SQLite for persistent structured data
- Single-instance enforcement

### Offline-Capable
- All historical data stored locally
- Core features (paste, generate, track) work without internet
- API providers only needed for Search/Scout

### Privacy-First
- No telemetry, no analytics, no data sent anywhere
- All data stays on the local machine
- Export/import for manual backups

---

*The goal is simple: turn ₦100 into ₦218,700 through intelligence, discipline, and compounding. Not once — repeatedly.*
