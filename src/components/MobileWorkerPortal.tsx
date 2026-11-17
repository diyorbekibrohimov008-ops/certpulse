import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { apiClient } from "../lib/api-client";
import { runBrowserTesseractOcr } from "../lib/card-generator";
import { getBucketMeta, getComplianceBucket, getDaysRemaining } from "../lib/compliance";
import type { Certification, Employee } from "../lib/types";

interface MobileWorkerPortalProps {
  token: string;
  onExitPortal: () => void;
}

export function MobileWorkerPortal({ token, onExitPortal }: MobileWorkerPortalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [portalSmsNumber, setPortalSmsNumber] = useState("");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [selectedCertId, setSelectedCertId] = useState("");
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function loadPortal() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMobilePortal(token);
      setCompanyName(data.companyName);
      setPortalSmsNumber(data.portalSmsNumber);
      setEmployee(data.employee);
      setCertifications(data.certifications);
      if (data.certifications[0] && !selectedCertId) {
        setSelectedCertId(data.certifications[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load mobile upload portal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPortal();
  }, [token]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !employee) return;
    setError(null);
    setSuccessMsg(null);
    setBusyStatus("Scanning card pixels with OCR…");

    let ocrText = "";
    try {
      ocrText = await runBrowserTesseractOcr(file, (pct) => {
        setBusyStatus(`Scanning photo OCR (${pct}%)…`);
      });
    } catch {
      // Server pattern / Vision AI handles extraction if offline
    }

    setBusyStatus("Uploading & updating compliance record…");
    try {
      const form = new FormData();
      form.append("photo", file);
      if (selectedCertId) form.append("certificationId", selectedCertId);
      if (ocrText) form.append("rawOcrText", ocrText);
      form.append("messageText", "Uploaded via worker mobile portal link");

      const res = await apiClient.submitMobileRenewal(token, form);
      setSuccessMsg(
        `Verified! ${res.certification.certName} updated with new expiry ${res.certification.expiryDate}.`,
      );
      await loadPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl border border-slate-700 bg-white shadow-2xl">
        <div className="bg-slate-950 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onExitPortal}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Admin View</span>
            </button>
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span>CertPulse Mobile</span>
            </div>
          </div>

          {!loading && employee && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {companyName}
              </p>
              <h1 className="mt-0.5 text-xl font-bold">{employee.fullName}</h1>
              <p className="text-xs text-slate-300">
                {employee.roleTitle} · Or MMS photo directly to{" "}
                <span className="font-mono font-semibold text-white">{portalSmsNumber}</span>
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4 p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading worker credentials…</span>
            </div>
          ) : error && !employee ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
              {error}
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  1. Select Credential to Renew
                </h2>
                <div className="mt-2 space-y-2">
                  {certifications.map((cert) => {
                    const days = getDaysRemaining(cert.expiryDate);
                    const meta = getBucketMeta(getComplianceBucket(days));
                    const active = selectedCertId === cert.id;
                    return (
                      <button
                        key={cert.id}
                        type="button"
                        onClick={() => setSelectedCertId(cert.id)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? "border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {cert.certName}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              meta.tone === "rose"
                                ? "bg-rose-100 text-rose-800"
                                : meta.tone === "orange"
                                  ? "bg-orange-100 text-orange-800"
                                  : meta.tone === "amber"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {meta.shortLabel}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-slate-500">
                          Card #{cert.certificateNumber} · Exp {cert.expiryDate}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-blue-300 bg-blue-50/50 p-5 text-center">
                <Camera className="mx-auto h-7 w-7 text-blue-700" />
                <p className="mt-2 text-sm font-bold text-slate-900">
                  2. Take Photo of Renewed Card
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  AI OCR reads the new expiry date automatically — no manual typing needed.
                </p>

                <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-800">
                  <Upload className="h-4 w-4" />
                  <span>{busyStatus ? "Processing…" : "Snap / Choose Card Photo"}</span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    capture="environment"
                    onChange={handlePhotoUpload}
                    disabled={Boolean(busyStatus)}
                    className="hidden"
                  />
                </label>
              </div>

              {busyStatus && (
                <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{busyStatus}</span>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs font-semibold text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{successMsg}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
