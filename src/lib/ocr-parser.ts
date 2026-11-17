import type { Certification, OcrExtractionResult } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

interface DateCandidate {
  iso: string;
  context: string;
  score: number;
  kind: "expiry" | "issued" | "unknown";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeYear(rawYear: number): number {
  if (rawYear < 100) {
    return rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear;
  }
  return rawYear;
}

function buildValidIso(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2050) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function classifyContext(line: string, matchIndex: number): {
  kind: "expiry" | "issued" | "unknown";
  score: number;
} {
  const before = line.slice(Math.max(0, matchIndex - 32), matchIndex).toLowerCase();
  const full = line.toLowerCase();

  if (
    /\b(exp|expir|expiration|expires|valid\s*thru|valid\s*until|good\s*thru|renew\s*by|renewal\s*due|due\s*date|end\s*date)\b/.test(
      before,
    )
  ) {
    return { kind: "expiry", score: 100 };
  }
  if (
    /\b(exp|expir|expiration|expires|valid\s*thru|valid\s*until|good\s*thru|renew\s*by)\b/.test(
      full,
    ) &&
    !/\b(iss|issued|completed|completion|dob|birth)\b/.test(before)
  ) {
    return { kind: "expiry", score: 80 };
  }
  if (
    /\b(iss|issued|issue\s*date|completed|completion|course\s*date|trained|dob|birth)\b/.test(
      before,
    )
  ) {
    return { kind: "issued", score: 90 };
  }
  return { kind: "unknown", score: 20 };
}

export function extractDateCandidates(text: string): DateCandidate[] {
  const lines = text.split(/\r?\n/);
  const candidates: DateCandidate[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1. ISO YYYY-MM-DD
    for (const match of line.matchAll(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g)) {
      const iso = buildValidIso(Number(match[1]), Number(match[2]), Number(match[3]));
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }

    // 2. US MM/DD/YYYY or MM-DD-YY
    for (const match of line.matchAll(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](\d{2,4})\b/g)) {
      const year = normalizeYear(Number(match[3]));
      const iso = buildValidIso(year, Number(match[1]), Number(match[2]));
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }

    // 3. Named month: Nov 15, 2028 or 15 Nov 2028 or November 2028
    for (const match of line.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi,
    )) {
      const month = MONTHS[match[1].toLowerCase()];
      const iso = month ? buildValidIso(Number(match[3]), month, Number(match[2])) : null;
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }

    for (const match of line.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi,
    )) {
      const month = MONTHS[match[1].toLowerCase()];
      if (month) {
        const year = Number(match[2]);
        const iso = buildValidIso(year, month, daysInMonth(year, month));
        if (iso) {
          const cls = classifyContext(line, match.index ?? 0);
          candidates.push({ iso, context: line, ...cls });
        }
      }
    }

    // 4. MM/YYYY or MM/YY (only when near expiry/issued context or card format)
    for (const match of line.matchAll(/\b(0?[1-9]|1[0-2])\/(20\d{2}|\d{2})\b/g)) {
      const before = line.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
      const after = line.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 4);
      // Skip if part of MM/DD/YYYY
      if (after.startsWith("/") || /\d\/$/.test(before)) continue;
      const year = normalizeYear(Number(match[2]));
      const month = Number(match[1]);
      const iso = buildValidIso(year, month, daysInMonth(year, month));
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        if (cls.kind !== "unknown") {
          candidates.push({ iso, context: line, ...cls });
        }
      }
    }
  }

  return candidates;
}

