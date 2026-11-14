import React from 'react';
import { deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { db } from '../config/firebase';
import type { NotificationItem } from '../types/shadowspace';
import { formatTimeShort } from '../utils/validators';

interface NotificationsDrawerProps {
  notifications: NotificationItem[];
  onClose: () => void;
}

export function NotificationsDrawer({ notifications, onClose }: NotificationsDrawerProps) {
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    await Promise.all(
      notifications
        .filter((n) => !n.read)
        .map((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }))
    );
  };

  const clearAll = async () => {
    await Promise.all(notifications.map((n) => deleteDoc(doc(db, 'notifications', n.id))));
  };

  const enableBrowserPush = async () => {
    if ('Notification' in window) {
      await Notification.requestPermission();
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-sm bg-white dark:bg-[#1b1c21] border-l border-zinc-200 dark:border-white/[0.08] h-full flex flex-col shadow-2xl">
        <div className="px-4 py-3.5 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#949cf7]" />
            <h2 className="font-display font-semibold text-sm">
              Inbox ({unreadCount} unread)
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#17181c] flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300"
          >
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
          <button
            type="button"
            onClick={enableBrowserPush}
            className="text-zinc-400 hover:text-zinc-200"
          >
            Browser Alerts
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-rose-400"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800/80">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              You&apos;re all caught up.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.read) void updateDoc(doc(db, 'notifications', n.id), { read: true });
                }}
                className={`p-4 cursor-pointer transition-colors ${
                  n.read ? 'opacity-65' : 'bg-violet-600/5 hover:bg-violet-600/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{n.title}</p>
                  <span className="text-[11px] font-mono text-zinc-500 tabular-nums">
                    {formatTimeShort(n.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{n.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
