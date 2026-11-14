import React, { useMemo, useState } from 'react';
import { Hash, Search, Server as ServerIcon, User, X } from 'lucide-react';
import type { Channel, Server, UserPublic } from '../types/shadowspace';

interface GlobalSearchModalProps {
  servers: Server[];
  channels: Channel[];
  users: UserPublic[];
  onSelectServer: (serverId: string) => void;
  onSelectChannel: (serverId: string, channelId: string) => void;
  onSelectUser: (uid: string) => void;
  onClose: () => void;
}

export function GlobalSearchModal({
  servers,
  channels,
  users,
  onSelectServer,
  onSelectChannel,
  onSelectUser,
  onClose,
}: GlobalSearchModalProps) {
  const [queryText, setQueryText] = useState('');

  const results = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) {
      return {
        servers: servers.slice(0, 5),
        channels: channels.slice(0, 5),
        users: users.slice(0, 5),
      };
    }
    return {
      servers: servers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6),
      channels: channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6),
      users: users
        .filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.displayName.toLowerCase().includes(q)
        )
        .slice(0, 6),
    };
  }, [channels, queryText, servers, users]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-16 p-4">
      <div className="max-w-xl w-full bg-white dark:bg-[#222328] border border-zinc-200 dark:border-white/[0.08] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c]">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Where would you like to go? Search servers, channels, and people…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-zinc-500"
          />
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-3 space-y-4">
          {results.servers.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 text-[11px] font-semibold text-zinc-500">Communities</p>
              {results.servers.map((srv) => (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => {
                    onSelectServer(srv.id);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-left text-sm"
                >
                  <ServerIcon className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="truncate font-medium">{srv.name}</span>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {srv.isPublic ? 'Public' : 'Private'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.channels.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 text-[11px] font-semibold text-zinc-500">Channels</p>
              {results.channels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    onSelectChannel(ch.serverId, ch.id);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-left text-sm"
                >
                  <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
            </div>
          )}

          {results.users.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 text-[11px] font-semibold text-zinc-500">People</p>
              {results.users.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => {
                    onSelectUser(u.uid);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-left text-sm"
                >
                  <User className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate font-medium">{u.displayName}</span>
                  <span className="text-xs text-zinc-500">@{u.username}</span>
                </button>
              ))}
            </div>
          )}

          {results.servers.length === 0 &&
            results.channels.length === 0 &&
            results.users.length === 0 && (
              <p className="text-center text-xs text-zinc-500 py-8">No matching results found.</p>
            )}
        </div>
      </div>
    </div>
  );
}
