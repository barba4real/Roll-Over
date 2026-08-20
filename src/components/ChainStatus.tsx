import React, { useState } from 'react';
import { Chain } from '../engine/types';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  chains: Chain[];
  onCreateChain: (label: string, startingStake: number) => void;
  onAdvanceChain: (chainId: string, winAmount: number) => void;
  onBreakChain: (chainId: string, reason: string) => void;
}

export default function ChainStatus({ chains, onCreateChain, onAdvanceChain, onBreakChain }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newStake, setNewStake] = useState('100');
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => void;
    variant: 'danger' | 'warning' | 'info';
  }>({ open: false, title: '', message: '', action: () => {}, variant: 'danger' });

  function handleCreate() {
    if (!newLabel.trim() || !newStake.trim()) return;
    onCreateChain(newLabel.trim(), parseFloat(newStake));
    setNewLabel('');
    setNewStake('100');
    setShowCreate(false);
  }

  const activeChains = chains.filter(c => c.status === 'active');
  const brokenChains = chains.filter(c => c.status === 'broken');

  const totalDeployed = activeChains.reduce((sum, c) => sum + c.current_stake, 0);
  const totalPnL = activeChains.reduce((sum, c) => sum + (c.current_stake - c.starting_stake), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-blue-400">Chains</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded"
        >
          + New Chain
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
          <input
            type="text"
            placeholder="Chain label (e.g., Chain A)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full px-3 py-2 mb-2 bg-gray-900 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
          <input
            type="number"
            placeholder="Starting stake"
            value={newStake}
            onChange={(e) => setNewStake(e.target.value)}
            className="w-full px-3 py-2 mb-2 bg-gray-900 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleCreate}
            className="w-full py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
          >
            Start Chain
          </button>
        </div>
      )}

      {activeChains.length > 0 && (
        <div className="mb-4 p-3 bg-gray-800 rounded-lg">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-400">Active:</span>
              <span className="text-white font-bold ml-1">{activeChains.length}</span>
            </div>
            <div>
              <span className="text-gray-400">Deployed:</span>
              <span className="text-white font-bold ml-1">{totalDeployed.toFixed(0)}</span>
            </div>
            <div>
              <span className="text-gray-400">P&L:</span>
              <span className={`font-bold ml-1 ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(0)}
              </span>
            </div>
            <div>
              <span className="text-gray-400">Broken:</span>
              <span className="text-red-400 font-bold ml-1">{brokenChains.length}</span>
            </div>
          </div>
        </div>
      )}

      {activeChains.map((chain) => (
        <div key={chain.id} className="mb-2 p-3 bg-gray-800 rounded-lg border border-green-900">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-green-400">{chain.label}</span>
            <span className="text-xs text-gray-400">Step {chain.current_step}</span>
          </div>
          <div className="text-xs text-gray-300 mb-2">
            Stake: <span className="font-mono text-white">{chain.current_stake.toFixed(0)}</span>
            <span className="text-gray-500 ml-2">(started at {chain.starting_stake})</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirm({
                open: true,
                title: 'Advance Chain',
                message: `Mark "${chain.label}" as won and advance to next step?`,
                action: () => onAdvanceChain(chain.id, chain.current_stake * 2),
                variant: 'info',
              })}
              className="px-2 py-1 bg-green-700 hover:bg-green-600 rounded text-xs"
            >
              Won (Advance)
            </button>
            <button
              onClick={() => setConfirm({
                open: true,
                title: 'Break Chain',
                message: `Break "${chain.label}"? This cannot be undone.`,
                action: () => onBreakChain(chain.id, 'Manual break'),
                variant: 'danger',
              })}
              className="px-2 py-1 bg-red-800 hover:bg-red-700 rounded text-xs"
            >
              Lost (Break)
            </button>
          </div>
        </div>
      ))}

      {brokenChains.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs text-gray-500 uppercase mb-2">Recent Breaks</h4>
          {brokenChains.slice(-3).map((chain) => (
            <div key={chain.id} className="mb-1 p-2 bg-gray-800 rounded text-xs border border-red-900/30 flex items-center justify-between">
              <span className="text-gray-400">{chain.label} — Step {chain.current_step} — {chain.break_reason}</span>
              <button
                onClick={() => onCreateChain(`${chain.label} (restart)`, chain.starting_stake)}
                className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white ml-2"
              >
                Restart
              </button>
            </div>
          ))}
        </div>
      )}

      {chains.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">
          No chains yet. Create one to start tracking your rollover.
        </p>
      )}

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        variant={confirm.variant}
        confirmLabel="Yes, proceed"
        onConfirm={() => {
          confirm.action();
          setConfirm(c => ({ ...c, open: false }));
        }}
        onCancel={() => setConfirm(c => ({ ...c, open: false }))}
      />
    </div>
  );
}
