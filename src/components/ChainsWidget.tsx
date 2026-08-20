import React, { useState } from 'react';
import { Chain } from '../engine/types';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  chains: Chain[];
  onCreateChain: (label: string, startingStake: number) => void;
  onAdvanceChain: (chainId: string, winAmount: number) => void;
  onBreakChain: (chainId: string, reason: string) => void;
}

/**
 * ChainsWidget — Collapsible bottom-bar widget with expand-to-modal.
 * Shows summary in collapsed state, full chain management when expanded.
 * Floats at the bottom of the screen, accessible from any view.
 */
export default function ChainsWidget({ chains, onCreateChain, onAdvanceChain, onBreakChain }: Props) {
  const [expanded, setExpanded] = useState(false);
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

  const activeChains = chains.filter(c => c.status === 'active');
  const brokenChains = chains.filter(c => c.status === 'broken');
  const totalDeployed = activeChains.reduce((sum, c) => sum + c.current_stake, 0);
  const totalPnL = activeChains.reduce((sum, c) => sum + (c.current_stake - c.starting_stake), 0);

  function handleCreate() {
    if (!newLabel.trim() || !newStake.trim()) return;
    onCreateChain(newLabel.trim(), parseFloat(newStake));
    setNewLabel('');
    setNewStake('100');
    setShowCreate(false);
  }

  // Collapsed bar — always visible at bottom
  if (!expanded) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-800 border-t border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between max-w-screen-xl mx-auto">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-2 text-sm font-medium text-blue-400 hover:text-blue-300"
            >
              <span className="text-base">🔗</span>
              Chains ({activeChains.length})
              <span className="text-xs text-gray-500">▲</span>
            </button>
            {activeChains.length > 0 && (
              <>
                <span className="text-xs text-gray-400">
                  Deployed: <span className="text-white font-mono">{totalDeployed.toFixed(0)}</span>
                </span>
                <span className={`text-xs font-mono ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  P&L: {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(0)}
                </span>
                <span className="text-xs text-gray-500">
                  Step {activeChains[0]?.current_step || 0}
                </span>
              </>
            )}
            {activeChains.length === 0 && (
              <span className="text-xs text-gray-500">No active chains</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setShowCreate(true); }}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
            >
              + New
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Expanded modal overlay
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={() => setExpanded(false)}
      />

      {/* Modal panel — slides up from bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] bg-gray-900 border-t border-gray-700 rounded-t-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-base">🔗</span>
            <h2 className="text-lg font-bold text-blue-400">Chain Manager</h2>
            {activeChains.length > 0 && (
              <div className="flex items-center gap-3 ml-4">
                <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">
                  {activeChains.length} Active
                </span>
                <span className="text-xs text-gray-400">
                  Deployed: <span className="text-white font-mono">{totalDeployed.toFixed(0)}</span>
                </span>
                <span className={`text-xs font-mono ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(0)} P&L
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium"
            >
              + New Chain
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded text-lg"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Create form */}
          {showCreate && (
            <div className="mb-4 p-4 bg-gray-800 rounded-lg border border-blue-900">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Start New Chain</h4>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Chain label (e.g., Chain A)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="col-span-2 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                />
                <input
                  type="number"
                  placeholder="Stake"
                  value={newStake}
                  onChange={(e) => setNewStake(e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleCreate}
                className="mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
              >
                Start Chain
              </button>
            </div>
          )}

          {/* Active chains grid */}
          {activeChains.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {activeChains.map((chain) => (
                <div key={chain.id} className="p-4 bg-gray-800 rounded-lg border border-green-900">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-green-400">{chain.label}</span>
                    <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                      Step {chain.current_step}
                    </span>
                  </div>
                  <div className="text-xs text-gray-300 mb-1">
                    Current Stake: <span className="font-mono text-white text-sm">{chain.current_stake.toFixed(0)}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-3">
                    Started at {chain.starting_stake} &bull; {new Date(chain.started_at).toLocaleDateString()}
                  </div>
                  {/* Progress bar visual */}
                  <div className="w-full h-1.5 bg-gray-700 rounded-full mb-3">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (chain.current_step / 7) * 100)}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirm({
                        open: true,
                        title: 'Advance Chain',
                        message: `Mark "${chain.label}" as won and advance to Step ${chain.current_step + 1}?`,
                        action: () => onAdvanceChain(chain.id, chain.current_stake * 2),
                        variant: 'info',
                      })}
                      className="flex-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium"
                    >
                      Won (Advance)
                    </button>
                    <button
                      onClick={() => setConfirm({
                        open: true,
                        title: 'Break Chain',
                        message: `Break "${chain.label}"? This marks it as lost.`,
                        action: () => onBreakChain(chain.id, 'Manual break'),
                        variant: 'danger',
                      })}
                      className="flex-1 px-3 py-1.5 bg-red-800 hover:bg-red-700 rounded text-xs font-medium"
                    >
                      Lost (Break)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Broken chains */}
          {brokenChains.length > 0 && (
            <div>
              <h4 className="text-xs text-gray-500 uppercase mb-2 font-medium">Recent Breaks ({brokenChains.length})</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {brokenChains.slice(-6).map((chain) => (
                  <div key={chain.id} className="p-3 bg-gray-800 rounded border border-red-900/30 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-gray-400">{chain.label}</span>
                      <span className="text-xs text-gray-600 ml-2">Step {chain.current_step} &bull; {chain.break_reason}</span>
                    </div>
                    <button
                      onClick={() => onCreateChain(`${chain.label} (R)`, chain.starting_stake)}
                      className="px-2 py-1 bg-blue-700 hover:bg-blue-600 rounded text-xs text-white"
                    >
                      Restart
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chains.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-400 text-sm mb-2">No chains yet.</p>
              <p className="text-gray-600 text-xs">Create a chain to start tracking your rollover compound. Each chain represents a ₦100 → ₦218,700 journey.</p>
            </div>
          )}
        </div>
      </div>

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
    </>
  );
}
