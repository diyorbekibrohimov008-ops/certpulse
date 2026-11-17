import { runEscalationSweep, sendTwilioSmsIfConfigured } from "./alerts";
import { addDaysToIsoDate, toIsoDateString } from "./compliance";
import { normalizePhone, parseSpreadsheetInput } from "./csv-importer";
import {
  classifyCertificationType,
  extractEmbeddedImageText,
  extractWithVisionAiIfConfigured,
  parseCertificateText,
} from "./ocr-parser";
import {
  createDemoWorkspace,
  createFreshWorkspace,
  DEMO_WORKSPACE_SLUG,
  readLiveIntegrationFlags,
} from "./seed";
import type { StorageAdapter } from "./storage";
import type {
  AlertRule,
  Certification,
  Employee,
  OcrExtractionResult,
  SmsMessage,
  Workspace,
  WorkspaceSummary,
} from "./types";

const WORKSPACE_PREFIX = "certpulse/workspaces";
const MEDIA_PREFIX = "certpulse/media";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "APP_ERROR",
  ) {
    super(message);
  }
}

export function workspaceKey(slug: string): string {
  return `${WORKSPACE_PREFIX}/${slug}.json`;
}

export function slugifyCompanyName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || `team-${crypto.randomUUID().slice(0, 6)}`;
}

function hydrateWorkspace(ws: Workspace): Workspace {
  return {
    ...ws,
    integrations: readLiveIntegrationFlags(),
  };
}

export async function ensureSeededWorkspaces(storage: StorageAdapter): Promise<void> {
  const existingKeys = await storage.listKeys(WORKSPACE_PREFIX);
  if (existingKeys.length > 0) return;

  const demo = createDemoWorkspace(new Date());
  await storage.putJson(workspaceKey(demo.slug), demo);
}

export async function listWorkspaceSummaries(
  storage: StorageAdapter,
): Promise<WorkspaceSummary[]> {
  await ensureSeededWorkspaces(storage);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  const loaded = await Promise.all(keys.map((k) => storage.getJson<Workspace>(k)));

  const summaries: WorkspaceSummary[] = [];
  for (const ws of loaded) {
    if (!ws) continue;
    summaries.push({
      id: ws.id,
      slug: ws.slug,
      companyName: ws.companyName,
      industry: ws.industry,
      seatCount: ws.employees.filter((e) => e.active).length,
      seatLimit: ws.billing.seatLimit,
      planName: ws.billing.planName,
      monthlyPriceUsd: ws.billing.monthlyPriceUsd,
    });
  }

  return summaries.sort((a, b) => {
    if (a.slug === DEMO_WORKSPACE_SLUG) return -1;
    if (b.slug === DEMO_WORKSPACE_SLUG) return 1;
    return a.companyName.localeCompare(b.companyName);
  });
}

export async function getWorkspace(
  storage: StorageAdapter,
  slug: string,
): Promise<Workspace> {
  const cleanSlug = slugifyCompanyName(slug);
  let ws = await storage.getJson<Workspace>(workspaceKey(cleanSlug));
  if (!ws && cleanSlug === DEMO_WORKSPACE_SLUG) {
    ws = createDemoWorkspace(new Date());
    await storage.putJson(workspaceKey(cleanSlug), ws);
  }
  if (!ws) {
    throw new AppError(404, `Workspace "${slug}" not found.`, "WORKSPACE_NOT_FOUND");
  }
  return hydrateWorkspace(ws);
}

export async function saveWorkspace(
  storage: StorageAdapter,
  workspace: Workspace,
): Promise<Workspace> {
  const updated: Workspace = {
    ...workspace,
    updatedAt: new Date().toISOString(),
    integrations: readLiveIntegrationFlags(),
  };
  await storage.putJson(workspaceKey(updated.slug), updated);
  return updated;
}

export async function createWorkspaceRecord(
  storage: StorageAdapter,
  input: {
    companyName: string;
    slug?: string;
    industry?: string;
    billingEmail: string;
    setupDurationSeconds?: number;
  },
): Promise<Workspace> {
  let targetSlug = slugifyCompanyName(input.slug || input.companyName);
  const existing = await storage.getJson<Workspace>(workspaceKey(targetSlug));
  if (existing) {
    targetSlug = `${targetSlug}-${crypto.randomUUID().slice(0, 4)}`;
  }

  const ws = createFreshWorkspace({
    slug: targetSlug,
    companyName: input.companyName,
    industry: input.industry || "Field Operations & Trades",
    billingEmail: input.billingEmail,
    setupDurationSeconds: input.setupDurationSeconds,
  });

  return saveWorkspace(storage, ws);
}

