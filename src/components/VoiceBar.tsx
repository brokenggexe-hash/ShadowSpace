import React from 'react';
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Signal } from 'lucide-react';
import type { VoicePeerState } from '../contexts/RealtimeContext';
import type { ActiveVoiceRoom } from '../hooks/useVoiceChannel';

interface VoiceBarProps {
  activeVoice: ActiveVoiceRoom | null;
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
  errorMsg: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  participants: VoicePeerState[];
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onLeave: () => void;
}

export function VoiceBar({
  activeVoice,
  connectionStatus,
  errorMsg,
  muted,
  deafened,
  speaking,
  participants,
  onToggleMute,
  onToggleDeafen,
  onLeave,
}: VoiceBarProps) {
  if (!activeVoice && connectionStatus !== 'error') return null;

  return (
    <div className="border-t border-black/30 dark:border-white/[0.06] bg-zinc-100 dark:bg-[#131418] px-3 py-2 space-y-2 shrink-0">
      {errorMsg ? (
        <div className="text-xs text-rose-400 flex items-center justify-between gap-2 py-0.5">
          <span className="truncate font-medium">{errorMsg}</span>
          <button
            type="button"
            onClick={onLeave}
            className="text-[11px] px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 shrink-0"
          >
            Dismiss
          </button>
        </div>
      ) : activeVoice ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <Signal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {connectionStatus === 'connecting' ? 'Connecting RTC…' : 'Voice Connected'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {activeVoice.channel.name} / {activeVoice.serverName}
              </p>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                title={muted ? 'Unmute' : 'Mute'}
                className={`p-1.5 rounded-md transition-colors ${
                  muted
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                    : speaking
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-zinc-500 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.08]'
                }`}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={onToggleDeafen}
                aria-label={deafened ? 'Undeafen audio' : 'Deafen audio'}
                title={deafened ? 'Undeafen' : 'Deafen'}
                className={`p-1.5 rounded-md transition-colors ${
                  deafened
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                    : 'text-zinc-500 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/[0.08]'
                }`}
              >
                {deafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={onLeave}
                aria-label="Disconnect voice"
                title="Disconnect"
                className="p-1.5 rounded-md text-zinc-500 dark:text-zinc-300 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          </div>

          {participants.length > 0 && (
            <div className="space-y-1 max-h-20 overflow-y-auto pt-1.5 border-t border-black/10 dark:border-white/[0.06]">
              {participants.map((p) => (
                <div key={p.uid} className="flex items-center justify-between text-[11px] gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        p.speaking ? 'bg-emerald-400' : p.muted ? 'bg-rose-400' : 'bg-zinc-500'
                      }`}
                    />
                    <span
                      className={`truncate ${
                        p.speaking
                          ? 'text-emerald-400 font-semibold'
                          : 'text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {p.displayName}
                    </span>
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0">
                    {p.deafened ? 'Deafened' : p.muted ? 'Muted' : 'Live'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