export function classifyCertificationType(text: string): {
  category: Certification["category"];
  certName: string;
  issuingBody: string | null;
} {
  const lower = text.toLowerCase();

  if (/\b(cpr|aed|bls|basic life support|american heart|red cross)\b/.test(lower)) {
    const issuingBody = /red cross/i.test(text)
      ? "American Red Cross"
      : /american heart|aha\b/i.test(text)
        ? "American Heart Association"
        : null;
    return {
      category: "CPR / AED",
      certName: /bls/i.test(text) ? "BLS / CPR & AED" : "CPR & AED Provider",
      issuingBody,
    };
  }

  if (/\b(osha\s*-?\s*30|30-hour|30 hour)\b/.test(lower)) {
    return {
      category: "OSHA 10/30",
      certName: "OSHA 30-Hour Construction",
      issuingBody: "U.S. Dept. of Labor (OSHA)",
    };
  }

  if (/\b(osha\s*-?\s*10|10-hour|10 hour|osha)\b/.test(lower)) {
    return {
      category: "OSHA 10/30",
      certName: "OSHA 10-Hour Safety",
      issuingBody: "U.S. Dept. of Labor (OSHA)",
    };
  }

  if (/\b(cdl|commercial driver|driver'?s?\s*licen[sc]e|\bdl\b|dot medical|class\s*[abc])\b/.test(lower)) {
    const classMatch = text.match(/\bclass\s*([abc])\b/i);
    return {
      category: "Driver License / CDL",
      certName: classMatch
        ? `Commercial Driver License (CDL-${classMatch[1].toUpperCase()})`
        : /dot/i.test(text)
          ? "DOT Medical / CDL"
          : "Driver License",
      issuingBody: /dot/i.test(text) ? "FMCSA / DOT" : "State DMV",
    };
  }

  if (/\b(forklift|powered industrial truck|pit operator)\b/.test(lower)) {
    return {
      category: "Forklift",
      certName: "Forklift Operator Certification",
      issuingBody: "OSHA PIT Compliance",
    };
  }

  if (/\b(epa\s*608|section\s*608|refrigerant|universal)\b/.test(lower)) {
    return {
      category: "EPA 608",
      certName: "EPA Section 608 Universal",
      issuingBody: "U.S. EPA",
    };
  }

  if (/\b(first\s*aid)\b/.test(lower)) {
    return {
      category: "First Aid",
      certName: "First Aid & Bloodborne Pathogens",
      issuingBody: /red cross/i.test(text) ? "American Red Cross" : null,
    };
  }

  return {
    category: "Custom",
    certName: "Compliance Certification",
    issuingBody: null,
  };
}

function extractCertificateNumber(text: string): string | null {
  const patterns = [
    /(?:cert(?:ificate)?\s*(?:id|no\.?|#|number)?|card\s*(?:id|no\.?|#)|lic(?:ense)?\s*(?:no\.?|#|id)?|id\s*#?|\bdl\b)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,22})/i,
    /\b((?:OSHA|AHA|ARC|CDL|EPA|FLT)-[A-Z0-9-]{3,18})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim().toUpperCase();
    }
  }
  return null;
}

function extractHolderName(text: string): string | null {
  const labeled = text.match(
    /(?:name|issued\s+to|holder|student|operator|employee)\s*[:\-]\s*([A-Za-z][A-Za-z.'-]{1,20}(?:\s+[A-Za-z][A-Za-z.'-]{1,20}){1,2})/i,
  );
  if (labeled?.[1]) {
    return labeled[1].trim();
  }
  return null;
}

export function parseCertificateText(
  rawText: string,
  hintText = "",
  engine: OcrExtractionResult["engine"] = "tesseract_parser",
): OcrExtractionResult {
  const combined = [rawText, hintText].filter(Boolean).join("\n");
  const candidates = extractDateCandidates(combined);

  const expiryCandidates = candidates
    .filter((c) => c.kind === "expiry")
    .sort((a, b) => b.score - a.score || b.iso.localeCompare(a.iso));

  const issuedCandidates = candidates
    .filter((c) => c.kind === "issued")
    .sort((a, b) => b.score - a.score || a.iso.localeCompare(b.iso));

  const unknownSorted = candidates
    .filter((c) => c.kind === "unknown")
    .sort((a, b) => b.iso.localeCompare(a.iso));

  const expiryDate = expiryCandidates[0]?.iso ?? unknownSorted[0]?.iso ?? null;
  const issuedDate =
    issuedCandidates[0]?.iso ??
    (unknownSorted.length > 1 ? unknownSorted[unknownSorted.length - 1].iso : null);

  const classified = classifyCertificationType(combined);
  const certificateNumber = extractCertificateNumber(combined);
  const holderName = extractHolderName(combined);

  const matchedLines: string[] = [];
  if (expiryCandidates[0]?.context) matchedLines.push(expiryCandidates[0].context);
  if (issuedCandidates[0]?.context) matchedLines.push(issuedCandidates[0].context);
  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      trimmed &&
      !matchedLines.includes(trimmed) &&
      /(cert|osha|cpr|aed|cdl|driver|forklift|epa|exp|valid|name|id|license)/i.test(trimmed)
    ) {
      matchedLines.push(trimmed);
    }
    if (matchedLines.length >= 6) break;
  }

  let confidence = 0.42;
  if (expiryDate) confidence += expiryCandidates.length > 0 ? 0.34 : 0.2;
  if (classified.category !== "Custom") confidence += 0.12;
  if (certificateNumber) confidence += 0.06;
  if (holderName) confidence += 0.04;
  confidence = Math.min(0.98, Number(confidence.toFixed(2)));

  return {
    certName: classified.certName,
    category: classified.category,
    holderName,
    certificateNumber,
    issuingBody: classified.issuingBody,
    issuedDate,
    expiryDate,
    confidence,
    engine,
    matchedLines,
    rawText: combined.trim(),
  };
}

