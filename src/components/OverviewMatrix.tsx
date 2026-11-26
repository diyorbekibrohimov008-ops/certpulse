import { useEffect, useMemo, useState } from "react";
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
  Trash2,
  Users,
  X,
} from "lucide-react";
import { getBucketMeta } from "../lib/compliance";
import type { WorkspaceMetrics } from "../lib/api-client";
import type { Certification, ComplianceBucket, Workspace } from "../lib/types";

interface OverviewMatrixProps {
  workspace: Workspace;
  metrics: WorkspaceMetrics;
  onQuickRenew: (employeeId: string, certId: string) => void;
  onOpenMobileLink: (uploadToken: string) => void;
  onOpenCsvModal: () => void;
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
  { key: "all", label: "All cards" },
  { key: "expired", label: "Expired" },
  { key: "critical_7", label: "7 days or less" },
  { key: "warning_30", label: "8–30 days" },
  { key: "watch_60", label: "31–60 days" },
  { key: "compliant", label: "Valid" },
];

export function OverviewMatrix({
  workspace,
  metrics,
  onQuickRenew,
  onOpenMobileLink,
  onOpenCsvModal,
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
  const [editBusy, setEditBusy] = useState(false);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!editingCert && !photoPreviewUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditingCert(null);
        setPhotoPreviewUrl(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingCert, photoPreviewUrl]);

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

  const expiringSoonCount =
    metrics.counts.critical7 + metrics.counts.warning30 + metrics.counts.watch60;
  const validCount = metrics.counts.total - metrics.counts.expired;

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!newEmp.expiryDate) {
      setAddError("Please pick an expiry date for the safety card.");
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
    setEditBusy(true);
    try {
      await onUpdateCertificationExpiry(editingCert, editExpiry, editCardNo);
      setEditingCert(null);
    } finally {
      setEditBusy(false);
    }
  }

  function renderStatusBadge(bucket: ComplianceBucket, daysRemaining: number) {
    const meta = getBucketMeta(bucket);
    const toneClass =
      meta.tone === "rose"
        ? "bg-rose-50 text-rose-700 border-rose-200"
        : meta.tone === "orange"
          ? "bg-orange-50 text-orange-700 border-orange-200"
          : meta.tone === "amber"
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-teal-50 text-teal-800 border-teal-200";

    const dayLabel =
      daysRemaining < 0
        ? `${Math.abs(daysRemaining)}d overdue`
        : daysRemaining === 0
          ? "Due today"
          : `${daysRemaining}d left`;

    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums ${toneClass}`}
      >
        <span>{meta.shortLabel}</span>
        <span className="opacity-60">/</span>
        <span>{dayLabel}</span>
      </span>
    );
  }

  return (
    <div className="space-y-5">
      {/* Clean 3-Stat Clinical Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Cards up to date</span>
            <CheckCircle2 className="h-4 w-4 text-[#0f766e]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-950 tabular-nums">
              {metrics.complianceScore}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {validCount} of {metrics.counts.total} valid
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#0f766e] transition-[width] duration-300"
              style={{ width: `${metrics.complianceScore}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Needs renewal</span>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-rose-700 tabular-nums">
              {metrics.counts.expired}
            </span>
            <span className="text-xs text-slate-600">
              expired right now
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500 tabular-nums">
            {expiringSoonCount} more expiring within the next 60 days ({metrics.counts.critical7} within 7 days).
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Employees tracked</span>
            <Users className="h-4 w-4 text-slate-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-950 tabular-nums">
              {metrics.activeSeats}
            </span>
            <span className="text-xs font-medium text-[#0f766e]">
              unlimited free
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {workspace.companyName} ({workspace.industry})
          </p>
        </div>
      </div>

      {/* Filter & Primary Actions Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
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
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-[#0f766e] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span>{item.label}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                    active ? "bg-teal-900/40 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, card, supervisor…"
              className="w-full rounded-lg border border-slate-200 bg-[#f7f8fa] py-1.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={onOpenCsvModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-[#0f766e]" />
            <span>Import spreadsheet</span>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add employee</span>
          </button>
        </div>
      </div>

      {/* Inline Add Employee Panel */}
      {showAddForm && (
        <form
          onSubmit={handleCreateEmployee}
          className="rounded-xl border border-teal-200 bg-teal-50/40 p-5"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                Add an employee and their first safety card
              </h3>
              <p className="text-xs text-slate-600">
                Both the employee and supervisor will automatically get reminders before the card expires.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              aria-label="Close add employee form"
              className="rounded-md p-1 text-slate-500 hover:bg-white hover:text-slate-700"
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
              Full name *
              <input
                required
                value={newEmp.fullName}
                onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })}
                placeholder="e.g. Carlos Mendez"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Mobile phone *
              <input
                required
                value={newEmp.phone}
                onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })}
                placeholder="+15125550195"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Job title
              <input
                value={newEmp.roleTitle}
                onChange={(e) => setNewEmp({ ...newEmp, roleTitle: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Team / Department
              <input
                value={newEmp.department}
                onChange={(e) => setNewEmp({ ...newEmp, department: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Supervisor name *
              <input
                required
                value={newEmp.supervisorName}
                onChange={(e) => setNewEmp({ ...newEmp, supervisorName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Supervisor phone *
              <input
                required
                value={newEmp.supervisorPhone}
                onChange={(e) => setNewEmp({ ...newEmp, supervisorPhone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Safety card name *
              <input
                required
                value={newEmp.certName}
                onChange={(e) => setNewEmp({ ...newEmp, certName: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              Expiry date *
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
              className="rounded-lg bg-[#0f766e] px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {addBusy ? "Saving…" : "Save employee"}
            </button>
          </div>
        </form>
      )}

      {/* Certification Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {filteredRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-800">
              No safety cards match this view
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Import your team from Excel or click Add employee to start tracking expiry dates.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={onOpenCsvModal}
                className="rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Import spreadsheet
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Show all cards
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-[#f7f8fa] text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Safety card</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Supervisor</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRows.map(({ cert, employee, daysRemaining, bucket }) => {
                  const isConfirming = confirmDeleteId === employee.id;
                  return (
                    <tr key={cert.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3.5 align-top">
                        <div className="font-semibold text-slate-950">{employee.fullName}</div>
                        <div className="text-xs text-slate-500">
                          {employee.roleTitle} — {employee.department}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {employee.phone}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{cert.certName}</span>
                          {cert.ocrConfidence !== null && (
                            <span className="inline-flex items-center rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                              Scanned {Math.round(cert.ocrConfidence * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono text-slate-700">#{cert.certificateNumber}</span>
                          <span>{cert.issuingBody}</span>
                          {cert.photoKey && (
                            <button
                              type="button"
                              onClick={() =>
                                setPhotoPreviewUrl(
                                  `/api/workspaces/${encodeURIComponent(workspace.slug)}/files?key=${encodeURIComponent(cert.photoKey!)}`,
                                )
                              }
                              className="inline-flex items-center gap-1 font-medium text-[#0f766e] hover:underline"
                            >
                              <Camera className="h-3 w-3" />
                              <span>View photo</span>
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
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
                      </td>

                      <td className="px-4 py-3.5 text-right align-top">
                        {isConfirming ? (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                setConfirmDeleteId(null);
                                await onDeleteEmployee(employee.id);
                              }}
                              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                              Confirm remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onQuickRenew(employee.id, cert.id)}
                              title="Upload or scan a renewed photo of this card"
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-[#0f766e] px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800"
                            >
                              <Camera className="h-3.5 w-3.5" />
                              <span>Renew card</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenMobileLink(employee.uploadToken)}
                              title="Open worker's phone upload link"
                              aria-label={`Open mobile link for ${employee.fullName}`}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
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
                              aria-label={`Edit ${cert.certName}`}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(employee.id)}
                              title={`Remove ${employee.fullName}`}
                              aria-label={`Remove ${employee.fullName}`}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-rose-200 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline Expiry Edit Modal */}
      {editingCert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setEditingCert(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-950">
                  Update card details
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">{editingCert.certName}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCert(null)}
                aria-label="Close modal"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-slate-700">
                Card / License number
                <input
                  required
                  value={editCardNo}
                  onChange={(e) => setEditCardNo(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                New expiry date
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
                disabled={editBusy}
                className="rounded-lg bg-[#0f766e] px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                {editBusy ? "Saving…" : "Save changes"}
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
            className="w-full max-w-xl rounded-xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">
                Saved safety card photo
              </span>
              <button
                type="button"
                onClick={() => setPhotoPreviewUrl(null)}
                aria-label="Close photo preview"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={photoPreviewUrl}
              alt="Certification card proof"
              className="max-h-[420px] w-full rounded-lg border border-slate-200 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
