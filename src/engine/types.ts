// Parsed selection from pasted data
export interface ParsedSelection {
  id: string;
  index: number;
  date: string;
  time: string;
  kickOffDateTime: Date;
  gameId: string | null;
  homeTeam: string;
  awayTeam: string;
  status: 'not_started' | 'live' | 'won' | 'lost' | 'void';
  score: { home: number; away: number } | null;
  pick: string;
  pickCategory: PickCategory;
  odds: number;
  market: string;
  marketType: MarketType;
  marketVariant: string | null;
  result: string | null;
  resultMessage: string | null;
  isSettled: boolean;
  isVoid: boolean;
  isSuspended: boolean;
  isEligibleForGrouping: boolean;
}

export type PickCategory =
  | 'home'
  | 'away'
  | 'draw'
  | 'home_or_draw'
  | 'draw_or_away'
  | 'home_or_away'
  | 'over'
  | 'under'
  | 'yes'
  | 'no'
  | 'goal_range'
  | 'handicap'
  | 'combo'
  | 'other';

export type MarketType =
  | '1x2'
  | 'over_under'
  | 'over_under_team'
  | 'double_chance'
  | 'gg_ng'
  | 'handicap'
  | 'goal_bounds'
  | 'correct_score'
  | 'combo'
  | 'special'
  | 'other';

// Generated slip
export interface Slip {
  id: string;
  selections: ParsedSelection[];
  accumulatedOdds: number;
  qualityScore: number;
  hasHighRiskPick: boolean;
  selectionCount: number;
}

// Grouping configuration
export interface GroupingConfig {
  targetOdds: number;
  oddsRange: { min: number; max: number };
  maxPicksPerSlip: number;
  minPicksPerSlip: number;
  safeOddsRange: { min: number; max: number }; // Picks within this range are "safe zone"
  maxHighRiskPerSlip: number;
  noSameTeam: boolean;
  noSameKickoff: boolean;
  maxSlipsToGenerate: number;
}

// Rollover chain
export interface Chain {
  id: string;
  label: string;
  starting_stake: number;
  target_amount: number | null;
  current_step: number;
  current_stake: number;
  status: 'active' | 'completed' | 'broken';
  started_at: string;
  ended_at: string | null;
  break_reason: string | null;
}

// Parsed ticket header
export interface TicketHeader {
  ticketId: string | null;
  datePlaced: Date | null;
  device: string | null;
  betType: string | null;
  overallResult: string | null;
  totalStake: number | null;
  totalOdds: number | null;
  totalReturn: number | null;
  bonus: number | null;
  potentialWin: number | null;
}

// Full parse result
export interface ParseResult {
  context: 'betlist' | 'settled_ticket' | 'running_ticket' | 'compact_unsupported';
  header: TicketHeader | null;
  selections: ParsedSelection[];
  activeSelections: ParsedSelection[];
  errors: string[];
}
