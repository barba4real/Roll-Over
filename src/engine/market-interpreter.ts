import { ParsedSelection } from './types';

/**
 * Interpret the raw market string into a clean, filterable label.
 * 
 * Logic:
 * - If market contains a team name + "Over/Under", it's team-specific goals
 *   → Check if team name matches home or away team
 *   → "Home 0.5", "Away 1.5", etc.
 * - If market is plain "Over/Under" → "Match Over/Under"
 * - If market contains "Early Goals" → "Early Goals"
 * - If market contains "2nd Half" → "2nd Half Over/Under"
 * - "1X2" variants → "1X2" or "1X2 - 1UP" etc.
 * - "Double Chance" → "Double Chance"
 * - "GG/NG" → "Both Teams Score"
 * - "Handicap" → "Handicap"
 * - "Goal Bounds" → "Goal Bounds"
 */
export function interpretMarket(sel: ParsedSelection): string {
  const market = sel.market;
  const pick = sel.pick;
  const homeLower = sel.homeTeam.toLowerCase();
  const awayLower = sel.awayTeam.toLowerCase();
  const marketLower = market.toLowerCase();

  // Combo markets where pick is already descriptive — abbreviate
  if (marketLower.includes(' & ') || pick.includes(' & ')) {
    return abbreviatePick(pick);
  }

  // "Result or" conditional markets (exclude "goals in a row" / "score X or more" which also contains "or")
  if (marketLower.includes(' or ') && !marketLower.includes('1x2') && !marketLower.includes('win either') && !marketLower.includes('win both') && !marketLower.includes('goals in a row') && !marketLower.includes('or more goals')) {
    if (pick === 'Yes' || pick === 'No') {
      const label = market
        .replace('Home Team', 'H')
        .replace('Away Team', 'A')
        .replace('Home', 'H')
        .replace('Away', 'A')
        .replace('Draw', 'D')
        .replace('Over ', 'O')
        .replace('Under ', 'U')
        .replace('GG', 'GG');
      return pick === 'Yes' ? label : `No: ${label}`;
    }
    return abbreviatePick(pick);
  }

  // Win Either Half
  if (marketLower.includes('win either half')) {
    const team = marketLower.includes('home') || marketLower.includes(homeLower) ? 'H' : 'A';
    return pick === 'Yes' ? `${team} WEH` : `${team} !WEH`;
  }

  // Win Both Halves
  if (marketLower.includes('win both halves')) {
    const team = marketLower.includes('home') || marketLower.includes(homeLower) ? 'H' : 'A';
    return pick === 'Yes' ? `${team} WBH` : `${team} !WBH`;
  }

  // Score In Both Halves
  if (marketLower.includes('score in both halves')) {
    const team = marketLower.includes('home') || marketLower.includes(homeLower) ? 'H' : 'A';
    return pick === 'Yes' ? `${team} SBH` : `${team} !SBH`;
  }

  // Highest Scoring Half
  if (marketLower.includes('highest scoring half')) {
    const team = marketLower.includes('home') || marketLower.includes(homeLower) ? 'H' :
                 marketLower.includes('away') || marketLower.includes(awayLower) ? 'A' : 'M';
    return `${team} Best: ${pick}`;
  }

  // Multigoals
  if (marketLower.includes('multigoals') || marketLower.includes('multi goals')) {
    if (marketLower.includes('away')) return `A ${pick}G`;
    if (marketLower.includes('home')) return `H ${pick}G`;
    return `M ${pick}G`;
  }

  // Multiscores
  if (marketLower.includes('multiscores') || marketLower.includes('multi scores')) {
    return `MS: ${pick.replace(/ or /g, '/')}`;
  }

  // 2nd Half - GG/NG
  if (marketLower.includes('2nd half') && marketLower.includes('gg')) {
    return pick === 'Yes' ? '2H GG' : '2H NG';
  }

  // 2nd Half - Double Chance (plain)
  if (marketLower.includes('2nd half') && marketLower.includes('double chance') && !marketLower.includes('&')) {
    return `2H ${abbreviatePick(pick)}`;
  }

  // GG/NG 2+ (both teams score 2+)
  if (marketLower.includes('gg/ng 2') || marketLower.includes('gg/ng 3')) {
    const num = market.match(/\d+/)?.[0] || '2';
    return pick === 'Yes' ? `GG${num}+` : `No GG${num}+`;
  }

  // "lead by X goals" special
  if (marketLower.includes('lead by') && marketLower.includes('goal')) {
    const num = market.match(/\d+/)?.[0] || '3';
    return pick === 'Yes' ? `${num}GL` : `No ${num}GL`;
  }

  // Team-specific "To Score X or More Goals in a Row"
  if (marketLower.includes('goals in a row')) {
    const numMatch = market.match(/(\d+) or More/i);
    const num = numMatch ? numMatch[1] : '2';
    const team = marketLower.includes('home') || marketLower.includes(homeLower) ? 'H' :
                 marketLower.includes('away') || marketLower.includes(awayLower) ? 'A' : 'Any';
    if (pick === 'Yes') return `${team} ${num}+GR`;
    return `${team} No${num}+GR`;
  }

  // 1st Half Result or Match Result
  if (marketLower.includes('result or match result') || marketLower.includes('result or full')) {
    const p = pick === 'Home' ? 'H' : pick === 'Away' ? 'A' : pick;
    return `1H/FT ${p}`;
  }

  // 1st Half - 1X2
  if (marketLower.includes('1st half') && marketLower.includes('1x2') && !marketLower.includes('&')) {
    const p = pick === 'Home' ? 'H' : pick === 'Away' ? 'A' : pick === 'Draw' ? 'D' : pick;
    return `1H ${p}`;
  }

  // 2nd Half - 1X2
  if (marketLower.includes('2nd half') && marketLower.includes('1x2') && !marketLower.includes('&')) {
    const p = pick === 'Home' ? 'H' : pick === 'Away' ? 'A' : pick === 'Draw' ? 'D' : pick;
    return `2H ${p}`;
  }

  // 1st Half - Double Chance (plain)
  if (marketLower.includes('1st half') && marketLower.includes('double chance') && !marketLower.includes('&')) {
    return `1H ${abbreviatePick(pick)}`;
  }

  // 1st Half - Over/Under
  if (marketLower.includes('1st half') && marketLower.includes('over/under') && !marketLower.includes('&')) {
    return `1H ${abbreviateOverUnder(pick)}`;
  }

  // 2nd Half - Over/Under
  if (marketLower.includes('2nd half') && marketLower.includes('over/under') && !marketLower.includes('&')) {
    return `2H ${abbreviateOverUnder(pick)}`;
  }

  // 2nd Half - Handicap
  if (marketLower.includes('2nd half') && marketLower.includes('handicap') && !marketLower.includes('&')) {
    const p = pick.replace('Home', 'H').replace('Away', 'A');
    return `2H Hcp ${p}`;
  }

  // 1st Half - Handicap
  if (marketLower.includes('1st half') && marketLower.includes('handicap') && !marketLower.includes('&')) {
    const p = pick.replace('Home', 'H').replace('Away', 'A');
    return `1H Hcp ${p}`;
  }

  // Corners
  if (marketLower.includes('corners') && marketLower.includes('over/under')) {
    return `Cor ${abbreviateOverUnder(pick)}`;
  }

  // Cards
  if (marketLower.includes('cards') && marketLower.includes('over/under')) {
    return `Crd ${abbreviateOverUnder(pick)}`;
  }

  // Early Goals
  if (marketLower.includes('early goals')) {
    return `EG ${abbreviateOverUnder(pick)}`;
  }

  // Team-specific Over/Under
  if (marketLower.includes('over/under') || marketLower.includes('over / under')) {
    const teamInMarket = market.replace(/Over\/Under/i, '').replace(/Over \/ Under/i, '').replace(/-/g, '').trim();

    if (teamInMarket.length > 2) {
      const teamLower = teamInMarket.toLowerCase();
      
      // Direct match
      if (teamLower === homeLower) return `H ${abbreviateOverUnder(pick)}`;
      if (teamLower === awayLower) return `A ${abbreviateOverUnder(pick)}`;
      
      // Contains match (either direction)
      if (homeLower.includes(teamLower) || teamLower.includes(homeLower)) return `H ${abbreviateOverUnder(pick)}`;
      if (awayLower.includes(teamLower) || teamLower.includes(awayLower)) return `A ${abbreviateOverUnder(pick)}`;

      // Word-based matching: any significant word (3+ chars) from market team matches home/away
      const marketWords = teamLower.split(/\s+/).filter(w => w.length >= 3);
      const homeWords = homeLower.split(/\s+/).filter(w => w.length >= 3);
      const awayWords = awayLower.split(/\s+/).filter(w => w.length >= 3);
      
      const homeMatch = marketWords.some(mw => homeWords.some(hw => hw.includes(mw) || mw.includes(hw)));
      const awayMatch = marketWords.some(mw => awayWords.some(hw => hw.includes(mw) || mw.includes(hw)));
      
      if (homeMatch && !awayMatch) return `H ${abbreviateOverUnder(pick)}`;
      if (awayMatch && !homeMatch) return `A ${abbreviateOverUnder(pick)}`;
      
      // If both or neither match, try first significant word
      if (marketWords.length > 0) {
        const firstWord = marketWords[0];
        if (homeLower.includes(firstWord)) return `H ${abbreviateOverUnder(pick)}`;
        if (awayLower.includes(firstWord)) return `A ${abbreviateOverUnder(pick)}`;
      }
    }

    return `M ${abbreviateOverUnder(pick)}`;
  }

  // 1X2 variants
  if (marketLower.startsWith('1x2')) {
    const variant = market.includes('-') ? market.split('-').pop()?.trim() : '';
    const p = pick === 'Home' ? 'H' : pick === 'Away' ? 'A' : pick === 'Draw' ? 'D' : pick;
    if (variant) return `${p} (${variant})`;
    return p === 'H' ? 'H' : p === 'A' ? 'A' : p;
  }

  // Double Chance (plain)
  if (marketLower.includes('double chance') && !marketLower.includes('&')) {
    const variant = market.includes('-') ? market.split('-').pop()?.trim() : '';
    const p = abbreviatePick(pick);
    if (variant) return `${p} (${variant})`;
    return p;
  }

  // GG/NG
  if (marketLower === 'gg/ng' || marketLower.includes('both teams')) {
    return pick === 'Yes' ? 'GG' : 'NG';
  }

  // Handicap
  if (marketLower.includes('handicap') && !marketLower.includes('&')) {
    const half = marketLower.includes('1st half') ? '1H ' : '';
    const p = pick.replace('Home', 'H').replace('Away', 'A');
    return `${half}Hcp ${p}`;
  }

  // Goal Bounds
  if (marketLower === 'goal bounds') {
    return `GB ${pick}`;
  }

  // Halftime/Fulltime (plain)
  if (marketLower.includes('halftime/fulltime') && !marketLower.includes('&')) {
    return `HT/FT ${abbreviatePick(pick)}`;
  }

  // Fallback
  return abbreviatePick(pick);
}

