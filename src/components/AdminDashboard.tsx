import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, ShieldCheck, UserX } from 'lucide-react';
import { apiRequest } from '../services/apiClient';
import type { ReportItem, Server, UserPublic } from '../types/shadowspace';

interface OverviewResponse {
  stats: {
    totalUsers: number;
    totalServers: number;
    openReports: number;
    onlineSockets: number;
  };
  users: UserPublic[];
  servers: Server[];
  reports: ReportItem[];
}

export function AdminDashboard() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'reports' | 'users' | 'servers'>('reports');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OverviewResponse>('/api/admin/overview');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin verification failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateReportStatus = async (reportId: string, status: 'resolved' | 'dismissed') => {
    await apiRequest(`/api/admin/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const toggleSuspend = async (uid: string, suspended: boolean) => {
    await apiRequest('/api/admin/suspend', {
      method: 'POST',
      body: JSON.stringify({
        targetUserId: uid,
        suspended,
        reason: suspended ? 'Suspended by platform owner' : 'Reinstated by platform owner',
      }),
    });
    await load();
  };

  return (
    <div className="flex-1 overflow-y-auto p-5 sm:p-7 bg-white dark:bg-[#1b1c21]">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-[#5865f2]" />
            <div>
              <h1 className="text-xl font-display font-bold">Platform Administration</h1>
              <p className="text-xs text-zinc-500">Server-verified owner oversight & abuse monitoring</p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-100 dark:bg-[#222328] hover:dark:bg-[#2b2d34] border border-zinc-200 dark:border-white/[0.07] text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Registered Users', val: data.stats.totalUsers },
                { label: 'Communities', val: data.stats.totalServers },
                { label: 'Open Reports', val: data.stats.openReports },
                { label: 'Live Sockets', val: data.stats.onlineSockets },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="p-4 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-zinc-50 dark:bg-[#222328]"
                >
                  <p className="text-xs text-zinc-500">{stat.label}</p>
                  <p className="text-2xl font-display font-bold font-mono tabular-nums mt-1">
                    {stat.val}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              {(['reports', 'users', 'servers'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    tab === t
                      ? 'bg-[#5865f2] text-white'
                      : 'bg-zinc-100 dark:bg-[#222328] text-zinc-500 dark:text-zinc-400 hover:dark:text-zinc-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'reports' && (
              <div className="space-y-2.5">
                {data.reports.length === 0 ? (
                  <p className="text-xs text-zinc-500">No abuse reports submitted.</p>
                ) : (
                  data.reports.map((rep) => (
                    <div
                      key={rep.id}
                      className="p-4 rounded-xl border border-zinc-200 dark:border-white/[0.07] bg-white dark:bg-[#222328] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs">
                          <ShieldAlert className="w-4 h-4 text-amber-400" />
                          <span className="font-semibold uppercase">{rep.targetType}</span>
                          <span className="text-zinc-500">· {rep.status}</span>
                        </div>
                        <p className="text-sm">{rep.reason}</p>
                        <p className="text-xs text-zinc-500 font-mono">Target: {rep.targetId}</p>
                      </div>
                      {rep.status === 'open' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateReportStatus(rep.id, 'resolved')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => updateReportStatus(rep.id, 'dismissed')}
                            className="px-3 py-1.5 rounded-lg bg-[#17181c] border border-white/[0.07] text-zinc-200 text-xs"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'users' && (
              <div className="divide-y divide-zinc-200 dark:divide-white/[0.06] border border-zinc-200 dark:border-white/[0.07] rounded-xl overflow-hidden bg-white dark:bg-[#222328]">
                {data.users.map((u) => (
                  <div key={u.uid} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{u.displayName}</p>
                      <p className="text-xs text-zinc-500">@{u.username} · {u.uid}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSuspend(u.uid, true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-400 text-xs font-medium"
                      >
                        <UserX className="w-3.5 h-3.5" /> Suspend
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSuspend(u.uid, false)}
                        className="px-3 py-1.5 rounded-lg bg-[#17181c] border border-white/[0.07] text-zinc-200 text-xs"
                      >
                        Reinstate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'servers' && (
              <div className="divide-y divide-zinc-200 dark:divide-white/[0.06] border border-zinc-200 dark:border-white/[0.07] rounded-xl overflow-hidden bg-white dark:bg-[#222328]">
                {data.servers.map((srv) => (
                  <div key={srv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{srv.name}</p>
                      <p className="text-xs text-zinc-500">
                        {srv.isPublic ? 'Public' : 'Private'} · {srv.memberCount} members
                      </p>
                    </div>
                    <span className="text-xs font-mono text-zinc-500">{srv.id}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
