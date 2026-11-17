import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Smartphone,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { getBucketMeta } from "../lib/compliance";
import type { WorkspaceMetrics } from "../lib/api-client";
import type { Certification, ComplianceBucket, Employee, Workspace } from "../lib/types";

interface OverviewMatrixProps {
  workspace: Workspace;
  metrics: WorkspaceMetrics;
  onQuickRenew: (employeeId: string, certId: string) => void;
  onOpenMobileLink: (uploadToken: string) => void;
  onOpenCsvModal: () => void;
  onOpenBillingModal: () => void;
  onAddEmployee: (input: {
    fullName: string;
    roleTitle: string;
    department: string;
    phone: string;
    email: string;
    supervisorName: string;
    supervisorPhone: string;
    supervisorEmail: string;
    initialCert: {
      certName: string;
      certificateNumber: string;
      expiryDate: string;
    };
  }) => Promise<void>;
  onDeleteEmployee: (employeeId: string) => Promise<void>;
  onUpdateCertificationExpiry: (
    cert: Certification,
    newExpiryDate: string,
    newCertNumber: string,
  ) => Promise<void>;
}

const BUCKET_FILTERS: Array<{ key: ComplianceBucket | "all"; label: string }> = [
  { key: "all", label: "All Records" },
  { key: "expired", label: "Expired" },
  { key: "critical_7", label: "≤ 7 Days" },
  { key: "warning_30", label: "≤ 30 Days" },
  { key: "watch_60", label: "≤ 60 Days" },
  { key: "compliant", label: "Compliant" },
];