/**
 * Abbreviate Over/Under picks: "Over 2.5" → "O2.5", "Under 1.5" → "U1.5"
 */
function abbreviateOverUnder(pick: string): string {
  return pick.replace('Over ', 'O').replace('Under ', 'U');
}

/**
 * Abbreviate common pick patterns
 */
function abbreviatePick(pick: string): string {
  return pick
    .replace('Home or Draw', 'H/D')
    .replace('Draw or Away', 'D/A')
    .replace('Home or Away', 'H/A')
    .replace('Home/Draw', 'H/D')
    .replace('Draw/Away', 'D/A')
    .replace('Home/Away', 'H/A')
    .replace('Home/Home', 'H/H')
    .replace('Away/Away', 'A/A')
    .replace('Away/Home', 'A/H')
    .replace('Draw/Home', 'D/H')
    .replace('Away/Draw', 'A/D')
    .replace('Home', 'H')
    .replace('Away', 'A')
    .replace('Draw', 'D')
    .replace('Over ', 'O')
    .replace('Under ', 'U')
    .replace(' & Yes', ' & GG')
    .replace(' & No', ' & NG')
    .replace(' & yes', ' & GG')
    .replace(' & no', ' & NG');
}

/**
 * Get a short category for grouping in filters
 */
export function getMarketCategory(sel: ParsedSelection): string {
  const market = sel.market;
  const marketLower = market.toLowerCase();
  const interp = interpretMarket(sel);

  // Combo markets (contain "&" in market name)
  if (marketLower.includes(' & ')) {
    if (marketLower.includes('halftime/fulltime')) return 'HT/FT Combo';
    if (marketLower.includes('1x2') && marketLower.includes('over/under')) return '1X2 & Goals';
    if (marketLower.includes('1x2') && marketLower.includes('gg')) return '1X2 & GG';
    if (marketLower.includes('double chance') && marketLower.includes('gg')) return 'DC & GG';
    if (marketLower.includes('double chance') && marketLower.includes('over')) return 'DC & Goals';
    return 'Combo';
  }

  // "Or" conditional markets
  if (marketLower.includes(' or ') && !marketLower.includes('1x2')) {
    if (marketLower.includes('gg')) return 'Result or GG';
    if (marketLower.includes('over') || marketLower.includes('under')) return 'Result or Goals';
    return 'Conditional';
  }

  // Simple markets
  if (interp.startsWith('Home Win')) return 'Home Win';
  if (interp.startsWith('Away Win')) return 'Away Win';
  if (interp === 'Draw') return 'Draw';
  if (interp.startsWith('1st Half Home') || interp.startsWith('1st Half Away') || interp.startsWith('1st Half Draw')) return '1st Half Result';
  if (interp.startsWith('1H or FT')) return '1H or FT Result';
  if (interp.startsWith('Home Over') || interp.startsWith('Home Under')) return 'Home Goals';
  if (interp.startsWith('Away Over') || interp.startsWith('Away Under')) return 'Away Goals';
  if (interp.startsWith('Match Over') || interp.startsWith('Match Under')) return 'Match Goals';
  if (interp.startsWith('Early Goals')) return 'Early Goals';
  if (interp.startsWith('1st Half Over') || interp.startsWith('1st Half Under')) return '1st Half Goals';
  if (interp.startsWith('2nd Half')) return '2nd Half';
  if (interp.startsWith('2H ')) return '2nd Half';
  if (interp.startsWith('Corners')) return 'Corners';
  if (interp.startsWith('Cards')) return 'Cards';
  if (interp.includes('Both Score') || interp === 'No GG' || interp.includes('GG')) return 'GG/NG';
  if (interp.includes('Handicap')) return 'Handicap';
  if (interp.includes('Goals in Row')) return 'Goals in Row';
  if (interp.includes('Win Either Half')) return 'Win Either Half';
  if (interp.includes('Win Both Halves')) return 'Win Both Halves';
  if (interp.includes('Score Both Halves')) return 'Score Both Halves';
  if (interp.includes('Best Half')) return 'Highest Half';
  if (interp.includes('Goals') && (interp.includes('1-') || interp.includes('2-') || interp.includes('3-'))) return 'Multigoals';
  if (interp.startsWith('Score:')) return 'Multiscores';
  if (interp.includes('Goal Lead')) return 'Special';
  if (interp.startsWith('HT/FT')) return 'HT/FT';
  if (interp.includes('Draw or') || interp.includes('Home or') || interp.includes('or Away') || interp.includes('or Draw')) return 'Double Chance';

  return 'Other';
}
