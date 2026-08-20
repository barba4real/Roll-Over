import { v4 as uuidv4 } from 'uuid';
import {
  ParsedSelection,
  ParseResult,
  TicketHeader,
  PickCategory,
  MarketType,
} from './types';

// Regex patterns for parsing
const PATTERNS = {
  ticketHeader: /^Ticket Details \(ID:\s*(\d+)\)$/,
  betIdHeader: /^Bet ID:\s*(.+)$/,
  blockStart: /^\d+$/,
  dateTime: /^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/,
  fullDateTime: /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/,
  gameId: /^Game ID:\s*(\d+)$/,
  statusNotStarted: /^Not Started$/,
  statusLive: /^Check Live Tracker\s*>?$/,
  statusWon: /^Won$/,
  statusLost: /^Lost$/,
  statusVoid: /^Void$/,
  voidMessage: /^This bet has been settled as void\.$/,
  pick: /^(.+)\s+@(\d+\.\d+)$/,
  scorePending: /^--$/,
  scoreDigit: /^\d+$/,
  compactPick: /^\s+(Home|Away|Draw|Over|Under)/,
  compactMatch: /^.+\s+v\s+.+$/,
  totalStake: /^Total Stake\s*:\s*([\d,]+\.?\d*)$/,
  totalOdds: /^Total Odds\s*:\s*([\d,]+\.?\d*)$/,
  totalReturn: /^Total Return\s*:\s*([\d,]+\.?\d*)$/,
  stake: /^Stake\s+([\d,]+\.?\d*)$/,
  odds: /^Odds\s+([\d,]+\.?\d*)$/,
  bonus: /^Bonus\s+([\d,]+\.?\d*)$/,
  potWin: /^Pot\.\s*Win\s+([\d,]+\.?\d*)$/,
};

function parseNumber(str: string): number {
  return parseFloat(str.replace(/,/g, ''));
}

function detectContext(lines: string[]): 'betlist' | 'settled_ticket' | 'running_ticket' | 'compact_unsupported' {
  for (const line of lines.slice(0, 10)) {
    if (PATTERNS.ticketHeader.test(line)) return 'settled_ticket';
    if (PATTERNS.betIdHeader.test(line)) return 'running_ticket';
    if (PATTERNS.compactPick.test(line)) return 'compact_unsupported';
  }
  return 'betlist';
}

function parseHeader(lines: string[], context: string): { header: TicketHeader | null; startIndex: number } {
  if (context === 'betlist') return { header: null, startIndex: 0 };

  const header: TicketHeader = {
    ticketId: null,
    datePlaced: null,
    device: null,
    betType: null,
    overallResult: null,
    totalStake: null,
    totalOdds: null,
    totalReturn: null,
    bonus: null,
    potentialWin: null,
  };

  let startIndex = 0;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];

    const ticketMatch = line.match(PATTERNS.ticketHeader);
    if (ticketMatch) {
      header.ticketId = ticketMatch[1];
      continue;
    }

    const betIdMatch = line.match(PATTERNS.betIdHeader);
    if (betIdMatch) {
      header.ticketId = betIdMatch[1];
      continue;
    }

    const dateMatch = line.match(PATTERNS.fullDateTime);
    if (dateMatch) {
      const [, day, month, year, hour, min] = dateMatch;
      header.datePlaced = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min));
      continue;
    }

    if (line === 'Multiple' || line === 'Single') {
      header.betType = line;
      continue;
    }

    if (line === 'Won' || line === 'Lost' || line === 'Running' || line === 'Pending') {
      header.overallResult = line;
      continue;
    }

    const stakeMatch = line.match(PATTERNS.totalStake) || line.match(PATTERNS.stake);
    if (stakeMatch) {
      header.totalStake = parseNumber(stakeMatch[1]);
      continue;
    }

    const oddsMatch = line.match(PATTERNS.totalOdds) || line.match(PATTERNS.odds);
    if (oddsMatch) {
      header.totalOdds = parseNumber(oddsMatch[1]);
      continue;
    }

    const returnMatch = line.match(PATTERNS.totalReturn);
    if (returnMatch) {
      header.totalReturn = parseNumber(returnMatch[1]);
      continue;
    }

    const bonusMatch = line.match(PATTERNS.bonus);
    if (bonusMatch) {
      header.bonus = parseNumber(bonusMatch[1]);
      continue;
    }

    const potWinMatch = line.match(PATTERNS.potWin);
    if (potWinMatch) {
      header.potentialWin = parseNumber(potWinMatch[1]);
      continue;
    }

    // Check if we've reached the first block (selection index)
    if (PATTERNS.blockStart.test(line) && i > 2) {
      startIndex = i;
      break;
    }

    // "Selection Details" separator in running ticket
    if (line === 'Selection Details') {
      startIndex = i + 1;
      break;
    }
  }

  return { header, startIndex };
}

