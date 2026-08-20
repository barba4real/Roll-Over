import { Slip } from '../engine/types';

/**
 * Format a slip as clean text for clipboard
 */
export function formatSlipForClipboard(slip: Slip): string {
  const lines: string[] = [];
  lines.push(`--- Betslip (${slip.accumulatedOdds.toFixed(2)} odds, ${slip.selectionCount} picks) ---`);
  lines.push('');

  for (const sel of slip.selections) {
    lines.push(`${sel.homeTeam} v ${sel.awayTeam}`);
    lines.push(`  → ${sel.pick} @${sel.odds.toFixed(2)}  [${sel.date} ${sel.time}]`);
  }

  lines.push('');
  lines.push(`Total Odds: ${slip.accumulatedOdds.toFixed(2)}`);
  return lines.join('\n');
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
