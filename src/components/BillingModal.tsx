import { useState } from "react";
import { Check, CreditCard, Lock, ShieldCheck, X } from "lucide-react";
import type { BillingInfo } from "../lib/types";

interface BillingModalProps {
  billing: BillingInfo;
  activeSeats: number;
  hasStripeConfig: boolean;
  onClose: () => void;
  onCheckout: (input: {
    planId: "smb_25" | "smb_growth_50";
    billingEmail: string;
    cardNumber: string;
    cardBrand?: string;
    expiry?: string;
    cvc?: string;
  }) => Promise<void>;
}

export function BillingModal({
  billing,
  activeSeats,
  hasStripeConfig,
  onClose,
  onCheckout,
}: BillingModalProps) {
  const [planId, setPlanId] = useState<"smb_25" | "smb_growth_50">(
    billing.planId === "smb_growth_50" ? "smb_growth_50" : "smb_25",
  );
  const [billingEmail, setBillingEmail] = useState(billing.billingEmail);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("11/29");
  const [cvc, setCvc] = useState("842");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDoneMsg(null);
    setBusy(true);
    try {
      await onCheckout({
        planId,
        billingEmail,
        cardNumber,
        expiry,
        cvc,
      });
      setDoneMsg(
        `Subscription activated (${planId === "smb_growth_50" ? "$59/mo · 50 seats" : "$29/mo · 25 seats"}). Receipt sent to ${billingEmail}.`,
      );
      setTimeout(onClose, 950);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment processing failed.");
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
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Self-Serve SMB Pricing · No Contracts · $0 Setup Fee</span>
            </div>
            <h2 className="mt-2 text-lg font-bold text-slate-900">
              Activate Your Flat-Rate Compliance Plan
            </h2>
            <p className="text-xs text-slate-500">
              Using {activeSeats} of {billing.seatLimit} seats · Enterprise suites charge $3,000+ onboarding & require sales calls.
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

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Plan Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPlanId("smb_25")}
              className={`rounded-xl border p-4 text-left transition ${
                planId === "smb_25"
                  ? "border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">SMB Flat 25</span>
                <span className="rounded bg-blue-700 px-2 py-0.5 text-[10px] font-bold text-white">
                  POPULAR
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-slate-900 tabular-nums">$29</span>
                <span className="text-xs text-slate-500">/month flat</span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-600">
                Up to 25 employees · Unlimited certs
              </p>
              <ul className="mt-2.5 space-y-1 text-[11px] text-slate-600">
                <li className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span>Text-to-OCR mobile card renewal</span>
                </li>
                <li className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span>60 / 30 / 7 worker + supervisor alerts</span>
                </li>
              </ul>
            </button>

            <button
              type="button"
              onClick={() => setPlanId("smb_growth_50")}
              className={`rounded-xl border p-4 text-left transition ${
                planId === "smb_growth_50"
                  ? "border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">Growth Multi-Crew</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-slate-900 tabular-nums">$59</span>
                <span className="text-xs text-slate-500">/month flat</span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-600">
                Up to 50 employees · Multi-crew
              </p>
              <ul className="mt-2.5 space-y-1 text-[11px] text-slate-600">
                <li className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span>Everything in SMB Flat 25</span>
                </li>
                <li className="flex items-center gap-1">
                  <Check className="h-3 w-3 text-emerald-600" />
                  <span>Double seat capacity for expanding shops</span>
                </li>
              </ul>
            </button>
          </div>

          {/* Credit Card Self-Serve Checkout */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
              <span className="inline-flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <span>Direct Credit Card Checkout</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Lock className="h-3 w-3" />
                {hasStripeConfig ? "Live Stripe" : "Test Checkout Mode"}
              </span>
            </div>

            <label className="block text-xs font-medium text-slate-700">
              Receipt & Invoice Email
              <input
                required
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <label className="block text-xs font-medium text-slate-700 sm:col-span-3">
                Card Number
                <input
                  required
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
                Expiration
                <input
                  required
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700 sm:col-span-1">
                CVC
                <input
                  required
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                />
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {doneMsg && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              {doneMsg}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500">
              {billing.cardLast4
                ? `Current card: ${billing.cardBrand} •••• ${billing.cardLast4}`
                : "Cancel anytime with 1 click."}
            </span>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {busy
                ? "Activating…"
                : `Pay $${planId === "smb_growth_50" ? 59 : 29}/mo & Activate Now`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
