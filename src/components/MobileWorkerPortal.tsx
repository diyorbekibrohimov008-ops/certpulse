import { useCallback, useEffect, useState } from "react";
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

  const loadPortal = useCallback(async (resetSelection = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getMobilePortal(token);
      setCompanyName(data.companyName);
      setPortalSmsNumber(data.portalSmsNumber);
      setEmployee(data.employee);
      setCertifications(data.certifications);
      setSelectedCertId((prev) => {
        if (!resetSelection && prev && data.certifications.some((c) => c.id === prev)) {
          return prev;
        }
        return data.certifications[0]?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load mobile upload page.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPortal(true);
  }, [loadPortal]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !employee) return;
    setError(null);
    setSuccessMsg(null);
    setBusyStatus("Reading expiry date from your card…");

    let ocrText = "";
    try {
      ocrText = await runBrowserTesseractOcr(file, (pct) => {
        setBusyStatus(`Scanning photo (${pct}%)…`);
      });
    } catch {
      // Server pattern / Vision AI handles extraction if offline
    }

    setBusyStatus("Uploading and saving your renewed card…");
    try {
      const form = new FormData();
      form.append("photo", file);
      if (selectedCertId) form.append("certificationId", selectedCertId);
      if (ocrText) form.append("rawOcrText", ocrText);
      form.append("messageText", "Uploaded via worker mobile link");

      const res = await apiClient.submitMobileRenewal(token, form);
      setSuccessMsg(
        `All set! ${res.certification.certName} is updated with new expiry ${res.certification.expiryDate}.`,
      );
      await loadPortal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f8fa] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#0f766e] px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onExitPortal}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/25"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to roster</span>
            </button>
            <div className="inline-flex items-center gap-1 text-xs font-semibold text-teal-100">
              <ShieldCheck className="h-4 w-4" />
              <span>CertPulse Mobile</span>
            </div>
          </div>

          {!loading && employee && (
            <div className="mt-4">
              <p className="text-xs font-medium text-teal-100">{companyName}</p>
              <h1 className="mt-0.5 text-xl font-bold">{employee.fullName}</h1>
              <p className="text-xs text-teal-50">
                {employee.roleTitle} — or text a photo to{" "}
                <span className="font-mono font-semibold text-white">{portalSmsNumber}</span>
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4 p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-[#0f766e]" />
              <span>Loading your safety cards…</span>
            </div>
          ) : error && !employee ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700">
              {error}
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xs font-semibold text-slate-700">
                  1. Choose the card you renewed
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
                            ? "border-[#0f766e] bg-teal-50/60 ring-2 ring-teal-600/20"
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
                                    : "bg-teal-100 text-teal-800"
                            }`}
                          >
                            {meta.shortLabel}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-slate-500">
                          Card #{cert.certificateNumber} — Expires {cert.expiryDate}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/40 p-5 text-center">
                <Camera className="mx-auto h-7 w-7 text-[#0f766e]" />
                <p className="mt-2 text-sm font-bold text-slate-950">
                  2. Take a photo of your new card
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  We read the new expiry date automatically — no typing needed.
                </p>

                <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#0f766e] px-5 py-2.5 text-xs font-semibold text-white hover:bg-teal-800">
                  <Upload className="h-4 w-4" />
                  <span>{busyStatus ? "Uploading…" : "Take or choose photo"}</span>
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
                <div className="flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2.5 text-xs font-semibold text-teal-900">
                  <Loader2 className="h-4 w-4 animate-spin text-[#0f766e]" />
                  <span>{busyStatus}</span>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              {successMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-3 text-xs font-semibold text-teal-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0f766e]" />
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