export async function addEmployeeToWorkspace(
  storage: StorageAdapter,
  slug: string,
  input: {
    fullName: string;
    roleTitle?: string;
    department?: string;
    phone: string;
    email?: string;
    supervisorName: string;
    supervisorPhone: string;
    supervisorEmail?: string;
    initialCert?: {
      certName: string;
      certificateNumber?: string;
      issuingBody?: string;
      issuedDate?: string;
      expiryDate: string;
    };
  },
): Promise<{ workspace: Workspace; employee: Employee; certification: Certification | null }> {
  const ws = await getWorkspace(storage, slug);
  const activeCount = ws.employees.filter((e) => e.active).length;

  if (activeCount >= ws.billing.seatLimit) {
    throw new AppError(
      409,
      `Seat limit reached (${activeCount}/${ws.billing.seatLimit} active employees on ${ws.billing.planName}). Upgrade your plan to add more crew members.`,
      "SEAT_LIMIT_REACHED",
    );
  }

  const nowIso = new Date().toISOString();
  const slugTag = input.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const employee: Employee = {
    id: `emp_${crypto.randomUUID().slice(0, 8)}`,
    fullName: input.fullName.trim(),
    roleTitle: input.roleTitle?.trim() || "Field Technician",
    department: input.department?.trim() || "Operations",
    phone: normalizePhone(input.phone),
    email: input.email?.trim() || `${slugTag}@company-team.local`,
    supervisor: {
      name: input.supervisorName.trim(),
      phone: normalizePhone(input.supervisorPhone),
      email: input.supervisorEmail?.trim() || "supervisor@company-team.local",
    },
    uploadToken: `tok_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    active: true,
    createdAt: nowIso,
  };

  ws.employees.push(employee);

  let certification: Certification | null = null;
  if (input.initialCert?.certName && input.initialCert.expiryDate) {
    const classified = classifyCertificationType(input.initialCert.certName);
    const issued =
      input.initialCert.issuedDate ||
      addDaysToIsoDate(input.initialCert.expiryDate, -730);
    const createdCert: Certification = {
      id: `cert_${crypto.randomUUID().slice(0, 8)}`,
      employeeId: employee.id,
      certName: input.initialCert.certName.trim(),
      category: classified.category,
      certificateNumber:
        input.initialCert.certificateNumber?.trim() ||
        `CERT-${Math.floor(10000 + Math.random() * 89999)}`,
      issuingBody:
        input.initialCert.issuingBody?.trim() || classified.issuingBody || "Verified Issuer",
      issuedDate: issued,
      expiryDate: input.initialCert.expiryDate,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso,
    };
    certification = createdCert;
    ws.certifications.push(createdCert);
  }

  const saved = await saveWorkspace(storage, ws);
  return { workspace: saved, employee, certification };
}

export async function updateEmployeeInWorkspace(
  storage: StorageAdapter,
  slug: string,
  employeeId: string,
  patch: Partial<{
    fullName: string;
    roleTitle: string;
    department: string;
    phone: string;
    email: string;
    active: boolean;
    supervisor: { name: string; phone: string; email: string };
  }>,
): Promise<Workspace> {
  const ws = await getWorkspace(storage, slug);
  const idx = ws.employees.findIndex((e) => e.id === employeeId);
  if (idx === -1) {
    throw new AppError(404, "Employee not found.", "EMPLOYEE_NOT_FOUND");
  }

  const existing = ws.employees[idx];
  ws.employees[idx] = {
    ...existing,
    fullName: patch.fullName?.trim() ?? existing.fullName,
    roleTitle: patch.roleTitle?.trim() ?? existing.roleTitle,
    department: patch.department?.trim() ?? existing.department,
    phone: patch.phone ? normalizePhone(patch.phone) : existing.phone,
    email: patch.email?.trim() ?? existing.email,
    active: patch.active ?? existing.active,
    supervisor: patch.supervisor
      ? {
          name: patch.supervisor.name.trim(),
          phone: normalizePhone(patch.supervisor.phone),
          email: patch.supervisor.email.trim(),
        }
      : existing.supervisor,
  };

  return saveWorkspace(storage, ws);
}

export async function deleteEmployeeFromWorkspace(
  storage: StorageAdapter,
  slug: string,
  employeeId: string,
): Promise<Workspace> {
  const ws = await getWorkspace(storage, slug);
  const before = ws.employees.length;
  ws.employees = ws.employees.filter((e) => e.id !== employeeId);
  if (ws.employees.length === before) {
    throw new AppError(404, "Employee not found.", "EMPLOYEE_NOT_FOUND");
  }
  ws.certifications = ws.certifications.filter((c) => c.employeeId !== employeeId);
  return saveWorkspace(storage, ws);
}

export async function upsertCertificationInWorkspace(
  storage: StorageAdapter,
  slug: string,
  input: {
    id?: string;
    employeeId: string;
    certName: string;
    category?: Certification["category"];
    certificateNumber?: string;
    issuingBody?: string;
    issuedDate?: string;
    expiryDate: string;
  },
): Promise<{ workspace: Workspace; certification: Certification }> {
  const ws = await getWorkspace(storage, slug);
  const emp = ws.employees.find((e) => e.id === input.employeeId);
  if (!emp) {
    throw new AppError(404, "Target employee not found.", "EMPLOYEE_NOT_FOUND");
  }

  const nowIso = new Date().toISOString();
  const classified = classifyCertificationType(input.certName);

  if (input.id) {
    const idx = ws.certifications.findIndex((c) => c.id === input.id);
    if (idx === -1) {
      throw new AppError(404, "Certification not found.", "CERT_NOT_FOUND");
    }
    const prev = ws.certifications[idx];
    const updatedCert: Certification = {
      ...prev,
      certName: input.certName.trim(),
      category: input.category ?? classified.category,
      certificateNumber: input.certificateNumber?.trim() || prev.certificateNumber,
      issuingBody:
        input.issuingBody?.trim() || classified.issuingBody || prev.issuingBody,
      issuedDate: input.issuedDate || prev.issuedDate,
      expiryDate: input.expiryDate,
      updatedAt: nowIso,
    };
    ws.certifications[idx] = updatedCert;
    const saved = await saveWorkspace(storage, ws);
    return { workspace: saved, certification: updatedCert };
  }

  const createdCert: Certification = {
    id: `cert_${crypto.randomUUID().slice(0, 8)}`,
    employeeId: emp.id,
    certName: input.certName.trim(),
    category: input.category ?? classified.category,
    certificateNumber:
      input.certificateNumber?.trim() ||
      `CERT-${Math.floor(10000 + Math.random() * 89999)}`,
    issuingBody:
      input.issuingBody?.trim() || classified.issuingBody || "Verified Issuer",
    issuedDate: input.issuedDate || addDaysToIsoDate(input.expiryDate, -730),
    expiryDate: input.expiryDate,
    photoKey: null,
    ocrConfidence: null,
    ocrRawText: null,
    lastRenewedAt: null,
    updatedAt: nowIso,
  };
  ws.certifications.push(createdCert);
  const saved = await saveWorkspace(storage, ws);
  return { workspace: saved, certification: createdCert };
}

export async function importSpreadsheetToWorkspace(
  storage: StorageAdapter,
  slug: string,
  rawSpreadsheetText: string,
): Promise<{
  workspace: Workspace;
  addedEmployees: number;
  addedCertifications: number;
  updatedCertifications: number;
  errors: Array<{ rowIndex: number; message: string }>;
}> {
  const ws = await getWorkspace(storage, slug);
  const parsed = parseSpreadsheetInput(rawSpreadsheetText);

  if (parsed.rows.length === 0) {
    throw new AppError(
      400,
      parsed.errors[0]?.message || "No valid rows found in spreadsheet input.",
      "INVALID_SPREADSHEET",
    );
  }

  const findExistingEmployee = (name: string, phone: string): Employee | undefined => {
    const cleanName = name.trim().toLowerCase();
    const cleanPhone = normalizePhone(phone);
    return ws.employees.find(
      (e) =>
        e.fullName.trim().toLowerCase() === cleanName ||
        (cleanPhone.length >= 10 && normalizePhone(e.phone) === cleanPhone),
    );
  };

  const newEmployeeKeys = new Set<string>();
  for (const row of parsed.rows) {
    if (!findExistingEmployee(row.fullName, row.phone)) {
      newEmployeeKeys.add(`${row.fullName.trim().toLowerCase()}::${normalizePhone(row.phone)}`);
    }
  }

  const activeCount = ws.employees.filter((e) => e.active).length;
  if (activeCount + newEmployeeKeys.size > ws.billing.seatLimit) {
    throw new AppError(
      409,
      `Spreadsheet adds ${newEmployeeKeys.size} new employees (${activeCount}/${ws.billing.seatLimit} seats already used), exceeding your ${ws.billing.seatLimit}-employee SMB limit. Switch to Growth (50 seats) or trim rows.`,
      "SEAT_LIMIT_REACHED",
    );
  }

  const nowIso = new Date().toISOString();
  let addedEmployees = 0;
  let addedCertifications = 0;
  let updatedCertifications = 0;

  for (const row of parsed.rows) {
    let emp = findExistingEmployee(row.fullName, row.phone);
    if (!emp) {
      emp = {
        id: `emp_${crypto.randomUUID().slice(0, 8)}`,
        fullName: row.fullName,
        roleTitle: row.roleTitle,
        department: row.department,
        phone: row.phone,
        email: row.email,
        supervisor: {
          name: row.supervisorName,
          phone: row.supervisorPhone,
          email: row.supervisorEmail,
        },
        uploadToken: `tok_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        active: true,
        createdAt: nowIso,
      };
      ws.employees.push(emp);
      addedEmployees += 1;
    }

    const existingCert = ws.certifications.find(
      (c) =>
        c.employeeId === emp!.id &&
        (c.certName.toLowerCase() === row.certName.toLowerCase() ||
          c.category === row.category),
    );

    if (existingCert) {
      existingCert.certName = row.certName;
      existingCert.certificateNumber = row.certificateNumber;
      existingCert.issuingBody = row.issuingBody;
      existingCert.issuedDate = row.issuedDate;
      existingCert.expiryDate = row.expiryDate;
      existingCert.updatedAt = nowIso;
      updatedCertifications += 1;
    } else {
      ws.certifications.push({
        id: `cert_${crypto.randomUUID().slice(0, 8)}`,
        employeeId: emp.id,
        certName: row.certName,
        category: row.category,
        certificateNumber: row.certificateNumber,
        issuingBody: row.issuingBody,
        issuedDate: row.issuedDate,
        expiryDate: row.expiryDate,
        photoKey: null,
        ocrConfidence: null,
        ocrRawText: null,
        lastRenewedAt: null,
        updatedAt: nowIso,
      });
      addedCertifications += 1;
    }
  }

  const saved = await saveWorkspace(storage, ws);
  return {
    workspace: saved,
    addedEmployees,
    addedCertifications,
    updatedCertifications,
    errors: parsed.errors,
  };
}

