import { addDaysToIsoDate, toIsoDateString } from "./compliance";
import { classifyCertificationType, extractDateCandidates } from "./ocr-parser";
import type { Certification } from "./types";

export interface ParsedSpreadsheetRow {
  rowIndex: number;
  fullName: string;
  roleTitle: string;
  department: string;
  phone: string;
  email: string;
  supervisorName: string;
  supervisorPhone: string;
  supervisorEmail: string;
  certName: string;
  category: Certification["category"];
  certificateNumber: string;
  issuingBody: string;
  issuedDate: string;
  expiryDate: string;
}

export interface SpreadsheetParseResult {
  delimiter: "tab" | "comma" | "semicolon";
  rows: ParsedSpreadsheetRow[];
  errors: Array<{ rowIndex: number; message: string }>;
  uniqueEmployeeCount: number;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return raw.trim();
}

function normalizeDateCell(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const candidates = extractDateCandidates(`Expiry: ${trimmed}`);
  return candidates[0]?.iso ?? null;
}

type ColumnKey =
  | "fullName"
  | "roleTitle"
  | "department"
  | "phone"
  | "email"
  | "supervisorName"
  | "supervisorPhone"
  | "supervisorEmail"
  | "certName"
  | "certificateNumber"
  | "issuingBody"
  | "issuedDate"
  | "expiryDate";

const HEADER_MATCHERS: Array<{ key: ColumnKey; regex: RegExp }> = [
  { key: "supervisorPhone", regex: /^(sup(ervisor)?|mgr|manager)[\s_-]*(phone|mobile|cell|sms|number)$/i },
  { key: "supervisorEmail", regex: /^(sup(ervisor)?|mgr|manager)[\s_-]*(email|e-mail)$/i },
  { key: "supervisorName", regex: /^(sup(ervisor)?|mgr|manager)([\s_-]*name)?$/i },
  { key: "fullName", regex: /^((employee|worker|full|staff)[\s_-]*)?name$|^(employee|worker|staff)$/i },
  { key: "roleTitle", regex: /^(role|title|job|position)([\s_-]*title)?$/i },
  { key: "department", regex: /^(dept|department|crew|team|division)$/i },
  { key: "phone", regex: /^(employee[\s_-]*)?(phone|mobile|cell|sms)([\s_-]*(number|no))?$/i },
  { key: "email", regex: /^(employee[\s_-]*)?(email|e-mail)([\s_-]*address)?$/i },
  { key: "certName", regex: /^(cert(ification)?|credential|license|training)([\s_-]*(name|type))?$/i },
  { key: "certificateNumber", regex: /^(cert(ificate)?|license|card)[\s_-]*(no|num|number|id|#)$/i },
  { key: "issuingBody", regex: /^(issuer|issuing[\s_-]*body|provider|agency)$/i },
  { key: "issuedDate", regex: /^(iss(ue|ued)?|completed|completion|trained)([\s_-]*date)?$/i },
  { key: "expiryDate", regex: /^(exp(iry|iration|ires)?|valid[\s_-]*(thru|until)|due|renewal)([\s_-]*date)?$/i },
];

export function parseSpreadsheetInput(rawInput: string): SpreadsheetParseResult {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return {
      delimiter: "comma",
      rows: [],
      errors: [{ rowIndex: 1, message: "Paste a header row plus at least one employee row." }],
      uniqueEmployeeCount: 0,
    };
  }

  const headerLine = lines[0];
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;

  const delimiterName: SpreadsheetParseResult["delimiter"] =
    tabCount >= commaCount && tabCount > 0
      ? "tab"
      : semiCount > commaCount
        ? "semicolon"
        : "comma";

  const delimiterChar =
    delimiterName === "tab" ? "\t" : delimiterName === "semicolon" ? ";" : ",";

  const headers = splitDelimitedLine(headerLine, delimiterChar);
  const columnMap = new Map<ColumnKey, number>();

  headers.forEach((header, idx) => {
    const clean = header.replace(/^\uFEFF/, "").trim();
    for (const matcher of HEADER_MATCHERS) {
      if (matcher.regex.test(clean) && !columnMap.has(matcher.key)) {
        columnMap.set(matcher.key, idx);
        break;
      }
    }
  });

  const rows: ParsedSpreadsheetRow[] = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];
  const todayIso = toIsoDateString(new Date());

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitDelimitedLine(lines[i], delimiterChar);
    const getCell = (key: ColumnKey) => {
      const idx = columnMap.get(key);
      return idx !== undefined ? (cells[idx] ?? "").trim() : "";
    };

    const fullName = getCell("fullName") || cells[0] || "";
    const phoneRaw = getCell("phone") || "";
    const certRaw = getCell("certName") || "";
    const expiryRaw = getCell("expiryDate") || "";

    if (!fullName) {
      errors.push({ rowIndex: i + 1, message: "Missing employee name." });
      continue;
    }
    if (!certRaw) {
      errors.push({ rowIndex: i + 1, message: `Missing certification name for ${fullName}.` });
      continue;
    }

    const expiryDate = normalizeDateCell(expiryRaw);
    if (!expiryDate) {
      errors.push({
        rowIndex: i + 1,
        message: `Unrecognized expiry date "${expiryRaw || "(blank)"}" for ${fullName}. Use YYYY-MM-DD or MM/DD/YYYY.`,
      });
      continue;
    }

    const classified = classifyCertificationType(certRaw);
    const issuedDate = normalizeDateCell(getCell("issuedDate")) ?? addDaysToIsoDate(expiryDate, -730) ?? todayIso;
    const slugTag = fullName.toLowerCase().replace(/[^a-z0-9]+/g, ".");

    rows.push({
      rowIndex: i + 1,
      fullName,
      roleTitle: getCell("roleTitle") || "Field Technician",
      department: getCell("department") || "Operations",
      phone: normalizePhone(phoneRaw || "+15125550199"),
      email: getCell("email") || `${slugTag}@company-team.local`,
      supervisorName: getCell("supervisorName") || "Operations Lead",
      supervisorPhone: normalizePhone(getCell("supervisorPhone") || "+15125550100"),
      supervisorEmail: getCell("supervisorEmail") || "supervisor@company-team.local",
      certName: certRaw,
      category: classified.category,
      certificateNumber:
        getCell("certificateNumber") || `IMP-${String(1000 + i)}`,
      issuingBody: getCell("issuingBody") || classified.issuingBody || "Verified Issuer",
      issuedDate,
      expiryDate,
    });
  }

  const uniqueKeys = new Set(rows.map((r) => `${r.fullName.toLowerCase()}::${r.phone}`));

  return {
    delimiter: delimiterName,
    rows,
    errors,
    uniqueEmployeeCount: uniqueKeys.size,
  };
}
