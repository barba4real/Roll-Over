import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:rollover.db');
  }
  return db;
}

// Chain operations
export async function getActiveChains() {
  const database = await getDb();
  return database.select<any[]>(
    "SELECT * FROM chains WHERE status = 'active' ORDER BY started_at DESC"
  );
}

export async function getAllChains() {
  const database = await getDb();
  return database.select<any[]>('SELECT * FROM chains ORDER BY started_at DESC');
}

export async function createChain(label: string, startingStake: number, targetAmount?: number) {
  const database = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.execute(
    `INSERT INTO chains (id, label, starting_stake, target_amount, current_step, current_stake, status, started_at)
     VALUES ($1, $2, $3, $4, 0, $3, 'active', $5)`,
    [id, label, startingStake, targetAmount || null, now]
  );
  return { id, label, starting_stake: startingStake, current_step: 0, current_stake: startingStake, status: 'active', started_at: now };
}

export async function advanceChain(chainId: string, newStake: number) {
  const database = await getDb();
  await database.execute(
    `UPDATE chains SET current_step = current_step + 1, current_stake = $1 WHERE id = $2`,
    [newStake, chainId]
  );
}

export async function breakChain(chainId: string, reason: string) {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.execute(
    `UPDATE chains SET status = 'broken', ended_at = $1, break_reason = $2 WHERE id = $3`,
    [now, reason, chainId]
  );
}

// Slip operations
export async function stakeSlip(data: {
  chainId: string;
  stepNumber: number;
  accumulatedOdds: number;
  qualityScore: number;
  stakeAmount: number;
  selections: any[];
}) {
  const database = await getDb();
  const slipId = crypto.randomUUID();
  const now = new Date().toISOString();
  const potentialReturn = data.stakeAmount * data.accumulatedOdds;

  await database.execute(
    `INSERT INTO slips (id, chain_id, step_number, accumulated_odds, quality_score, stake_amount, potential_return, status, staked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'staked', $8)`,
    [slipId, data.chainId, data.stepNumber, data.accumulatedOdds, data.qualityScore, data.stakeAmount, potentialReturn, now]
  );

  for (const sel of data.selections) {
    const selId = crypto.randomUUID();
    await database.execute(
      `INSERT INTO slip_selections (id, slip_id, home_team, away_team, kick_off_time, market, pick, odds, confidence, league, provider, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')`,
      [selId, slipId, sel.homeTeam, sel.awayTeam, sel.kickOffTime?.toISOString() || '', sel.market, sel.pick, sel.odds, sel.confidence || null, sel.league || null, sel.provider || 'sportybet']
    );
  }

  return { id: slipId, potentialReturn, status: 'staked' };
}

export async function settleSlip(slipId: string, result: 'won' | 'lost') {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.execute(
    `UPDATE slips SET status = $1, settled_at = $2 WHERE id = $3`,
    [result, now, slipId]
  );

  if (result === 'lost') {
    const rows = await database.select<any[]>('SELECT chain_id FROM slips WHERE id = $1', [slipId]);
    if (rows.length > 0) {
      await breakChain(rows[0].chain_id, `Slip lost`);
    }
  }

  if (result === 'won') {
    const rows = await database.select<any[]>('SELECT chain_id, stake_amount, accumulated_odds FROM slips WHERE id = $1', [slipId]);
    if (rows.length > 0) {
      const newStake = rows[0].stake_amount * rows[0].accumulated_odds;
      await advanceChain(rows[0].chain_id, newStake);
    }
  }
}

export async function getPendingSlips() {
  const database = await getDb();
  return database.select<any[]>("SELECT * FROM slips WHERE status = 'staked' ORDER BY staked_at DESC");
}

export async function getSlipSelections(slipId: string) {
  const database = await getDb();
  return database.select<any[]>('SELECT * FROM slip_selections WHERE slip_id = $1', [slipId]);
}

// Settings
export async function getSetting(key: string): Promise<string | null> {
  const database = await getDb();
  const rows = await database.select<any[]>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSetting(key: string, value: string) {
  const database = await getDb();
  await database.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [key, value]
  );
}