export async function extractCertificationFromSubmission(params: {
  imageBytes?: Uint8Array;
  mimeType?: string;
  rawOcrText?: string;
  hintText?: string;
}): Promise<OcrExtractionResult> {
  if (params.imageBytes && params.mimeType) {
    const base64 = Buffer.from(params.imageBytes).toString("base64");
    const visionResult = await extractWithVisionAiIfConfigured({
      imageBase64: base64,
      mimeType: params.mimeType,
      hintText: params.hintText,
    });
    if (visionResult) {
      return visionResult;
    }
  }

  if (params.rawOcrText && params.rawOcrText.trim().length > 0) {
    return parseCertificateText(params.rawOcrText, params.hintText, "tesseract_parser");
  }

  if (params.imageBytes && params.mimeType) {
    const embeddedText = extractEmbeddedImageText(params.imageBytes, params.mimeType);
    const combined = [embeddedText, params.hintText].filter(Boolean).join("\n");
    return parseCertificateText(combined, params.hintText, "server_pattern");
  }

  return parseCertificateText(params.hintText ?? "", params.hintText, "server_pattern");
}

function guessFileExtension(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  if (mimeType.includes("pdf")) return "pdf";
  return "bin";
}

export async function processInboundRenewal(
  storage: StorageAdapter,
  slug: string,
  params: {
    employeeId?: string;
    uploadToken?: string;
    fromPhone?: string;
    certificationId?: string;
    messageText?: string;
    rawOcrText?: string;
    imageBytes?: Uint8Array;
    mimeType?: string;
    overrideExpiryDate?: string;
    overrideCertName?: string;
    overrideCertificateNumber?: string;
  },
): Promise<{
  workspace: Workspace;
  employee: Employee;
  certification: Certification;
  extraction: OcrExtractionResult;
  replyMessage: SmsMessage;
}> {
  const ws = await getWorkspace(storage, slug);

  let employee: Employee | undefined;
  if (params.employeeId) {
    employee = ws.employees.find((e) => e.id === params.employeeId);
  }
  if (!employee && params.uploadToken) {
    employee = ws.employees.find((e) => e.uploadToken === params.uploadToken);
  }
  if (!employee && params.fromPhone) {
    const norm = normalizePhone(params.fromPhone);
    employee = ws.employees.find((e) => normalizePhone(e.phone) === norm);
  }

  const extraction = await extractCertificationFromSubmission({
    imageBytes: params.imageBytes,
    mimeType: params.mimeType,
    rawOcrText: params.rawOcrText,
    hintText: params.messageText,
  });

  if (!employee && extraction.holderName) {
    const holderLower = extraction.holderName.toLowerCase();
    employee = ws.employees.find((e) => e.fullName.toLowerCase().includes(holderLower));
  }
  if (!employee) {
    throw new AppError(
      404,
      "Could not match sender phone number, token, or employee on this account.",
      "EMPLOYEE_NOT_MATCHED",
    );
  }

  let mediaKey: string | null = null;
  if (params.imageBytes && params.imageBytes.length > 0 && params.mimeType) {
    const ext = guessFileExtension(params.mimeType);
    const key = `${MEDIA_PREFIX}/${ws.slug}/${employee.id}-${Date.now()}.${ext}`;
    mediaKey = await storage.putMedia(key, params.imageBytes, params.mimeType);
  }

  const finalCertName =
    params.overrideCertName?.trim() ||
    extraction.certName ||
    "Safety Certification Renewal";
  const finalCategory = extraction.category;
  const todayIso = toIsoDateString(new Date());
  const finalExpiry =
    params.overrideExpiryDate?.trim() ||
    extraction.expiryDate ||
    addDaysToIsoDate(todayIso, 730);
  const finalIssued =
    extraction.issuedDate || addDaysToIsoDate(finalExpiry, -730);
  const finalCertNum =
    params.overrideCertificateNumber?.trim() ||
    extraction.certificateNumber ||
    `OCR-${Math.floor(100000 + Math.random() * 899999)}`;

  let cert: Certification | undefined;
  if (params.certificationId) {
    cert = ws.certifications.find(
      (c) => c.id === params.certificationId && c.employeeId === employee!.id,
    );
  }
  if (!cert) {
    const employeeCerts = ws.certifications.filter((c) => c.employeeId === employee!.id);
    cert =
      employeeCerts.find((c) => c.category === finalCategory) ??
      employeeCerts.find(
        (c) =>
          c.certName.toLowerCase().includes(finalCertName.toLowerCase()) ||
          finalCertName.toLowerCase().includes(c.certName.toLowerCase()),
      ) ??
      (employeeCerts.length === 1 ? employeeCerts[0] : undefined);
  }

  const nowIso = new Date().toISOString();
  if (cert) {
    cert.certName = params.overrideCertName?.trim() || cert.certName;
    cert.category = finalCategory !== "Custom" ? finalCategory : cert.category;
    cert.certificateNumber = finalCertNum;
    cert.issuingBody = extraction.issuingBody || cert.issuingBody;
    cert.issuedDate = finalIssued;
    cert.expiryDate = finalExpiry;
    cert.photoKey = mediaKey ?? cert.photoKey;
    cert.ocrConfidence = extraction.confidence;
    cert.ocrRawText = extraction.rawText || null;
    cert.lastRenewedAt = nowIso;
    cert.updatedAt = nowIso;
  } else {
    cert = {
      id: `cert_${crypto.randomUUID().slice(0, 8)}`,
      employeeId: employee.id,
      certName: finalCertName,
      category: finalCategory,
      certificateNumber: finalCertNum,
      issuingBody: extraction.issuingBody || "Verified Card Upload",
      issuedDate: finalIssued,
      expiryDate: finalExpiry,
      photoKey: mediaKey,
      ocrConfidence: extraction.confidence,
      ocrRawText: extraction.rawText || null,
      lastRenewedAt: nowIso,
      updatedAt: nowIso,
    };
    ws.certifications.push(cert);
  }

  const summary = `${cert.certName} (#${cert.certificateNumber}) · New Expiry ${cert.expiryDate} · OCR ${Math.round(extraction.confidence * 100)}%`;

  const inboundMessage: SmsMessage = {
    id: `sms_${crypto.randomUUID().slice(0, 8)}`,
    direction: "inbound",
    employeeId: employee.id,
    employeeName: employee.fullName,
    phone: params.fromPhone ? normalizePhone(params.fromPhone) : employee.phone,
    body: params.messageText?.trim() || "[Photo MMS Upload]",
    mediaKey,
    extractedSummary: summary,
    createdAt: nowIso,
  };

  const replyText = `CertPulse Verified: Thanks ${employee.fullName.split(" ")[0]}! Updated ${cert.certName} (#${cert.certificateNumber}) with new expiry ${cert.expiryDate}. Upcoming 60/30/7 alerts reset automatically.`;
  await sendTwilioSmsIfConfigured(employee.phone, replyText);

  const replyMessage: SmsMessage = {
    id: `sms_${crypto.randomUUID().slice(0, 8)}`,
    direction: "outbound",
    employeeId: employee.id,
    employeeName: employee.fullName,
    phone: employee.phone,
    body: replyText,
    mediaKey: null,
    extractedSummary: null,
    createdAt: new Date(Date.now() + 500).toISOString(),
  };

  ws.smsMessages.unshift(replyMessage, inboundMessage);
  ws.smsMessages = ws.smsMessages.slice(0, 100);

  const saved = await saveWorkspace(storage, ws);
  return {
    workspace: saved,
    employee,
    certification: cert,
    extraction,
    replyMessage,
  };
}

