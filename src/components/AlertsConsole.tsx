import { useEffect, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  Play,
  RotateCcw,
  Save,
} from "lucide-react";
import type { AlertChannel, AlertRule, Workspace } from "../lib/types";

interface AlertsConsoleProps {
  workspace: Workspace;
  onRunSweep: () => Promise<{ dispatchedCount: number; skippedDeduplicated: number }>;
  onSaveRules: (rules: AlertRule[]) => Promise<void>;
  onResetRules: () => Promise<void>;
}

export function AlertsConsole({
  workspace,
  onRunSweep,
  onSaveRules,
  onResetRules,
}: AlertsConsoleProps) {
  const [rules, setRules] = useState<AlertRule[]>(workspace.alertRules);
  const [sweeping, setSweeping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setRules(workspace.alertRules);
  }, [workspace.alertRules]);

  function toggleChannel(ruleId: string, channel: AlertChannel) {
    setRules((prev) =>
      prev.map((rule) => {
        if (rule.id !== ruleId) return rule;
        const has = rule.channels.includes(channel);
        const next = has
          ? rule.channels.filter((c) => c !== channel)
          : [...rule.channels, channel];
        return {
          ...rule,
          channels: next.length > 0 ? next : [channel],
        };
      }),
    );
  }

  async function handleRunSweep() {
    setNotice(null);
    setSweeping(true);
    try {
      const res = await onRunSweep();
      setNotice(
        `Sweep completed: ${res.dispatchedCount} alert notification(s) dispatched to workers & supervisors (${res.skippedDeduplicated} already sent this cycle).`,
      );
    } finally {
      setSweeping(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      await onSaveRules(rules);
      setNotice("60 / 30 / 7-day escalation schedule saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setNotice(null);
    await onResetRules();
    setNotice("Restored default 60 / 30 / 7 / Expired escalation templates.");
  }

  return (
    <div className="space-y-6">
      {/* Top Sweep Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            <Clock className="h-3.5 w-3.5" />
            <span>24/7 Automated Schedule: Daily 13:00 UTC + Instant Manual Trigger</span>
          </div>
          <h2 className="mt-2 text-lg font-bold text-slate-900">
            60 / 30 / 7-Day Escalating Worker & Supervisor Alerts
          </h2>
          <p className="text-xs text-slate-500">
            Sends deduplicated reminders to both employee mobile phones and supervisor CCs until a new card photo resets the expiry date.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunSweep}
          disabled={sweeping}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5 text-emerald-400" />
          <span>{sweeping ? "Running Escalation Sweep…" : "Run 60/30/7 Sweep Now"}</span>
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {/* Escalation Rules Editor */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Pre-Configured Cadence Rules</h3>
            <p className="text-xs text-slate-500">
              Variables supported:{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{"{{employeeName}}"}</code>{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{"{{certName}}"}</code>{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{"{{expiryDate}}"}</code>{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{"{{uploadUrl}}"}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? "Saving…" : "Save Rules"}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`rounded-xl border p-4 transition ${
                rule.enabled ? "border-slate-200 bg-slate-50/40" : "border-slate-100 bg-slate-50 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white">
                    {rule.daysBefore === 0 ? "EXPIRED" : `${rule.daysBefore}D`}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{rule.label}</span>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === rule.id ? { ...r, enabled: e.target.checked } : r,
                        ),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.notifyWorker}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === rule.id ? { ...r, notifyWorker: e.target.checked } : r,
                        ),
                      )
                    }
                  />
                  <span>Worker Direct</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.notifySupervisor}
                    onChange={(e) =>
                      setRules((prev) =>
                        prev.map((r) =>
                          r.id === rule.id ? { ...r, notifySupervisor: e.target.checked } : r,
                        ),
                      )
                    }
                  />
                  <span>Supervisor CC</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.channels.includes("sms")}
                    onChange={() => toggleChannel(rule.id, "sms")}
                  />
                  <span>SMS</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.channels.includes("email")}
                    onChange={() => toggleChannel(rule.id, "email")}
                  />
                  <span>Email</span>
                </label>
              </div>

              <textarea
                rows={2}
                value={rule.template}
                onChange={(e) =>
                  setRules((prev) =>
                    prev.map((r) =>
                      r.id === rule.id ? { ...r, template: e.target.value } : r,
                    ),
                  )
                }
                className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dispatched Outbox */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Worker & Supervisor Notification Log ({workspace.alertDeliveries.length})
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            {workspace.integrations.hasTwilioConfig && workspace.integrations.hasResendConfig
              ? "Live Twilio SMS + Resend Email Active"
              : "Sandbox Delivery Outbox (Ready for Twilio / Resend Keys)"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Tier</th>
                <th className="px-4 py-2.5">Recipient</th>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Cert & Expiry</th>
                <th className="px-4 py-2.5">Message Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {workspace.alertDeliveries.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                        item.tierDays === 0
                          ? "bg-rose-100 text-rose-800"
                          : item.tierDays <= 7
                            ? "bg-orange-100 text-orange-800"
                            : item.tierDays <= 30
                              ? "bg-amber-100 text-amber-800"
                              : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {item.tierDays === 0 ? "EXPIRED" : `${item.tierDays}D`}
                    </span>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">{item.recipientName}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          item.recipientRole === "supervisor"
                            ? "bg-amber-50 text-amber-800 border border-amber-200"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.recipientRole === "supervisor" ? "Supervisor CC" : "Worker"}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {item.recipientContact}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <span className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700">
                      {item.channel === "sms" ? (
                        <MessageSquare className="h-3.5 w-3.5 text-blue-600" />
                      ) : (
                        <Mail className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      {item.channel}
                    </span>
                    <div className="text-[10px] text-slate-400">
                      {item.deliveryMode === "sandbox_outbox" ? "Sandbox Outbox" : item.deliveryMode}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-900">{item.certName}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      Exp: {item.expiryDate}
                    </div>
                  </td>

                  <td className="max-w-md px-4 py-3 align-top text-slate-600">
                    {item.messageBody}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