export function OverviewMatrix({
  workspace,
  metrics,
  onQuickRenew,
  onOpenMobileLink,
  onOpenCsvModal,
  onOpenBillingModal,
  onAddEmployee,
  onDeleteEmployee,
  onUpdateCertificationExpiry,
}: OverviewMatrixProps) {
  const [filter, setFilter] = useState<ComplianceBucket | "all">("all");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingCert, setEditingCert] = useState<Certification | null>(null);
  const [editExpiry, setEditExpiry] = useState("");
  const [editCardNo, setEditCardNo] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const [newEmp, setNewEmp] = useState({
    fullName: "",
    roleTitle: "Field Technician",
    department: "Field Operations",
    phone: "+15125550195",
    email: "",
    supervisorName: "Ray Kowalski",
    supervisorPhone: "+15125550101",
    supervisorEmail: "ray.kowalski@summitmechanical.example",
    certName: "OSHA 30-Hour Construction",
    certificateNumber: "",
    expiryDate: "",
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metrics.rows.filter((row) => {
      if (filter !== "all" && row.bucket !== filter) return false;
      if (!q) return true;
      return (
        row.employee.fullName.toLowerCase().includes(q) ||
        row.employee.department.toLowerCase().includes(q) ||
        row.employee.supervisor.name.toLowerCase().includes(q) ||
        row.cert.certName.toLowerCase().includes(q) ||
        row.cert.certificateNumber.toLowerCase().includes(q)
      );
    });
  }, [metrics.rows, filter, search]);

  const urgentCount = metrics.counts.expired + metrics.counts.critical7;
  const seatPct = Math.min(
    100,
    Math.round((metrics.activeSeats / workspace.billing.seatLimit) * 100),
  );

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!newEmp.expiryDate) {
      setAddError("Please pick an expiry date for the initial certification.");
      return;
    }
    setAddBusy(true);
    try {
      await onAddEmployee({
        fullName: newEmp.fullName,
        roleTitle: newEmp.roleTitle,
        department: newEmp.department,
        phone: newEmp.phone,
        email: newEmp.email,
        supervisorName: newEmp.supervisorName,
        supervisorPhone: newEmp.supervisorPhone,
        supervisorEmail: newEmp.supervisorEmail,
        initialCert: {
          certName: newEmp.certName,
          certificateNumber: newEmp.certificateNumber,
          expiryDate: newEmp.expiryDate,
        },
      });
      setShowAddForm(false);
      setNewEmp((prev) => ({
        ...prev,
        fullName: "",
        email: "",
        certificateNumber: "",
      }));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add employee.");
    } finally {
      setAddBusy(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCert) return;
    await onUpdateCertificationExpiry(editingCert, editExpiry, editCardNo);
    setEditingCert(null);
  }

  function renderStatusBadge(bucket: ComplianceBucket, daysRemaining: number) {
    const meta = getBucketMeta(bucket);
    const toneClass =
      meta.tone === "rose"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : meta.tone === "orange"
          ? "bg-orange-50 text-orange-700 border-orange-200"
          : meta.tone === "amber"
            ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-emerald-50 text-emerald-700 border-emerald-200";

    const dayLabel =
      daysRemaining < 0
        ? `${Math.abs(daysRemaining)}d overdue`
        : daysRemaining === 0
          ? "Due today"
          : `${daysRemaining}d left`;

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${toneClass}`}
      >
        <span>{meta.shortLabel}</span>
        <span className="opacity-75">·</span>
        <span>{dayLabel}</span>
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>WORKFORCE COMPLIANCE</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              {metrics.complianceScore}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {metrics.counts.total - metrics.counts.expired}/{metrics.counts.total} active cards valid
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
              style={{ width: `${metrics.complianceScore}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>60 / 30 / 7 ALERT WINDOWS</span>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-rose-600 tabular-nums">
              {urgentCount}
            </span>
            <span className="text-xs font-medium text-slate-600">
              expired or ≤ 7 days left
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium tabular-nums">
            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">
              {metrics.counts.expired} expired
            </span>
            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700">
              {metrics.counts.warning30} ≤ 30d
            </span>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
              {metrics.counts.watch60} ≤ 60d
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>EST. FINE EXPOSURE</span>
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              ${metrics.estimatedFineExposureUsd.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500">avoidable citations</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            OSHA civil penalties start around $16,131 per lapsed credential.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>SMB FLAT SEAT CAP</span>
            <Users className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                {metrics.activeSeats}
              </span>
              <span className="text-sm font-medium text-slate-500 tabular-nums">
                {" "}
                / {workspace.billing.seatLimit} seats
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenBillingModal}
              className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              ${workspace.billing.monthlyPriceUsd}/mo
            </button>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                seatPct >= 90 ? "bg-amber-600" : "bg-blue-600"
              }`}
              style={{ width: `${seatPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {BUCKET_FILTERS.map((item) => {
            const active = filter === item.key;
            const count =
              item.key === "all"
                ? metrics.counts.total
                : item.key === "expired"
                  ? metrics.counts.expired
                  : item.key === "critical_7"
                    ? metrics.counts.critical7
                    : item.key === "warning_30"
                      ? metrics.counts.warning30
                      : item.key === "watch_60"
                        ? metrics.counts.watch60
                        : metrics.counts.compliant;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <span>{item.label}</span>
                <span
                  className={`rounded px-1.5 py-0.2 text-[11px] tabular-nums ${
                    active ? "bg-slate-700 text-slate-100" : "bg-white text-slate-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:flex-initial">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search worker, cert, card #, supervisor…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            />
          </div>

          <button
            type="button"
            onClick={onOpenCsvModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
            <span>Paste Excel / CSV</span>
          </button>

          <a
            href={`/api/workspaces/${encodeURIComponent(workspace.slug)}/export.csv`}
            download={`${workspace.slug}-compliance.csv`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-slate-600" />
            <span>Export CSV</span>
          </a>

          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Employee</span>
          </button>
        </div>
      </div>

      {/* Inline Add Employee Panel */}
      {showAddForm && (
        <form
          onSubmit={handleCreateEmployee}
          className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 shadow-xs"
        >
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Add Crew Member & Initial Certification
              </h3>
              <p className="text-xs text-slate-500">
                Automatically enrolls worker + supervisor into 60 / 30 / 7-day SMS & email escalation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              aria-label="Close add employee form"
              className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {addError && (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {addError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-medium text-slate-700">
              Full Name *
              <input
                required
                value={newEmp.fullName}
                onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })}
                placeholder="e.g. Carlos Mendez"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Worker Mobile Phone *
              <input
                required
                value={newEmp.phone}
                onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })}
                placeholder="+15125550195"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Role / Title
              <input
                value={newEmp.roleTitle}
                onChange={(e) => setNewEmp({ ...newEmp, roleTitle: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Department / Crew
              <input
                value={newEmp.department}
                onChange={(e) => setNewEmp({ ...newEmp, department: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Supervisor Name *
              <input
                required
                value={newEmp.supervisorName}
                onChange={(e) => setNewEmp({ ...newEmp, supervisorName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Supervisor Phone *
              <input
                required
                value={newEmp.supervisorPhone}
                onChange={(e) => setNewEmp({ ...newEmp, supervisorPhone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Certification Name *
              <input
                required
                value={newEmp.certName}
                onChange={(e) => setNewEmp({ ...newEmp, certName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Expiry Date *
              <input
                required
                type="date"
                value={newEmp.expiryDate}
                onChange={(e) => setNewEmp({ ...newEmp, expiryDate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addBusy}
              className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {addBusy ? "Saving…" : "Save Employee & Start Monitoring"}
            </button>
          </div>
        </form>
      )}

      {/* Certification Compliance Matrix */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {filteredRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-800">
              No certifications match this filter
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Paste rows from an Excel spreadsheet or click Add Employee to track renewals.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={onOpenCsvModal}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Import From Excel / CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear Filters
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Certification & Card #</th>
                  <th className="px-4 py-3">Expiry & Window</th>
                  <th className="px-4 py-3">Supervisor Escalation</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.map(({ cert, employee, daysRemaining, bucket }) => (
                  <tr key={cert.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3.5 align-top">
                      <div className="font-semibold text-slate-900">{employee.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {employee.roleTitle} · {employee.department}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {employee.phone}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{cert.certName}</span>
                        {cert.ocrConfidence !== null && (
                          <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                            OCR {Math.round(cert.ocrConfidence * 100)}%
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono text-slate-700">#{cert.certificateNumber}</span>
                        <span>·</span>
                        <span>{cert.issuingBody}</span>
                        {cert.photoKey && (
                          <button
                            type="button"
                            onClick={() =>
                              setPhotoPreviewUrl(
                                `/api/workspaces/${encodeURIComponent(workspace.slug)}/files?key=${encodeURIComponent(cert.photoKey!)}`,
                              )
                            }
                            className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                          >
                            <Camera className="h-3 w-3" />
                            <span>View Photo</span>
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {cert.expiryDate}
                      </div>
                      <div className="mt-1">{renderStatusBadge(bucket, daysRemaining)}</div>
                    </td>

                    <td className="px-4 py-3.5 align-top">
                      <div className="text-xs font-medium text-slate-800">
                        {employee.supervisor.name}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {employee.supervisor.phone}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        SMS + Email CC at 60 / 30 / 7d
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-right align-top">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onQuickRenew(employee.id, cert.id)}
                          title="Simulate employee texting renewed card photo"
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Smartphone className="h-3.5 w-3.5" />
                          <span>Text Renewal</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMobileLink(employee.uploadToken)}
                          title={`Open mobile worker portal (/m/${employee.uploadToken})`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCert(cert);
                            setEditExpiry(cert.expiryDate);
                            setEditCardNo(cert.certificateNumber);
                          }}
                          title="Edit expiry date manually"
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEmployee(employee.id)}
                          title={`Remove ${employee.fullName}`}
                          className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline Expiry Edit Modal */}
      {editingCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3 className="text-base font-bold text-slate-900">
              Update Certification Record
            </h3>
            <p className="mt-1 text-xs text-slate-500">{editingCert.certName}</p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-slate-700">
                Card / License Number
                <input
                  required
                  value={editCardNo}
                  onChange={(e) => setEditCardNo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                New Expiry Date
                <input
                  required
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingCert(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Save Update
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Uploaded Card Proof Modal */}
      {photoPreviewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
          onClick={() => setPhotoPreviewUrl(null)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">
                Stored Verification Photo (Private Cloud Storage)
              </span>
              <button
                type="button"
                onClick={() => setPhotoPreviewUrl(null)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={photoPreviewUrl}
              alt="Certification card proof"
              className="max-h-[420px] w-full rounded-xl border border-slate-200 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