export async function triggerWorkspaceSweep(
  storage: StorageAdapter,
  slug: string,
  options: { baseUrl?: string; referenceDate?: Date; forceCertificationId?: string } = {},
) {
  const ws = await getWorkspace(storage, slug);
  const { dispatched, skippedDeduplicated } = await runEscalationSweep(ws, options);

  if (dispatched.length > 0) {
    ws.alertDeliveries = [...dispatched.reverse(), ...ws.alertDeliveries].slice(0, 200);
    // Also echo worker SMS reminders into smsMessages thread
    const smsEchoes: SmsMessage[] = dispatched
      .filter((d) => d.channel === "sms" && d.recipientRole === "worker")
      .map((d) => ({
        id: `sms_${crypto.randomUUID().slice(0, 8)}`,
        direction: "outbound",
        employeeId: d.employeeId,
        employeeName: d.employeeName,
        phone: d.recipientContact,
        body: d.messageBody,
        mediaKey: null,
        extractedSummary: null,
        createdAt: d.sentAt,
      }));
    if (smsEchoes.length > 0) {
      ws.smsMessages = [...smsEchoes, ...ws.smsMessages].slice(0, 100);
    }
    await saveWorkspace(storage, ws);
  }

  return {
    workspace: ws,
    dispatchedCount: dispatched.length,
    dispatched,
    skippedDeduplicated,
  };
}

