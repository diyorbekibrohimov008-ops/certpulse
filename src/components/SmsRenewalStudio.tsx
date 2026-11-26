import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileCheck2,
  Loader2,
  MessageSquare,
  Send,
  Upload,
} from "lucide-react";
import {
  generateSampleCardPng,
  runBrowserTesseractOcr,
  type SampleCardKind,
} from "../lib/card-generator";
import type { OcrExtractionResult, Workspace } from "../lib/types";

interface SmsRenewalStudioProps {
  workspace: Workspace;
  preselectedEmployeeId?: string | null;
  preselectedCertId?: string | null;
  onSubmitRenewal: (formData: FormData) => Promise<{
    extraction: OcrExtractionResult;
    certificationName: string;
    newExpiryDate: string;
  }>;
  onPreviewOcr: (formData: FormData) => Promise<OcrExtractionResult>;
}

export function SmsRenewalStudio({
  workspace,
  preselectedEmployeeId,
  preselectedCertId,
  onSubmitRenewal,
  onPreviewOcr,
}: SmsRenewalStudioProps) {
  const defaultEmp =
    workspace.employees.find((e) => e.id === preselectedEmployeeId) ??
    workspace.employees[0];

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    defaultEmp?.id ?? "",
  );
  const [selectedCertId, setSelectedCertId] = useState<string>(
    preselectedCertId ?? "",
  );
  const [messageText, setMessageText] = useState(
    "Here is a photo of my renewed safety card.",
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [rawOcrText, setRawOcrText] = useState<string>("");
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<OcrExtractionResult | null>(null);
  const [overrideExpiry, setOverrideExpiry] = useState("");
  const [overrideCardNumber, setOverrideCardNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (preselectedEmployeeId) {
      setSelectedEmployeeId(preselectedEmployeeId);
    }
    if (preselectedCertId) {
      setSelectedCertId(preselectedCertId);
    }
  }, [preselectedEmployeeId, preselectedCertId]);

  const activeEmployee =
    workspace.employees.find((e) => e.id === selectedEmployeeId) ??
    workspace.employees[0];
  const employeeCerts = workspace.certifications.filter(
    (c) => c.employeeId === activeEmployee?.id,
  );

  useEffect(() => {
    if (!employeeCerts.some((c) => c.id === selectedCertId)) {
      setSelectedCertId(employeeCerts[0]?.id ?? "");
    }
  }, [activeEmployee?.id, employeeCerts, selectedCertId]);

  async function processFileThroughOcr(file: File, fallbackText?: string) {
    setError(null);
    setBanner(null);
    setSelectedFile(file);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const localUrl = URL.createObjectURL(file);
    previewUrlRef.current = localUrl;
    setPreviewUrl(localUrl);
    setOcrProgress("Reading text from card photo…");

    let recognizedText = "";
    try {
      recognizedText = await runBrowserTesseractOcr(file, (pct) => {
        setOcrProgress(`Scanning card text (${pct}%)…`);
      });
    } catch {
      // Offline / CDN unreachable fallback seamlessly handled below
    }

    const effectiveOcrText =
      recognizedText.trim().length > 10 ? recognizedText : fallbackText || "";
    setRawOcrText(effectiveOcrText);
    setOcrProgress("Checking expiry date & card number…");

    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("messageText", messageText);
      if (effectiveOcrText) {
        form.append("rawOcrText", effectiveOcrText);
      }
      const res = await onPreviewOcr(form);
      setExtraction(res);
      setOverrideExpiry(res.expiryDate ?? "");
      setOverrideCardNumber(res.certificateNumber ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read card photo.");
    } finally {
      setOcrProgress(null);
    }
  }

  async function handleGenerateSampleCard(kind: SampleCardKind) {
    if (!activeEmployee) return;
    setError(null);
    const generated = await generateSampleCardPng({
      kind,
      holderName: activeEmployee.fullName,
    });
    await processFileThroughOcr(generated.file, generated.canonicalText);
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFileThroughOcr(file);
  }

  async function handleTextIntoPortal(e: React.FormEvent) {
    e.preventDefault();
    if (!activeEmployee) return;
    setError(null);
    setBanner(null);
    setBusy(true);

    try {
      const form = new FormData();
      form.append("employeeId", activeEmployee.id);
      if (selectedCertId) form.append("certificationId", selectedCertId);
      form.append("fromPhone", activeEmployee.phone);
      form.append("messageText", messageText);
      if (rawOcrText) form.append("rawOcrText", rawOcrText);
      if (overrideExpiry) form.append("overrideExpiryDate", overrideExpiry);
      if (overrideCardNumber) {
        form.append("overrideCertificateNumber", overrideCardNumber);
      }
      if (selectedFile) {
        form.append("photo", selectedFile);
      }

      const result = await onSubmitRenewal(form);
      setBanner(
        `Saved! Updated ${activeEmployee.fullName}'s ${result.certificationName} to expire on ${result.newExpiryDate}.`,
      );
      setExtraction(result.extraction);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save renewed card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Card Renewal Form */}
      <form
        onSubmit={handleTextIntoPortal}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7"
      >
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-lg font-bold text-slate-950">
            Upload or test a renewed safety card
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload a card photo (or try a sample below). CertPulse reads the expiry date automatically and updates the team roster. Workers can also text photos to{" "}
            <span className="font-mono font-semibold text-slate-800">
              {workspace.integrations.portalSmsNumber}
            </span>
            .
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-700">
            1. Employee
            <select
              value={activeEmployee?.id ?? ""}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {workspace.employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName} ({emp.phone})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-slate-700">
            Safety card to update
            <select
              value={selectedCertId}
              onChange={(e) => setSelectedCertId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {employeeCerts.map((cert) => (
                <option key={cert.id} value={cert.id}>
                  {cert.certName} (Expires {cert.expiryDate})
                </option>
              ))}
              {employeeCerts.length === 0 && (
                <option value="">Add as a new card automatically</option>
              )}
            </select>
          </label>
        </div>

        {/* Upload or Sample Card */}
        <div className="rounded-xl border border-dashed border-slate-300 bg-[#f7f8fa] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-900">
                2. Upload a card photo or try a sample card
              </div>
              <p className="text-xs text-slate-500">
                We scan the image in your browser and fill in the new expiry date for you.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5 text-[#0f766e]" />
              <span>Upload photo</span>
              <input
                type="file"
                accept="image/*,.pdf"
                capture="environment"
                onChange={handleFileInput}
                className="hidden"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleGenerateSampleCard("cpr")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-teal-300 hover:bg-teal-50"
            >
              <Camera className="h-3.5 w-3.5 text-[#0f766e]" />
              <span>Try sample CPR card</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateSampleCard("osha30")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-teal-300 hover:bg-teal-50"
            >
              <Camera className="h-3.5 w-3.5 text-[#0f766e]" />
              <span>Try sample OSHA 30 card</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateSampleCard("cdl")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:border-teal-300 hover:bg-teal-50"
            >
              <Camera className="h-3.5 w-3.5 text-[#0f766e]" />
              <span>Try sample CDL card</span>
            </button>
          </div>

          {ocrProgress && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#0f766e]" />
              <span>{ocrProgress}</span>
            </div>
          )}

          {previewUrl && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img
                src={previewUrl}
                alt="Attached safety card preview"
                className="max-h-52 w-full object-contain"
              />
            </div>
          )}
        </div>

        {/* Detected Fields */}
        {extraction && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-950">
                <FileCheck2 className="h-4 w-4 text-[#0f766e]" />
                <span>
                  3. Confirm detected details ({Math.round(extraction.confidence * 100)}% match)
                </span>
              </div>
              <span className="rounded bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                {extraction.category}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">
                Expiry date
                <input
                  type="date"
                  value={overrideExpiry}
                  onChange={(e) => setOverrideExpiry(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Card number
                <input
                  type="text"
                  value={overrideCardNumber}
                  onChange={(e) => setOverrideCardNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-teal-300 bg-white px-2.5 py-1.5 font-mono text-sm"
                />
              </label>
            </div>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-700">
          Optional note from employee
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="e.g. Renewed OSHA 30 expires 2029-11-10"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        {banner && (
          <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs font-semibold text-teal-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0f766e]" />
            <span>{banner}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500">
            Saves the card photo, updates the expiry date, and resets upcoming reminders.
          </p>
          <button
            type="submit"
            disabled={busy || !activeEmployee}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            <span>{busy ? "Saving…" : "Save renewed card"}</span>
          </button>
        </div>
      </form>

      {/* Right: Recent Card Messages */}
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white lg:col-span-5">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#0f766e]" />
            <h3 className="text-sm font-bold text-slate-950">Recent card messages</h3>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
            {workspace.smsMessages.length} total
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "560px" }}>
          {workspace.smsMessages.length === 0 ? (
            <p className="py-12 text-center text-xs text-slate-400">
              No card messages yet. Try uploading a sample card on the left.
            </p>
          ) : (
            workspace.smsMessages.map((msg) => {
              const isInbound = msg.direction === "inbound";
              return (
                <div
                  key={msg.id}
                  className={`rounded-xl border p-3.5 text-xs ${
                    isInbound
                      ? "border-slate-200 bg-[#f7f8fa] text-slate-800"
                      : "border-teal-200 bg-teal-50/60 text-slate-900"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      {isInbound ? `${msg.employeeName}` : `CertPulse to ${msg.employeeName}`}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="leading-relaxed text-slate-700">{msg.body}</p>
                  {msg.extractedSummary && (
                    <div className="mt-2 rounded-md bg-teal-100/70 px-2 py-1 font-mono text-[11px] font-medium text-teal-950">
                      {msg.extractedSummary}
                    </div>
                  )}
                  {msg.mediaKey && (
                    <img
                      src={`/api/workspaces/${encodeURIComponent(workspace.slug)}/files?key=${encodeURIComponent(msg.mediaKey)}`}
                      alt="Uploaded safety card"
                      className="mt-2 max-h-36 w-full rounded-lg border border-slate-200 bg-white object-contain"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
