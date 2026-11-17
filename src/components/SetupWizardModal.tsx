import { useState } from "react";
import { ArrowRight, CheckCircle2, Clock, Sparkles, X } from "lucide-react";
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
  const [billingEmail, setBillingEmail] = useState("");
  const [spreadsheetText, setSpreadsheetText] = useState(() => buildSampleSpreadsheetTsv());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        billingEmail,
        spreadsheetText: spreadsheetText.trim() || undefined,
        setupDurationSeconds: elapsedSeconds,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch workspace.");
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
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              <Clock className="h-3.5 w-3.5" />
              <span>Zero Sales Calls · 5-Minute Self-Serve Setup</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900">
              Launch a New Company Compliance Workspace
            </h2>
            <p className="text-xs text-slate-500">
              Skip the $3,000+ enterprise onboarding fees. Go live with 60/30/7-day alerts right away.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
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
                  Company Name *
                  <input
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Apex Roofing & Solar"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Industry / Trade
                  <input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="block text-xs font-semibold text-slate-700">
                Admin / Billing Email *
                <input
                  required
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="safety@apexroofing.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Pre-Configured Out of the Box</span>
                </div>
                <ul className="mt-2 space-y-1">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>60, 30, and 7-day automated SMS + Email alerts to workers & supervisors</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Dedicated mobile MMS photo upload links & OCR card date extraction</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>$29/mo flat up to 25 employees (14-day free self-serve trial)</span>
                  </li>
                </ul>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!companyName.trim() || !billingEmail.trim()}
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <span>Next: Import Crew Roster</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    Step 2 of 2: Paste Existing Excel Roster (Optional)
                  </span>
                  <button
                    type="button"
                    onClick={() => setSpreadsheetText("")}
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    Start Empty Instead
                  </button>
                </div>
                <textarea
                  rows={6}
                  value={spreadsheetText}
                  onChange={(e) => setSpreadsheetText(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800"
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
                  className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {busy ? "Creating Workspace…" : "Finish & Launch Workspace"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
