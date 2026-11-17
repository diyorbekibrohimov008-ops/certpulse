import { addDaysToIsoDate, toIsoDateString } from "./compliance";

export type SampleCardKind = "cpr" | "osha30" | "cdl";

export interface SampleCardSpec {
  kind: SampleCardKind;
  title: string;
  issuer: string;
  accentHex: string;
  certNumber: string;
  issuedDate: string;
  expiryDate: string;
}

export function buildSampleCardSpec(
  kind: SampleCardKind,
  holderName: string,
  referenceDate = new Date(),
): SampleCardSpec {
  const today = toIsoDateString(referenceDate);
  const issuedDate = addDaysToIsoDate(today, -2);

  if (kind === "cpr") {
    return {
      kind,
      title: "CPR / AED ADULT & PEDIATRIC",
      issuer: "AMERICAN HEART ASSOCIATION",
      accentHex: "#B91C1C",
      certNumber: "AHA-2026-94102",
      issuedDate,
      expiryDate: addDaysToIsoDate(today, 730),
    };
  }
  if (kind === "osha30") {
    return {
      kind,
      title: "OSHA 30-HOUR CONSTRUCTION",
      issuer: "U.S. DEPARTMENT OF LABOR",
      accentHex: "#1D4ED8",
      certNumber: "DOL-30-883412",
      issuedDate,
      expiryDate: addDaysToIsoDate(today, 1095),
    };
  }
  return {
    kind,
    title: "COMMERCIAL DRIVER LICENSE CDL-A",
    issuer: "TEXAS DPS / FMCSA",
    accentHex: "#0F766E",
    certNumber: "TX-CDL-998120",
    issuedDate,
    expiryDate: addDaysToIsoDate(today, 1460),
  };
}

/**
 * Generates an authentic, high-contrast PNG wallet certification card on an HTML5 Canvas
 * so real Tesseract.js OCR reads holder, card number, issued date, and expiry date cleanly.
 */
export async function generateSampleCardPng(params: {
  kind: SampleCardKind;
  holderName: string;
  referenceDate?: Date;
}): Promise<{ file: File; previewUrl: string; spec: SampleCardSpec; canonicalText: string }> {
  const spec = buildSampleCardSpec(params.kind, params.holderName, params.referenceDate);
  const canvas = document.createElement("canvas");
  canvas.width = 920;
  canvas.height = 540;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas 2D context unavailable in browser.");
  }

  // Crisp light card stock background for reliable high-contrast OCR
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer frame
  ctx.strokeStyle = "#CBD5E1";
  ctx.lineWidth = 4;
  ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

  // Top header band
  ctx.fillStyle = spec.accentHex;
  ctx.fillRect(16, 16, canvas.width - 32, 92);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 28px Arial, sans-serif";
  ctx.fillText(spec.issuer, 46, 56);
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText("OFFICIAL COMPLETION & RENEWAL CARD", 46, 90);

  // Main printed fields with clear labels and generous spacing for Tesseract.js
  ctx.fillStyle = "#0F172A";
  ctx.font = "bold 30px Arial, sans-serif";
  ctx.fillText(spec.title, 46, 162);

  ctx.strokeStyle = "#E2E8F0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(46, 184);
  ctx.lineTo(874, 184);
  ctx.stroke();

  const lines = [
    `NAME: ${params.holderName.toUpperCase()}`,
    `CERTIFICATION: ${spec.title}`,
    `CARD NO: ${spec.certNumber}`,
    `ISSUED: ${spec.issuedDate}`,
    `EXPIRES: ${spec.expiryDate}`,
  ];

  ctx.font = "bold 28px monospace";
  let y = 242;
  for (const line of lines) {
    ctx.fillStyle = line.startsWith("EXPIRES:") ? spec.accentHex : "#0F172A";
    ctx.fillText(line, 46, y);
    y += 56;
  }

  ctx.fillStyle = "#475569";
  ctx.font = "18px Arial, sans-serif";
  ctx.fillText("Verified Digital Credential Record · Scan or MMS to Employer Compliance Portal", 46, 502);

  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode sample card PNG."));
    }, "image/png");
  });

  const canonicalText = [spec.issuer, ...lines].join("\n");
  const file = new File([rawBlob], `${spec.kind}-${spec.certNumber}.png`, {
    type: "image/png",
  });
  const previewUrl = URL.createObjectURL(rawBlob);
  return { file, previewUrl, spec, canonicalText };
}

/**
 * Runs real client-side Tesseract.js OCR against an uploaded image file.
 * If CDN traineddata cannot be reached (e.g. offline sandbox), throws cleanly so callers can fall back.
 */
export async function runBrowserTesseractOcr(
  file: File,
  onProgress?: (pct: number, status: string) => void,
): Promise<string> {
  const Tesseract = await import("tesseract.js");
  onProgress?.(10, "Initializing OCR engine…");

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Tesseract OCR timed out.")), 18000);
  });

  const recognizePromise = (async () => {
    const result = await Tesseract.recognize(file, "eng", {
      logger: (m: { status?: string; progress?: number }) => {
        if (typeof m.progress === "number") {
          onProgress?.(Math.min(98, Math.round(m.progress * 100)), m.status || "Reading text…");
        }
      },
    });
    return result.data.text || "";
  })();

  return Promise.race([recognizePromise, timeoutPromise]);
}
