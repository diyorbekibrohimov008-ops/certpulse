import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload, X } from "lucide-react";
import { parseSpreadsheetInput } from "../lib/csv-importer";
import { buildSampleSpreadsheetTsv } from "../lib/seed";

interface CsvImportModalProps {
  currentSeatCount: number;
  seatLimit: number;
  onClose: () => void;
  onImport: (rawText: string) => Promise<{
    addedEmployees: number;
    addedCertifications: number;
    updatedCertifications: number;
  }>;
}

export function CsvImportModal({
  currentSeatCount,
  seatLimit,
  onClose,
  onImport,
}: CsvImportModalProps) {
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseSpreadsheetInput(rawText);
  }, [rawText]);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setRawText(reader.result);
      }
    };
    reader.readAsText(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultMsg(null);
    setBusy(true);
    try {
      const res = await onImport(rawText);
      setResultMsg(
        `Imported ${res.addedEmployees} new employee(s), ${res.addedCertifications} new certification(s), and updated ${res.updatedCertifications} existing card(s).`,
      );
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spreadsheet import failed.");
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
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Ditch Manual Spreadsheets in 30 Seconds</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900">
              Paste Directly From Excel / Google Sheets or Upload CSV
            </h2>
            <p className="text-xs text-slate-500">
              Supports tab-separated Excel copy-paste and CSV. Currently using{" "}
              <span className="font-semibold text-slate-800">
                {currentSeatCount}/{seatLimit}
              </span>{" "}
              included seats.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setRawText(buildSampleSpreadsheetTsv())}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Load Sample 4-Worker Excel Paste
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5 text-blue-600" />
              <span>Choose .csv / .tsv File</span>
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={7}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste header + rows here (Employee Name, Phone, Supervisor Name, Supervisor Phone, Certification, Card #, Expiry Date)…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-sky-600 focus:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          />

          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  Detected {preview.delimiter.toUpperCase()} · {preview.rows.length} valid row(s) across{" "}
                  {preview.uniqueEmployeeCount} unique worker(s)
                </span>
                {preview.errors.length > 0 && (
                  <span className="font-semibold text-rose-700">
                    {preview.errors.length} row issue(s) skipped
                  </span>
                )}
              </div>
              {preview.rows.length > 0 && (
                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-600">
                  {preview.rows.slice(0, 5).map((r) => (
                    <div key={r.rowIndex}>
                      Row {r.rowIndex}: {r.fullName} · {r.certName} · Exp {r.expiryDate} · Sup:{" "}
                      {r.supervisorName}
                    </div>
                  ))}
                </div>
              )}
              {preview.errors[0] && (
                <div className="mt-2 flex items-center gap-1.5 text-rose-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Row {preview.errors[0].rowIndex}: {preview.errors[0].message}
                  </span>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {resultMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>{resultMsg}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !preview || preview.rows.length === 0}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${preview?.rows.length ?? 0} Rows & Enable Alerts`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