export async function updateWorkspaceAlertRules(
  storage: StorageAdapter,
  slug: string,
  rules: AlertRule[],
): Promise<Workspace> {
  const ws = await getWorkspace(storage, slug);
  ws.alertRules = rules;
  return saveWorkspace(storage, ws);
}

export async function activateSelfServePlan(
  storage: StorageAdapter,
  slug: string,
  input: {
    planId: "smb_25" | "smb_growth_50";
    billingEmail: string;
    cardNumber: string;
    cardBrand?: string;
    expiry?: string;
    cvc?: string;
  },
): Promise<Workspace> {
  const ws = await getWorkspace(storage, slug);
  const digits = input.cardNumber.replace(/\D/g, "");
  if (digits.length < 12) {
    throw new AppError(400, "Please enter a valid 16-digit card number.", "INVALID_CARD");
  }

  const last4 = digits.slice(-4);
  const inferredBrand =
    input.cardBrand ||
    (digits.startsWith("4")
      ? "Visa"
      : digits.startsWith("5")
        ? "Mastercard"
        : digits.startsWith("3")
          ? "Amex"
          : "Card");

  const isGrowth = input.planId === "smb_growth_50";
  const now = new Date();
  const nextMonth = addDaysToIsoDate(toIsoDateString(now), 30);

  ws.billing = {
    ...ws.billing,
    planId: input.planId,
    planName: isGrowth ? "Growth Multi-Crew ($59/mo)" : "SMB Flat Plan ($29/mo)",
    monthlyPriceUsd: isGrowth ? 59 : 29,
    seatLimit: isGrowth ? 50 : 25,
    status: "active",
    cardBrand: inferredBrand,
    cardLast4: last4,
    billingEmail: input.billingEmail.trim() || ws.billing.billingEmail,
    setupCompletedAt: ws.billing.setupCompletedAt ?? now.toISOString(),
    currentPeriodEnd: nextMonth,
    stripeCustomerId: ws.billing.stripeCustomerId ?? `cus_${crypto.randomUUID().slice(0, 10)}`,
    stripeSubscriptionId: ws.billing.stripeSubscriptionId ?? `sub_${crypto.randomUUID().slice(0, 10)}`,
  };

  return saveWorkspace(storage, ws);
}

