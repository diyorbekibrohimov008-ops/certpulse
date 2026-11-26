import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { buildSampleSpreadsheetTsv } from "../lib/seed";

interface SetupWizardModalProps {
  onClose: () => void;
  onCompleteSetup: (payload: {
    companyName: string;
    industry: string;
    billingEmail: string;
    spreadsheetText?: string;
    setupDurationSeconds: number;
  }) => Promise<void>;
}

export function SetupWizardModal({
  onClose,
  onCompleteSetup,
}: SetupWizardModalProps) {
  const [startedAt] = useState(() => Date.now());
  const [step, setStep] = useState<1 | 2>(1);
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("Electrical & Field Service");
  const [adminEmail, setAdminEmail] = useState("");
  const [spreadsheetText, setSpreadsheetText] = useState(() => buildSampleSpreadsheetTsv());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleFinish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const elapsedSeconds = Math.max(
        12,
        Math.round((Date.now() - startedAt) / 1000),
      );
      await onCompleteSetup({
        companyName,
        industry,
        billingEmail: adminEmail,
        spreadsheetText: spreadsheetText.trim() || undefined,
        setupDurationSeconds: elapsedSeconds,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create company workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <span className="inline-flex items-center rounded-md bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
              Step {step} of 2
            </span>
            <h2 className="mt-2 text-lg font-bold text-slate-950">
              Create a company workspace
            </h2>
            <p className="text-xs text-slate-500">
              100% free forever with unlimited employees, photo card scanning, and automatic reminders.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleFinish} className="mt-5 space-y-4">
          {step === 1 ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Company name *
                  <input
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Apex Roofing & Solar"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Trade / Industry
                  <input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="block text-xs font-semibold text-slate-700">
                Safety admin email *
                <input
                  required
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="safety@apexroofing.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-[#f7f8fa] p-4 text-xs text-slate-600">
                <p className="font-semibold text-slate-900">Included automatically</p>
                <ul className="mt-2 space-y-1.5">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" />
                    <span>60, 30, and 7-day automatic reminders for workers and supervisors</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" />
                    <span>Mobile photo upload links that read card expiry dates automatically</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" />
                    <span>Unlimited employees and cards — $0/mo forever</span>
                  </li>
                </ul>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!companyName.trim() || !adminEmail.trim()}
                  onClick={() => setStep(2)}
                  className="rounded-lg bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  Next: Add team list
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Paste your existing spreadsheet (optional)
                  </span>
                  <button
                    type="button"
                    onClick={() => setSpreadsheetText("")}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    Start empty instead
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={spreadsheetText}
                  onChange={(e) => setSpreadsheetText(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-[#f7f8fa] p-3 font-mono text-xs text-slate-800"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-[#0f766e] px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create workspace"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