export function extractEmbeddedImageText(bytes: Uint8Array, mimeType: string): string {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);

  if (mimeType.includes("svg") || raw.includes("<svg")) {
    const textNodes = [...raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, " ").trim())
      .filter(Boolean);
    if (textNodes.length > 0) {
      return textNodes.join("\n");
    }
  }

  // Extract printable ASCII strings >= 5 chars (catches PNG tEXt/iTXt chunks or embedded metadata)
  const printableChunks = [...raw.matchAll(/[A-Za-z0-9#/:.,\- ]{6,120}/g)]
    .map((m) => m[0].trim())
    .filter((s) =>
      /(exp|valid|osha|cpr|aed|cdl|license|forklift|epa|cert|name|issued|202\d|203\d)/i.test(s),
    );

  return printableChunks.join("\n");
}

export async function extractWithVisionAiIfConfigured(params: {
  imageBase64: string;
  mimeType: string;
  hintText?: string;
}): Promise<OcrExtractionResult | null> {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!gatewayKey && !openAiKey) return null;

  const endpoint = gatewayKey
    ? "https://ai-gateway.vercel.sh/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const token = gatewayKey || openAiKey;
  const model = gatewayKey ? "openai/gpt-4o-mini" : "gpt-4o-mini";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You extract employee certification details from photos. Return strict JSON with keys: certName, category (one of: 'CPR / AED', 'OSHA 10/30', 'Driver License / CDL', 'Forklift', 'EPA 608', 'First Aid', 'Custom'), holderName, certificateNumber, issuingBody, issuedDate (YYYY-MM-DD or null), expiryDate (YYYY-MM-DD or null), confidence (0..1), rawText.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract certification fields from this photo.${params.hintText ? ` SMS text hint: ${params.hintText}` : ""}`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${params.mimeType};base64,${params.imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<OcrExtractionResult>;
    const rawText = parsed.rawText ?? params.hintText ?? "";
    const fallback = parseCertificateText(rawText, params.hintText, "vision_ai");

    return {
      certName: parsed.certName ?? fallback.certName,
      category: parsed.category ?? fallback.category,
      holderName: parsed.holderName ?? fallback.holderName,
      certificateNumber: parsed.certificateNumber ?? fallback.certificateNumber,
      issuingBody: parsed.issuingBody ?? fallback.issuingBody,
      issuedDate: parsed.issuedDate ?? fallback.issuedDate,
      expiryDate: parsed.expiryDate ?? fallback.expiryDate,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.94,
      engine: "vision_ai",
      matchedLines: fallback.matchedLines,
      rawText,
    };
  } catch {
    return null;
  }
}