export async function resolveMobilePortalByToken(
  storage: StorageAdapter,
  token: string,
): Promise<{ workspace: Workspace; employee: Employee; certifications: Certification[] }> {
  await ensureSeededWorkspaces(storage);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  for (const key of keys) {
    const ws = await storage.getJson<Workspace>(key);
    if (!ws) continue;
    const emp = ws.employees.find((e) => e.uploadToken === token && e.active);
    if (emp) {
      return {
        workspace: hydrateWorkspace(ws),
        employee: emp,
        certifications: ws.certifications.filter((c) => c.employeeId === emp.id),
      };
    }
  }
  throw new AppError(404, "Mobile upload link is invalid or expired.", "TOKEN_NOT_FOUND");
}

export async function findWorkspaceByPhone(
  storage: StorageAdapter,
  fromPhone: string,
): Promise<{ workspace: Workspace; employee: Employee } | null> {
  await ensureSeededWorkspaces(storage);
  const norm = normalizePhone(fromPhone);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  for (const key of keys) {
    const ws = await storage.getJson<Workspace>(key);
    if (!ws) continue;
    const emp = ws.employees.find((e) => e.active && normalizePhone(e.phone) === norm);
    if (emp) {
      return { workspace: hydrateWorkspace(ws), employee: emp };
    }
  }
  return null;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportWorkspaceToCsv(workspace: Workspace): string {
  const empMap = new Map(workspace.employees.map((e) => [e.id, e]));
  const header = [
    "Employee Name",
    "Role",
    "Department",
    "Mobile Phone",
    "Email",
    "Supervisor Name",
    "Supervisor Phone",
    "Supervisor Email",
    "Certification",
    "Category",
    "Card Number",
    "Issuing Body",
    "Issued Date",
    "Expiry Date",
    "Last Renewed",
  ].join(",");

  const rows = workspace.certifications.map((c) => {
    const emp = empMap.get(c.employeeId);
    const cells = [
      emp?.fullName ?? "Unknown",
      emp?.roleTitle ?? "",
      emp?.department ?? "",
      emp?.phone ?? "",
      emp?.email ?? "",
      emp?.supervisor.name ?? "",
      emp?.supervisor.phone ?? "",
      emp?.supervisor.email ?? "",
      c.certName,
      c.category,
      c.certificateNumber,
      c.issuingBody,
      c.issuedDate,
      c.expiryDate,
      c.lastRenewedAt ?? "",
    ];
    return cells.map(escapeCsvCell).join(",");
  });

  return [header, ...rows].join("\n");
}