function categorizePickValue(pick: string): PickCategory {
  const lower = pick.toLowerCase().trim();

  if (lower === 'home') return 'home';
  if (lower === 'away') return 'away';
  if (lower === 'draw') return 'draw';
  if (lower === 'home or draw') return 'home_or_draw';
  if (lower === 'draw or away') return 'draw_or_away';
  if (lower === 'home or away' || lower.startsWith('home/away')) return 'home_or_away';
  if (lower.startsWith('over')) return 'over';
  if (lower.startsWith('under')) return 'under';
  if (lower === 'yes') return 'yes';
  if (lower === 'no') return 'no';
  if (/^\d+-\d+$/.test(lower)) return 'goal_range';
  if (/\(\d+:\d+\)/.test(lower)) return 'handicap';
  if (lower.includes('&')) return 'combo';

  return 'other';
}

function categorizeMarket(market: string): { type: MarketType; variant: string | null } {
  const lower = market.toLowerCase();

  if (lower.startsWith('1x2')) {
    const variant = market.includes('-') ? market.split('-').pop()?.trim() || null : null;
    return { type: '1x2', variant };
  }
  if (lower.includes('double chance') && lower.includes('over/under')) {
    return { type: 'combo', variant: null };
  }
  if (lower.includes('double chance')) {
    const variant = market.includes('-') ? market.split('-').pop()?.trim() || null : null;
    return { type: 'double_chance', variant };
  }
  if (lower === 'gg/ng' || lower.includes('both teams')) {
    return { type: 'gg_ng', variant: null };
  }
  if (lower.includes('handicap')) {
    return { type: 'handicap', variant: null };
  }
  if (lower === 'goal bounds') {
    return { type: 'goal_bounds', variant: null };
  }
  if (lower.includes('over/under')) {
    // Team-specific: "Bayern Munich Over/Under"
    if (!lower.startsWith('over/under') && !lower.includes('- over/under') && !lower.includes('half')) {
      return { type: 'over_under_team', variant: null };
    }
    // Half-specific: "2nd Half - Over/Under"
    if (lower.includes('half') || lower.includes('early goals')) {
      return { type: 'over_under', variant: lower.includes('early') ? 'Early Goals' : lower.includes('2nd') ? '2nd Half' : '1st Half' };
    }
    return { type: 'over_under', variant: null };
  }
  if (lower.includes('correct score')) {
    return { type: 'correct_score', variant: null };
  }
  if (lower.includes('any team to score') || lower.includes('goals in a row')) {
    return { type: 'special', variant: null };
  }

  return { type: 'other', variant: null };
}

function inferYear(day: number, month: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const date = new Date(currentYear, month - 1, day);

  // If the date is more than 30 days in the past, it might be next year
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (date < thirtyDaysAgo) {
    return currentYear + 1;
  }
  return currentYear;
}

