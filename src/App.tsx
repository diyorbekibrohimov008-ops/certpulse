import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Loader2,
  PlusCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { AlertsConsole } from "./components/AlertsConsole";
import { BillingModal } from "./components/BillingModal";
import { CsvImportModal } from "./components/CsvImportModal";
import { MobileWorkerPortal } from "./components/MobileWorkerPortal";
import { OverviewMatrix } from "./components/OverviewMatrix";
import { SetupWizardModal } from "./components/SetupWizardModal";
import { SmsRenewalStudio } from "./components/SmsRenewalStudio";
import { apiClient, type WorkspacePayload } from "./lib/api-client";
import { DEMO_WORKSPACE_SLUG } from "./lib/seed";
import type { AlertRule, Certification, WorkspaceSummary } from "./lib/types";

type ActiveTab = "overview" | "sms" | "alerts";

function readMobileTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const match = /^\/m\/([^/]+)\/?$/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [mobileToken, setMobileToken] = useState<string | null>(() =>
    readMobileTokenFromLocation(),
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>(DEMO_WORKSPACE_SLUG);
  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [preselectedEmpId, setPreselectedEmpId] = useState<string | null>(null);
  const [preselectedCertId, setPreselectedCertId] = useState<string | null>(null);

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setMobileToken(readMobileTokenFromLocation());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refreshWorkspace = useCallback(async (slugToLoad: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [listRes, wsRes] = await Promise.all([
        apiClient.listWorkspaces(),
        apiClient.getWorkspace(slugToLoad),
      ]);
      setWorkspaces(listRes.workspaces);
      setData(wsRes);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load compliance data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mobileToken) {
      void refreshWorkspace(activeSlug);
    }
  }, [activeSlug, mobileToken, refreshWorkspace]);

  function openMobilePortal(token: string) {
    window.history.pushState({}, "", `/m/${encodeURIComponent(token)}`);
    setMobileToken(token);
  }

  function exitMobilePortal() {
    window.history.pushState({}, "", "/");
    setMobileToken(null);
  }

  if (mobileToken) {
    return <MobileWorkerPortal token={mobileToken} onExitPortal={exitMobilePortal} />;
  }

  async function handleAddEmployee(input: {
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
  }) {
    const res = await apiClient.addEmployee(activeSlug, input);
    setData({ workspace: res.workspace, metrics: res.metrics });
    const listRes = await apiClient.listWorkspaces();
    setWorkspaces(listRes.workspaces);
  }

  async function handleDeleteEmployee(employeeId: string) {
    const res = await apiClient.deleteEmployee(activeSlug, employeeId);
    setData({ workspace: res.workspace, metrics: res.metrics });
    const listRes = await apiClient.listWorkspaces();
    setWorkspaces(listRes.workspaces);
  }

  async function handleUpdateCertExpiry(
    cert: Certification,
    newExpiryDate: string,
    newCertNumber: string,
  ) {
    const res = await apiClient.upsertCertification(activeSlug, {
      id: cert.id,
      employeeId: cert.employeeId,
      certName: cert.certName,
      certificateNumber: newCertNumber,
      issuingBody: cert.issuingBody,
      issuedDate: cert.issuedDate,
      expiryDate: newExpiryDate,
    });
    setData({ workspace: res.workspace, metrics: res.metrics });
  }

  async function handleCompleteWizard(payload: {
    companyName: string;
    industry: string;
    billingEmail: string;
    spreadsheetText?: string;
    setupDurationSeconds: number;
  }) {
    const created = await apiClient.createWorkspace({
      companyName: payload.companyName,
      industry: payload.industry,
      billingEmail: payload.billingEmail,
      setupDurationSeconds: payload.setupDurationSeconds,
    });

    if (payload.spreadsheetText) {
      const imported = await apiClient.importSpreadsheet(
        created.workspace.slug,
        payload.spreadsheetText,
      );
      setData({ workspace: imported.workspace, metrics: imported.metrics });
    } else {
      setData(created);
    }

    const listRes = await apiClient.listWorkspaces();
    setWorkspaces(listRes.workspaces);
    setActiveSlug(created.workspace.slug);
    setActiveTab("overview");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Command Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold tracking-tight text-slate-900">
                    CertPulse
                  </span>
                  <span className="hidden rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 sm:inline-block">
                    $29/mo Flat · 25 Seats
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Text-to-OCR renewals & automated 60/30/7 compliance alerts
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {workspaces.length > 0 && (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <Building2 className="h-3.5 w-3.5 text-slate-500" />
                  <select
                    aria-label="Switch company workspace"
                    value={activeSlug}
                    onChange={(e) => setActiveSlug(e.target.value)}
                    className="bg-transparent text-xs font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
                  >
                    {workspaces.map((ws) => (
                      <option key={ws.slug} value={ws.slug}>
                        {ws.companyName} ({ws.seatCount}/{ws.seatLimit})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowSetupWizard(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <PlusCircle className="h-3.5 w-3.5 text-blue-600" />
                <span>5-Min Setup</span>
              </button>

              {data && (
                <button
                  type="button"
                  onClick={() => setShowBillingModal(true)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    data.workspace.billing.status === "active"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {data.workspace.billing.status === "active" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  <span>
                    {data.workspace.billing.status === "active"
                      ? `${data.workspace.billing.planName}`
                      : "Activate $29/mo Plan"}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="-mb-px flex items-center gap-6 overflow-x-auto text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`inline-flex items-center gap-2 border-b-2 py-2.5 whitespace-nowrap transition ${
                activeTab === "overview"
                  ? "border-blue-700 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              <span>Roster & Expiries</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sms")}
              className={`inline-flex items-center gap-2 border-b-2 py-2.5 whitespace-nowrap transition ${
                activeTab === "sms"
                  ? "border-blue-700 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              <span>Text-to-OCR Studio</span>
              {data && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 tabular-nums">
                  {data.workspace.smsMessages.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("alerts")}
              className={`inline-flex items-center gap-2 border-b-2 py-2.5 whitespace-nowrap transition ${
                activeTab === "alerts"
                  ? "border-blue-700 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <BellRing className="h-4 w-4" />
              <span>60 / 30 / 7 Alerts</span>
              {data && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 tabular-nums">
                  {data.workspace.alertDeliveries.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {loading && !data ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-20 text-xs text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <p className="mt-3 font-medium">Loading live compliance workspace…</p>
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm font-medium text-rose-800">
            {loadError}
          </div>
        ) : data ? (
          <>
            {activeTab === "overview" && (
              <OverviewMatrix
                workspace={data.workspace}
                metrics={data.metrics}
                onQuickRenew={(empId, certId) => {
                  setPreselectedEmpId(empId);
                  setPreselectedCertId(certId);
                  setActiveTab("sms");
                }}
                onOpenMobileLink={openMobilePortal}
                onOpenCsvModal={() => setShowCsvModal(true)}
                onOpenBillingModal={() => setShowBillingModal(true)}
                onAddEmployee={handleAddEmployee}
                onDeleteEmployee={handleDeleteEmployee}
                onUpdateCertificationExpiry={handleUpdateCertExpiry}
              />
            )}

            {activeTab === "sms" && (
              <SmsRenewalStudio
                workspace={data.workspace}
                preselectedEmployeeId={preselectedEmpId}
                preselectedCertId={preselectedCertId}
                onPreviewOcr={async (formData) => {
                  const res = await apiClient.previewOcr(activeSlug, formData);
                  return res.extraction;
                }}
                onSubmitRenewal={async (formData) => {
                  const res = await apiClient.submitSmsRenewal(activeSlug, formData);
                  setData({ workspace: res.workspace, metrics: res.metrics });
                  return {
                    extraction: res.extraction,
                    certificationName: res.certification.certName,
                    newExpiryDate: res.certification.expiryDate,
                  };
                }}
              />
            )}

            {activeTab === "alerts" && (
              <AlertsConsole
                workspace={data.workspace}
                onRunSweep={async () => {
                  const res = await apiClient.runAlertSweep(activeSlug);
                  setData({ workspace: res.workspace, metrics: res.metrics });
                  return {
                    dispatchedCount: res.dispatchedCount,
                    skippedDeduplicated: res.skippedDeduplicated,
                  };
                }}
                onSaveRules={async (rules: AlertRule[]) => {
                  const res = await apiClient.saveAlertRules(activeSlug, rules);
                  setData((prev) =>
                    prev ? { ...prev, workspace: res.workspace } : prev,
                  );
                }}
                onResetRules={async () => {
                  const res = await apiClient.resetAlertRules(activeSlug);
                  setData((prev) =>
                    prev ? { ...prev, workspace: res.workspace } : prev,
                  );
                }}
              />
            )}
          </>
        ) : null}
      </main>

      {/* Modals */}
      {showCsvModal && data && (
        <CsvImportModal
          currentSeatCount={data.metrics.activeSeats}
          seatLimit={data.workspace.billing.seatLimit}
          onClose={() => setShowCsvModal(false)}
          onImport={async (rawText) => {
            const res = await apiClient.importSpreadsheet(activeSlug, rawText);
            setData({ workspace: res.workspace, metrics: res.metrics });
            const listRes = await apiClient.listWorkspaces();
            setWorkspaces(listRes.workspaces);
            return {
              addedEmployees: res.addedEmployees,
              addedCertifications: res.addedCertifications,
              updatedCertifications: res.updatedCertifications,
            };
          }}
        />
      )}

      {showSetupWizard && (
        <SetupWizardModal
          onClose={() => setShowSetupWizard(false)}
          onCompleteSetup={handleCompleteWizard}
        />
      )}

      {showBillingModal && data && (
        <BillingModal
          billing={data.workspace.billing}
          activeSeats={data.metrics.activeSeats}
          hasStripeConfig={data.workspace.integrations.hasStripeConfig}
          onClose={() => setShowBillingModal(false)}
          onCheckout={async (input) => {
            const res = await apiClient.checkoutPlan(activeSlug, input);
            setData({ workspace: res.workspace, metrics: res.metrics });
            const listRes = await apiClient.listWorkspaces();
            setWorkspaces(listRes.workspaces);
          }}
        />
      )}
    </div>
  );
}