export function parseSportyBet(rawText: string): ParseResult {
  const lines = rawText.split('\n').map(l => l.trimEnd());
  const context = detectContext(lines);

  if (context === 'compact_unsupported') {
    return {
      context,
      header: null,
      selections: [],
      activeSelections: [],
      errors: ['Compact format detected. Please paste the full detailed bet list instead.'],
    };
  }

  const { header, startIndex } = parseHeader(lines, context);
  const selections: ParsedSelection[] = [];
  const errors: string[] = [];

  // Parse selection blocks
  let i = startIndex;
  while (i < lines.length) {
    // Find next block start (standalone integer)
    if (!PATTERNS.blockStart.test(lines[i].trim())) {
      i++;
      continue;
    }

    const blockIndex = parseInt(lines[i].trim());
    i++;

    // Skip empty lines
    while (i < lines.length && lines[i].trim() === '') i++;

    // Parse date/time
    let date = '';
    let time = '';
    let day = 0, month = 0, hour = 0, min = 0;

    if (i < lines.length) {
      const dtMatch = lines[i].trim().match(PATTERNS.dateTime);
      if (dtMatch) {
        [, date, time] = [, `${dtMatch[1]}/${dtMatch[2]}`, `${dtMatch[3]}:${dtMatch[4]}`];
        day = parseInt(dtMatch[1]);
        month = parseInt(dtMatch[2]);
        hour = parseInt(dtMatch[3]);
        min = parseInt(dtMatch[4]);
        date = `${dtMatch[1]}/${dtMatch[2]}`;
        time = `${dtMatch[3]}:${dtMatch[4]}`;
        i++;
      }
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Parse Game ID (optional)
    let gameId: string | null = null;
    if (i < lines.length) {
      const gameIdMatch = lines[i].trim().match(PATTERNS.gameId);
      if (gameIdMatch) {
        gameId = gameIdMatch[1];
        i++;
      }
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Parse status
    let status: ParsedSelection['status'] = 'not_started';
    if (i < lines.length) {
      const statusLine = lines[i].trim();
      if (PATTERNS.statusNotStarted.test(statusLine)) {
        status = 'not_started';
        i++;
      } else if (PATTERNS.statusLive.test(statusLine)) {
        status = 'live';
        i++;
      } else if (PATTERNS.statusWon.test(statusLine)) {
        status = 'won';
        i++;
      } else if (PATTERNS.statusLost.test(statusLine)) {
        status = 'lost';
        i++;
      } else if (PATTERNS.statusVoid.test(statusLine)) {
        status = 'void';
        i++;
      }
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Check for status label (e.g., "1UP Early Payout")
    if (i < lines.length) {
      const line = lines[i].trim();
      if (line === '1UP Early Payout' || line.includes('Early Payout')) {
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
      }
    }

    // Parse home team (next non-empty line)
    let homeTeam = '';
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length) {
      homeTeam = lines[i].trim();
      i++;
    }

    // Parse away team (next non-empty line)
    let awayTeam = '';
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length) {
      awayTeam = lines[i].trim();
      i++;
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Parse score (-- or digits)
    let score: { home: number; away: number } | null = null;
    if (i < lines.length) {
      const scoreLine = lines[i].trim();
      if (PATTERNS.scorePending.test(scoreLine)) {
        i++;
      } else if (PATTERNS.scoreDigit.test(scoreLine)) {
        const homeScore = parseInt(scoreLine);
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i < lines.length && PATTERNS.scoreDigit.test(lines[i].trim())) {
          const awayScore = parseInt(lines[i].trim());
          score = { home: homeScore, away: awayScore };
          i++;
        }
      }
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Find "Pick" keyword (scan max 10 lines forward to prevent runaway)
    let pick = '';
    let odds = 0;
    const pickScanLimit = Math.min(i + 10, lines.length);
    while (i < pickScanLimit) {
      if (lines[i].trim() === 'Pick') {
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        // Parse pick line
        if (i < lines.length) {
          const pickMatch = lines[i].trim().match(PATTERNS.pick);
          if (pickMatch) {
            pick = pickMatch[1].trim();
            odds = parseFloat(pickMatch[2]);
          }
          i++;
        }
        break;
      }
      i++;
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Find "Market" keyword (scan max 10 lines forward)
    let market = '';
    const marketScanLimit = Math.min(i + 10, lines.length);
    while (i < marketScanLimit) {
      if (lines[i].trim() === 'Market') {
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i < lines.length) {
          market = lines[i].trim();
          i++;
        }
        break;
      }
      i++;
    }

    while (i < lines.length && lines[i].trim() === '') i++;

    // Find "Result" keyword (scan max 10 lines forward)
    let result: string | null = null;
    let resultMessage: string | null = null;
    const resultScanLimit = Math.min(i + 10, lines.length);
    while (i < resultScanLimit) {
      if (lines[i].trim() === 'Result') {
        i++;
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i < lines.length) {
          const resultLine = lines[i].trim();
          if (resultLine === '--') {
            result = null;
          } else {
            result = resultLine;
          }
          i++;
        }
        // Check for result message
        while (i < lines.length && lines[i].trim() === '') i++;
        if (i < lines.length) {
          const msg = lines[i].trim();
          if (msg.includes('achieved') || msg.includes('success')) {
            resultMessage = msg;
            i++;
          }
        }
        break;
      }
      i++;
      if (i > lines.length) break;
    }

    // Check for void message
    let isVoid = status === 'void';
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && PATTERNS.voidMessage.test(lines[i].trim())) {
      isVoid = true;
      i++;
    }

    // Build the selection
    if (homeTeam && awayTeam && odds > 0) {
      const year = inferYear(day, month);
      const kickOffDateTime = new Date(year, month - 1, day, hour, min);
      const { type: marketType, variant: marketVariant } = categorizeMarket(market);
      const pickCategory = categorizePickValue(pick);

      const isSettled = status === 'won' || status === 'lost' || status === 'void';

      selections.push({
        id: uuidv4(),
        index: blockIndex,
        date,
        time,
        kickOffDateTime,
        gameId,
        homeTeam,
        awayTeam,
        status: isVoid ? 'void' : status,
        score,
        pick,
        pickCategory,
        odds,
        market,
        marketType,
        marketVariant,
        result,
        resultMessage,
        isSettled,
        isVoid,
        isSuspended: false,
        isEligibleForGrouping: status === 'not_started' && !isVoid,
      });
    } else if (blockIndex > 0) {
      errors.push(`Failed to parse selection #${blockIndex}`);
    }
  }

  const activeSelections = selections.filter(s => s.isEligibleForGrouping);

  // Deduplicate: remove exact duplicates (same match + same pick + same market)
  const seen = new Set<string>();
  const deduped = activeSelections.filter(s => {
    const key = `${s.homeTeam.toLowerCase()}|${s.awayTeam.toLowerCase()}|${s.pick.toLowerCase()}|${s.market.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by kick-off time
  deduped.sort((a, b) => a.kickOffDateTime.getTime() - b.kickOffDateTime.getTime());

  const duplicatesRemoved = activeSelections.length - deduped.length;
  if (duplicatesRemoved > 0) {
    errors.push(`${duplicatesRemoved} exact duplicate(s) removed (same match, pick & market).`);
  }

  return {
    context,
    header,
    selections,
    activeSelections: deduped,
    errors,
  };
}
