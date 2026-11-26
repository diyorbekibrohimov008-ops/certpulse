// api/index.ts
import { Hono } from "hono";
import { z } from "zod";

// src/lib/compliance.ts
var MS_PER_DAY = 864e5;
function toIsoDateString(date) {
  return date.toISOString().slice(0, 10);
}
function addDaysToIsoDate(isoDate, days) {
  const base = parseIsoDateUtc(isoDate);
  return toIsoDateString(new Date(base.getTime() + days * MS_PER_DAY));
}
function parseIsoDateUtc(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Invalid ISO date string: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}
function getDaysRemaining(expiryDate, referenceDate = /* @__PURE__ */ new Date()) {
  const todayUtc = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const expiryUtc = parseIsoDateUtc(expiryDate).getTime();
  return Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
}
function getComplianceBucket(daysRemaining) {
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= 7) return "critical_7";
  if (daysRemaining <= 30) return "warning_30";
  if (daysRemaining <= 60) return "watch_60";
  return "compliant";
}
function getBucketMeta(bucket) {
  switch (bucket) {
    case "expired":
      return {
        label: "Expired",
        shortLabel: "Expired",
        tone: "rose",
        fineRiskUsd: 16131
      };
    case "critical_7":
      return {
        label: "Critical (\u2264 7d)",
        shortLabel: "\u2264 7d",
        tone: "rose",
        fineRiskUsd: 5e3
      };
    case "warning_30":
      return {
        label: "Action (\u2264 30d)",
        shortLabel: "\u2264 30d",
        tone: "orange",
        fineRiskUsd: 1500
      };
    case "watch_60":
      return {
        label: "Watch (\u2264 60d)",
        shortLabel: "\u2264 60d",
        tone: "amber",
        fineRiskUsd: 0
      };
    case "compliant":
      return {
        label: "Compliant",
        shortLabel: "Valid",
        tone: "emerald",
        fineRiskUsd: 0
      };
  }
}
function computeWorkspaceMetrics(employees, certifications, referenceDate = /* @__PURE__ */ new Date()) {
  const employeeMap = new Map(employees.map((emp) => [emp.id, emp]));
  const rows = [];
  for (const cert of certifications) {
    const employee = employeeMap.get(cert.employeeId);
    if (!employee || !employee.active) continue;
    const daysRemaining = getDaysRemaining(cert.expiryDate, referenceDate);
    const bucket = getComplianceBucket(daysRemaining);
    rows.push({ cert, employee, daysRemaining, bucket });
  }
  rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
  const counts = {
    total: rows.length,
    expired: rows.filter((r) => r.bucket === "expired").length,
    critical7: rows.filter((r) => r.bucket === "critical_7").length,
    warning30: rows.filter((r) => r.bucket === "warning_30").length,
    watch60: rows.filter((r) => r.bucket === "watch_60").length,
    compliant: rows.filter((r) => r.bucket === "compliant").length
  };
  const nonExpiredCount = counts.total - counts.expired;
  const complianceScore = counts.total === 0 ? 100 : Math.round(nonExpiredCount / counts.total * 100);
  const estimatedFineExposureUsd = rows.reduce(
    (sum, row) => sum + getBucketMeta(row.bucket).fineRiskUsd,
    0
  );
  return {
    rows,
    counts,
    complianceScore,
    estimatedFineExposureUsd,
    activeSeats: employees.filter((e) => e.active).length
  };
}

// src/lib/alerts.ts
var DEFAULT_ALERT_RULES = [
  {
    id: "rule-60",
    daysBefore: 60,
    label: "60-Day Early Notice",
    severity: "watch",
    enabled: true,
    notifyWorker: true,
    notifySupervisor: true,
    channels: ["sms", "email"],
    template: "Heads up {{employeeName}}: your {{certName}} (#{{certificateNumber}}) expires in {{daysRemaining}} days on {{expiryDate}}. Text a photo of your renewed card or upload here: {{uploadUrl}}"
  },
  {
    id: "rule-30",
    daysBefore: 30,
    label: "30-Day Renewal Warning",
    severity: "warning",
    enabled: true,
    notifyWorker: true,
    notifySupervisor: true,
    channels: ["sms", "email"],
    template: "Action needed: {{employeeName}}'s {{certName}} expires in {{daysRemaining}} days ({{expiryDate}}). Renew and text a card photo to avoid scheduling hold: {{uploadUrl}}"
  },
  {
    id: "rule-7",
    daysBefore: 7,
    label: "7-Day Critical Escalation",
    severity: "critical",
    enabled: true,
    notifyWorker: true,
    notifySupervisor: true,
    channels: ["sms", "email"],
    template: "URGENT (7-day compliance window): {{employeeName}}'s {{certName}} expires on {{expiryDate}} ({{daysRemaining}} days left). Text a photo immediately to stay OSHA/DOT compliant: {{uploadUrl}}"
  },
  {
    id: "rule-0",
    daysBefore: 0,
    label: "Expired / Fine Risk Alert",
    severity: "expired",
    enabled: true,
    notifyWorker: true,
    notifySupervisor: true,
    channels: ["sms", "email"],
    template: "COMPLIANCE STOP: {{employeeName}}'s {{certName}} expired on {{expiryDate}}. Pause restricted duties and upload renewal photo now: {{uploadUrl}}"
  }
];
function renderAlertMessage(rule, employee, cert, daysRemaining, recipientRole, baseUrl) {
  const uploadUrl = `${baseUrl.replace(/\/$/, "")}/m/${employee.uploadToken}`;
  const rendered = rule.template.replaceAll("{{employeeName}}", employee.fullName).replaceAll("{{certName}}", cert.certName).replaceAll("{{certificateNumber}}", cert.certificateNumber).replaceAll("{{daysRemaining}}", String(Math.max(0, daysRemaining))).replaceAll("{{expiryDate}}", cert.expiryDate).replaceAll("{{uploadUrl}}", uploadUrl);
  if (recipientRole === "supervisor") {
    return `[Supervisor CC \xB7 ${employee.supervisor.name}] ${rendered}`;
  }
  return rendered;
}
function matchEscalationRule(daysRemaining, rules) {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => a.daysBefore - b.daysBefore);
  if (daysRemaining < 0) {
    return enabled.find((r) => r.daysBefore === 0) ?? enabled.find((r) => r.daysBefore <= 7) ?? null;
  }
  for (const rule of enabled) {
    if (rule.daysBefore > 0 && daysRemaining <= rule.daysBefore) {
      return rule;
    }
  }
  return null;
}
async function sendTwilioSmsIfConfigured(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { mode: "sandbox_outbox", status: "logged", ref: `sim_sms_${Date.now()}` };
  }
  try {
    const form = new URLSearchParams({ To: to, From: from, Body: body });
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString(),
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      return { mode: "live_twilio", status: "failed", ref: `http_${res.status}` };
    }
    const json = await res.json();
    return { mode: "live_twilio", status: "sent", ref: json.sid ?? null };
  } catch {
    return { mode: "live_twilio", status: "failed", ref: "network_error" };
  }
}
async function sendResendEmailIfConfigured(params) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "CertPulse Alerts <alerts@certpulse.app>";
  if (!apiKey) {
    return { mode: "sandbox_outbox", status: "logged", ref: `sim_email_${Date.now()}` };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.body
      }),
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      return { mode: "live_resend", status: "failed", ref: `http_${res.status}` };
    }
    const json = await res.json();
    return { mode: "live_resend", status: "sent", ref: json.id ?? null };
  } catch {
    return { mode: "live_resend", status: "failed", ref: "network_error" };
  }
}
async function runEscalationSweep(workspace, options = {}) {
  const referenceDate = options.referenceDate ?? /* @__PURE__ */ new Date();
  const baseUrl = options.baseUrl ?? "https://certpulse.vercel.app";
  const employeeMap = new Map(workspace.employees.map((e) => [e.id, e]));
  const existingKeys = new Set(workspace.alertDeliveries.map((d) => d.dedupeKey));
  const dispatched = [];
  let skippedDeduplicated = 0;
  for (const cert of workspace.certifications) {
    if (options.forceCertificationId && cert.id !== options.forceCertificationId) {
      continue;
    }
    const employee = employeeMap.get(cert.employeeId);
    if (!employee || !employee.active) continue;
    const daysRemaining = getDaysRemaining(cert.expiryDate, referenceDate);
    const matchedRule = matchEscalationRule(daysRemaining, workspace.alertRules);
    if (!matchedRule) continue;
    const roles = [];
    if (matchedRule.notifyWorker) roles.push("worker");
    if (matchedRule.notifySupervisor) roles.push("supervisor");
    for (const recipientRole of roles) {
      const recipientName = recipientRole === "worker" ? employee.fullName : employee.supervisor.name;
      for (const channel of matchedRule.channels) {
        const recipientContact = recipientRole === "worker" ? channel === "sms" ? employee.phone : employee.email : channel === "sms" ? employee.supervisor.phone : employee.supervisor.email;
        if (!recipientContact) continue;
        const dedupeKey = `${cert.id}::${matchedRule.daysBefore}::${cert.expiryDate}::${recipientRole}::${channel}`;
        if (!options.forceCertificationId && existingKeys.has(dedupeKey)) {
          skippedDeduplicated += 1;
          continue;
        }
        const messageBody = renderAlertMessage(
          matchedRule,
          employee,
          cert,
          daysRemaining,
          recipientRole,
          baseUrl
        );
        const deliveryResult = channel === "sms" ? await sendTwilioSmsIfConfigured(recipientContact, messageBody) : await sendResendEmailIfConfigured({
          to: recipientContact,
          subject: `[CertPulse ${matchedRule.label}] ${employee.fullName} \u2014 ${cert.certName}`,
          body: messageBody
        });
        const delivery = {
          id: `alt_${crypto.randomUUID().slice(0, 8)}`,
          dedupeKey,
          certificationId: cert.id,
          employeeId: employee.id,
          employeeName: employee.fullName,
          certName: cert.certName,
          expiryDate: cert.expiryDate,
          tierDays: matchedRule.daysBefore,
          recipientRole,
          recipientName,
          recipientContact,
          channel,
          messageBody,
          deliveryMode: deliveryResult.mode,
          providerStatus: deliveryResult.status,
          providerRef: deliveryResult.ref,
          sentAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        dispatched.push(delivery);
        existingKeys.add(dedupeKey);
      }
    }
  }
  return { dispatched, skippedDeduplicated };
}

// src/lib/storage.ts
import fs from "node:fs/promises";
import path from "node:path";
function sanitizeStorageKey(rawKey) {
  const normalized = rawKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const safeParts = normalized.split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  return safeParts.join("/");
}
var VercelBlobAdapter = class {
  driver = "vercel-blob";
  async sdk() {
    return import("@vercel/blob");
  }
  async getJson(key) {
    const safeKey = sanitizeStorageKey(key);
    try {
      const { get } = await this.sdk();
      const result = await get(safeKey, {
        access: "private",
        useCache: false
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const text = await new Response(result.stream).text();
      return JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not\s*found|404|does\s*not\s*exist/i.test(message)) {
        return null;
      }
      throw err;
    }
  }
  async putJson(key, value) {
    const safeKey = sanitizeStorageKey(key);
    const { put } = await this.sdk();
    await put(safeKey, JSON.stringify(value, null, 2), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json"
    });
  }
  async listKeys(prefix) {
    const safePrefix = sanitizeStorageKey(prefix);
    const { list } = await this.sdk();
    const keys = [];
    let cursor;
    do {
      const page = await list({ prefix: safePrefix, cursor, limit: 100 });
      for (const blob of page.blobs) {
        keys.push(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : void 0;
    } while (cursor);
    return keys;
  }
  async deleteKey(key) {
    const safeKey = sanitizeStorageKey(key);
    const { del } = await this.sdk();
    await del(safeKey);
  }
  async putMedia(key, bytes, contentType) {
    const safeKey = sanitizeStorageKey(key);
    const { put } = await this.sdk();
    await put(safeKey, Buffer.from(bytes), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType
    });
    return safeKey;
  }
  async getMedia(key) {
    const safeKey = sanitizeStorageKey(key);
    try {
      const { get } = await this.sdk();
      const result = await get(safeKey, {
        access: "private",
        useCache: false
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return null;
      }
      const buffer = await new Response(result.stream).arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        contentType: result.blob.contentType || "application/octet-stream"
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not\s*found|404|does\s*not\s*exist/i.test(message)) {
        return null;
      }
      throw err;
    }
  }
};
var LocalFileStorageAdapter = class {
  driver = "local-fs";
  rootDir;
  constructor(rootDir) {
    if (rootDir) {
      this.rootDir = rootDir;
    } else if (process.env.CERTPULSE_DATA_DIR) {
      this.rootDir = process.env.CERTPULSE_DATA_DIR;
    } else if (process.env.VERCEL) {
      this.rootDir = "/tmp/certpulse-data";
    } else {
      this.rootDir = path.join(process.cwd(), ".data");
    }
  }
  resolveSafePath(key) {
    const safeKey = sanitizeStorageKey(key);
    const full = path.resolve(this.rootDir, ...safeKey.split("/"));
    const rootResolved = path.resolve(this.rootDir);
    if (!full.startsWith(rootResolved)) {
      throw new Error("Invalid storage path");
    }
    return full;
  }
  async getJson(key) {
    try {
      const text = await fs.readFile(this.resolveSafePath(key), "utf8");
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async putJson(key, value) {
    const target = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(value, null, 2));
  }
  async listKeys(prefix) {
    const safePrefix = sanitizeStorageKey(prefix);
    const startDir = this.resolveSafePath(safePrefix);
    const found = [];
    const walk = async (dir, currentPrefix) => {
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.endsWith(".meta.json")) continue;
        const full = path.join(dir, entry);
        const relKey = currentPrefix ? `${currentPrefix}/${entry}` : entry;
        let subEntries = null;
        try {
          subEntries = await fs.readdir(full);
        } catch {
          subEntries = null;
        }
        if (subEntries !== null) {
          await walk(full, relKey);
        } else {
          found.push(relKey);
        }
      }
    };
    await walk(startDir, safePrefix);
    return found.sort();
  }
  async deleteKey(key) {
    await fs.rm(this.resolveSafePath(key), { force: true });
  }
  async putMedia(key, bytes, contentType) {
    const safeKey = sanitizeStorageKey(key);
    const target = this.resolveSafePath(safeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    await fs.writeFile(`${target}.meta.json`, JSON.stringify({ contentType }));
    return safeKey;
  }
  async getMedia(key) {
    const target = this.resolveSafePath(key);
    try {
      const bytes = await fs.readFile(target);
      let contentType = "application/octet-stream";
      try {
        const metaRaw = await fs.readFile(`${target}.meta.json`, "utf8");
        const parsed = JSON.parse(metaRaw);
        if (parsed.contentType) contentType = parsed.contentType;
      } catch {
      }
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
};
var cachedStorage = null;
function getStorage() {
  if (cachedStorage) return cachedStorage;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    cachedStorage = new VercelBlobAdapter();
  } else {
    cachedStorage = new LocalFileStorageAdapter();
  }
  return cachedStorage;
}

// src/lib/ocr-parser.ts
var MONTHS = {
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
  december: 12
};
function pad2(n) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function normalizeYear(rawYear) {
  if (rawYear < 100) {
    return rawYear >= 70 ? 1900 + rawYear : 2e3 + rawYear;
  }
  return rawYear;
}
function buildValidIso(year, month, day) {
  if (year < 1990 || year > 2050) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function classifyContext(line, matchIndex) {
  const before = line.slice(Math.max(0, matchIndex - 32), matchIndex).toLowerCase();
  const full = line.toLowerCase();
  if (/\b(exp|expir|expiration|expires|valid\s*thru|valid\s*until|good\s*thru|renew\s*by|renewal\s*due|due\s*date|end\s*date)\b/.test(
    before
  )) {
    return { kind: "expiry", score: 100 };
  }
  if (/\b(exp|expir|expiration|expires|valid\s*thru|valid\s*until|good\s*thru|renew\s*by)\b/.test(
    full
  ) && !/\b(iss|issued|completed|completion|dob|birth)\b/.test(before)) {
    return { kind: "expiry", score: 80 };
  }
  if (/\b(iss|issued|issue\s*date|completed|completion|course\s*date|trained|dob|birth)\b/.test(
    before
  )) {
    return { kind: "issued", score: 90 };
  }
  return { kind: "unknown", score: 20 };
}
function extractDateCandidates(text) {
  const lines = text.split(/\r?\n/);
  const candidates = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const match of line.matchAll(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g)) {
      const iso = buildValidIso(Number(match[1]), Number(match[2]), Number(match[3]));
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }
    for (const match of line.matchAll(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](\d{2,4})\b/g)) {
      const year = normalizeYear(Number(match[3]));
      const iso = buildValidIso(year, Number(match[1]), Number(match[2]));
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }
    for (const match of line.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi
    )) {
      const month = MONTHS[match[1].toLowerCase()];
      const iso = month ? buildValidIso(Number(match[3]), month, Number(match[2])) : null;
      if (iso) {
        const cls = classifyContext(line, match.index ?? 0);
        candidates.push({ iso, context: line, ...cls });
      }
    }
    for (const match of line.matchAll(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/gi
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
    for (const match of line.matchAll(/\b(0?[1-9]|1[0-2])\/(20\d{2}|\d{2})\b/g)) {
      const before = line.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
      const after = line.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 4);
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
function classifyCertificationType(text) {
  const lower = text.toLowerCase();
  if (/\b(cpr|aed|bls|basic life support|american heart|red cross)\b/.test(lower)) {
    const issuingBody = /red cross/i.test(text) ? "American Red Cross" : /american heart|aha\b/i.test(text) ? "American Heart Association" : null;
    return {
      category: "CPR / AED",
      certName: /bls/i.test(text) ? "BLS / CPR & AED" : "CPR & AED Provider",
      issuingBody
    };
  }
  if (/\b(osha\s*-?\s*30|30-hour|30 hour)\b/.test(lower)) {
    return {
      category: "OSHA 10/30",
      certName: "OSHA 30-Hour Construction",
      issuingBody: "U.S. Dept. of Labor (OSHA)"
    };
  }
  if (/\b(osha\s*-?\s*10|10-hour|10 hour|osha)\b/.test(lower)) {
    return {
      category: "OSHA 10/30",
      certName: "OSHA 10-Hour Safety",
      issuingBody: "U.S. Dept. of Labor (OSHA)"
    };
  }
  if (/\b(cdl|commercial driver|driver'?s?\s*licen[sc]e|\bdl\b|dot medical|class\s*[abc])\b/.test(lower)) {
    const classMatch = text.match(/\bclass\s*([abc])\b/i);
    return {
      category: "Driver License / CDL",
      certName: classMatch ? `Commercial Driver License (CDL-${classMatch[1].toUpperCase()})` : /dot/i.test(text) ? "DOT Medical / CDL" : "Driver License",
      issuingBody: /dot/i.test(text) ? "FMCSA / DOT" : "State DMV"
    };
  }
  if (/\b(forklift|powered industrial truck|pit operator)\b/.test(lower)) {
    return {
      category: "Forklift",
      certName: "Forklift Operator Certification",
      issuingBody: "OSHA PIT Compliance"
    };
  }
  if (/\b(epa\s*608|section\s*608|refrigerant|universal)\b/.test(lower)) {
    return {
      category: "EPA 608",
      certName: "EPA Section 608 Universal",
      issuingBody: "U.S. EPA"
    };
  }
  if (/\b(first\s*aid)\b/.test(lower)) {
    return {
      category: "First Aid",
      certName: "First Aid & Bloodborne Pathogens",
      issuingBody: /red cross/i.test(text) ? "American Red Cross" : null
    };
  }
  return {
    category: "Custom",
    certName: "Compliance Certification",
    issuingBody: null
  };
}
function extractCertificateNumber(text) {
  const patterns = [
    /(?:cert(?:ificate)?\s*(?:id|no\.?|#|number)?|card\s*(?:id|no\.?|#)|lic(?:ense)?\s*(?:no\.?|#|id)?|id\s*#?|\bdl\b)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,22})/i,
    /\b((?:OSHA|AHA|ARC|CDL|EPA|FLT)-[A-Z0-9-]{3,18})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim().toUpperCase();
    }
  }
  return null;
}
function extractHolderName(text) {
  const labeled = text.match(
    /(?:name|issued\s+to|holder|student|operator|employee)\s*[:\-]\s*([A-Za-z][A-Za-z.'-]{1,20}(?:\s+[A-Za-z][A-Za-z.'-]{1,20}){1,2})/i
  );
  if (labeled?.[1]) {
    return labeled[1].trim();
  }
  return null;
}
function parseCertificateText(rawText, hintText = "", engine = "tesseract_parser") {
  const combined = [rawText, hintText].filter(Boolean).join("\n");
  const candidates = extractDateCandidates(combined);
  const expiryCandidates = candidates.filter((c) => c.kind === "expiry").sort((a, b) => b.score - a.score || b.iso.localeCompare(a.iso));
  const issuedCandidates = candidates.filter((c) => c.kind === "issued").sort((a, b) => b.score - a.score || a.iso.localeCompare(b.iso));
  const unknownSorted = candidates.filter((c) => c.kind === "unknown").sort((a, b) => b.iso.localeCompare(a.iso));
  const expiryDate = expiryCandidates[0]?.iso ?? unknownSorted[0]?.iso ?? null;
  const issuedDate = issuedCandidates[0]?.iso ?? (unknownSorted.length > 1 ? unknownSorted[unknownSorted.length - 1].iso : null);
  const classified = classifyCertificationType(combined);
  const certificateNumber = extractCertificateNumber(combined);
  const holderName = extractHolderName(combined);
  const matchedLines = [];
  if (expiryCandidates[0]?.context) matchedLines.push(expiryCandidates[0].context);
  if (issuedCandidates[0]?.context) matchedLines.push(issuedCandidates[0].context);
  for (const line of combined.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !matchedLines.includes(trimmed) && /(cert|osha|cpr|aed|cdl|driver|forklift|epa|exp|valid|name|id|license)/i.test(trimmed)) {
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
    rawText: combined.trim()
  };
}
function extractEmbeddedImageText(bytes, mimeType) {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);
  if (mimeType.includes("svg") || raw.includes("<svg")) {
    const textNodes = [...raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").trim()).filter(Boolean);
    if (textNodes.length > 0) {
      return textNodes.join("\n");
    }
  }
  const printableChunks = [...raw.matchAll(/[A-Za-z0-9#/:.,\- ]{6,120}/g)].map((m) => m[0].trim()).filter(
    (s) => /(exp|valid|osha|cpr|aed|cdl|license|forklift|epa|cert|name|issued|202\d|203\d)/i.test(s)
  );
  return printableChunks.join("\n");
}
async function extractWithVisionAiIfConfigured(params) {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!gatewayKey && !openAiKey) return null;
  const endpoint = gatewayKey ? "https://ai-gateway.vercel.sh/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
  const token = gatewayKey || openAiKey;
  const model = gatewayKey ? "openai/gpt-4o-mini" : "gpt-4o-mini";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You extract employee certification details from photos. Return strict JSON with keys: certName, category (one of: 'CPR / AED', 'OSHA 10/30', 'Driver License / CDL', 'Forklift', 'EPA 608', 'First Aid', 'Custom'), holderName, certificateNumber, issuingBody, issuedDate (YYYY-MM-DD or null), expiryDate (YYYY-MM-DD or null), confidence (0..1), rawText."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract certification fields from this photo.${params.hintText ? ` SMS text hint: ${params.hintText}` : ""}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${params.mimeType};base64,${params.imageBase64}`
                }
              }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
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
      rawText
    };
  } catch {
    return null;
  }
}

// src/lib/csv-importer.ts
function splitDelimitedLine(line, delimiter) {
  const cells = [];
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
function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return raw.trim();
}
function normalizeDateCell(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const candidates = extractDateCandidates(`Expiry: ${trimmed}`);
  return candidates[0]?.iso ?? null;
}
var HEADER_MATCHERS = [
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
  { key: "expiryDate", regex: /^(exp(iry|iration|ires)?|valid[\s_-]*(thru|until)|due|renewal)([\s_-]*date)?$/i }
];
function parseSpreadsheetInput(rawInput) {
  const lines = rawInput.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) {
    return {
      delimiter: "comma",
      rows: [],
      errors: [{ rowIndex: 1, message: "Paste a header row plus at least one employee row." }],
      uniqueEmployeeCount: 0
    };
  }
  const headerLine = lines[0];
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const delimiterName = tabCount >= commaCount && tabCount > 0 ? "tab" : semiCount > commaCount ? "semicolon" : "comma";
  const delimiterChar = delimiterName === "tab" ? "	" : delimiterName === "semicolon" ? ";" : ",";
  const headers = splitDelimitedLine(headerLine, delimiterChar);
  const columnMap = /* @__PURE__ */ new Map();
  headers.forEach((header, idx) => {
    const clean = header.replace(/^\uFEFF/, "").trim();
    for (const matcher of HEADER_MATCHERS) {
      if (matcher.regex.test(clean) && !columnMap.has(matcher.key)) {
        columnMap.set(matcher.key, idx);
        break;
      }
    }
  });
  const rows = [];
  const errors = [];
  const todayIso = toIsoDateString(/* @__PURE__ */ new Date());
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitDelimitedLine(lines[i], delimiterChar);
    const getCell = (key) => {
      const idx = columnMap.get(key);
      return idx !== void 0 ? (cells[idx] ?? "").trim() : "";
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
        message: `Unrecognized expiry date "${expiryRaw || "(blank)"}" for ${fullName}. Use YYYY-MM-DD or MM/DD/YYYY.`
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
      certificateNumber: getCell("certificateNumber") || `IMP-${String(1e3 + i)}`,
      issuingBody: getCell("issuingBody") || classified.issuingBody || "Verified Issuer",
      issuedDate,
      expiryDate
    });
  }
  const uniqueKeys = new Set(rows.map((r) => `${r.fullName.toLowerCase()}::${r.phone}`));
  return {
    delimiter: delimiterName,
    rows,
    errors,
    uniqueEmployeeCount: uniqueKeys.size
  };
}

// src/lib/seed.ts
var DEMO_WORKSPACE_SLUG = "summit-mechanical";
function readLiveIntegrationFlags() {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER || "+15125550190";
  const resendKey = process.env.RESEND_API_KEY;
  const visionKey = process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY;
  return {
    portalSmsNumber: twilioFrom,
    twilioFromNumber: twilioFrom,
    hasTwilioConfig: Boolean(twilioSid && twilioToken && process.env.TWILIO_FROM_NUMBER),
    hasResendConfig: Boolean(resendKey),
    hasVisionAiConfig: Boolean(visionKey)
  };
}
function createDemoWorkspace(referenceDate = /* @__PURE__ */ new Date()) {
  const todayIso = toIsoDateString(referenceDate);
  const nowIso = referenceDate.toISOString();
  const offset = (days) => addDaysToIsoDate(todayIso, days);
  const issuedAgo = (expiryIso, years = 2) => addDaysToIsoDate(expiryIso, -365 * years);
  const employees = [
    {
      id: "emp-marcus",
      fullName: "Marcus Vance",
      roleTitle: "Senior HVAC Tech",
      department: "Commercial HVAC",
      phone: "+15125550112",
      email: "marcus.vance@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_marcus_49a2",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-elena",
      fullName: "Elena Rostova",
      roleTitle: "Safety Foreman",
      department: "Field Operations",
      phone: "+15125550118",
      email: "elena.rostova@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_elena_88c4",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-devon",
      fullName: "Devon Brooks",
      roleTitle: "Fleet Delivery Driver",
      department: "Logistics & Rigging",
      phone: "+15125550124",
      email: "devon.brooks@summitmechanical.example",
      supervisor: {
        name: "Dana Morales",
        phone: "+15125550102",
        email: "dana.morales@summitmechanical.example"
      },
      uploadToken: "tok_devon_17f9",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-mateo",
      fullName: "Mateo Silva",
      roleTitle: "Warehouse & Lift Lead",
      department: "Logistics & Rigging",
      phone: "+15125550131",
      email: "mateo.silva@summitmechanical.example",
      supervisor: {
        name: "Dana Morales",
        phone: "+15125550102",
        email: "dana.morales@summitmechanical.example"
      },
      uploadToken: "tok_mateo_31d5",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-priya",
      fullName: "Priya Nair",
      roleTitle: "Chiller Specialist",
      department: "Commercial HVAC",
      phone: "+15125550139",
      email: "priya.nair@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_priya_64b1",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-jordan",
      fullName: "Jordan Cole",
      roleTitle: "Pipefitter II",
      department: "Field Operations",
      phone: "+15125550145",
      email: "jordan.cole@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_jordan_72e8",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-caleb",
      fullName: "Caleb Wright",
      roleTitle: "Apprentice Technician",
      department: "Field Operations",
      phone: "+15125550152",
      email: "caleb.wright@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_caleb_90a7",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-hannah",
      fullName: "Hannah Kim",
      roleTitle: "Crane Support Driver",
      department: "Logistics & Rigging",
      phone: "+15125550164",
      email: "hannah.kim@summitmechanical.example",
      supervisor: {
        name: "Dana Morales",
        phone: "+15125550102",
        email: "dana.morales@summitmechanical.example"
      },
      uploadToken: "tok_hannah_25m3",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-trevor",
      fullName: "Trevor Ortiz",
      roleTitle: "Controls Engineer",
      department: "Commercial HVAC",
      phone: "+15125550170",
      email: "trevor.ortiz@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_trevor_51k2",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-naomi",
      fullName: "Naomi Bennett",
      roleTitle: "Sheet Metal Lead",
      department: "Fabrication Shop",
      phone: "+15125550177",
      email: "naomi.bennett@summitmechanical.example",
      supervisor: {
        name: "Dana Morales",
        phone: "+15125550102",
        email: "dana.morales@summitmechanical.example"
      },
      uploadToken: "tok_naomi_84q6",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-omar",
      fullName: "Omar Haddad",
      roleTitle: "Service Coordinator",
      department: "Commercial HVAC",
      phone: "+15125550183",
      email: "omar.haddad@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_omar_19r4",
      active: true,
      createdAt: nowIso
    },
    {
      id: "emp-lucy",
      fullName: "Lucy Alvarez",
      roleTitle: "Safety Auditor",
      department: "Field Operations",
      phone: "+15125550188",
      email: "lucy.alvarez@summitmechanical.example",
      supervisor: {
        name: "Ray Kowalski",
        phone: "+15125550101",
        email: "ray.kowalski@summitmechanical.example"
      },
      uploadToken: "tok_lucy_60n9",
      active: true,
      createdAt: nowIso
    }
  ];
  const cprExp1 = offset(-11);
  const cdlExp1 = offset(-3);
  const oshaExp2 = offset(2);
  const forkExp1 = offset(5);
  const epaExp1 = offset(14);
  const aidExp1 = offset(23);
  const oshaExp3 = offset(38);
  const cdlExp2 = offset(52);
  const certifications = [
    {
      id: "cert-marcus-cpr",
      employeeId: "emp-marcus",
      certName: "CPR / AED Adult & Pediatric",
      category: "CPR / AED",
      certificateNumber: "AHA-2024-88412",
      issuingBody: "American Heart Association",
      issuedDate: issuedAgo(cprExp1),
      expiryDate: cprExp1,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-marcus-epa",
      employeeId: "emp-marcus",
      certName: "EPA 608 Universal",
      category: "EPA 608",
      certificateNumber: "EPA-U-993014",
      issuingBody: "ESCO Institute",
      issuedDate: issuedAgo(offset(420), 5),
      expiryDate: offset(420),
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-devon-cdl",
      employeeId: "emp-devon",
      certName: "Commercial Driver License (CDL Class A)",
      category: "Driver License / CDL",
      certificateNumber: "TX-CDL-994021",
      issuingBody: "Texas DPS / FMCSA",
      issuedDate: issuedAgo(cdlExp1, 4),
      expiryDate: cdlExp1,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-elena-osha",
      employeeId: "emp-elena",
      certName: "OSHA 30-Hour Construction",
      category: "OSHA 10/30",
      certificateNumber: "DOL-30-774105",
      issuingBody: "U.S. Dept of Labor OSHA",
      issuedDate: issuedAgo(oshaExp2, 3),
      expiryDate: oshaExp2,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-mateo-forklift",
      employeeId: "emp-mateo",
      certName: "Forklift & Scissor Lift Operator",
      category: "Forklift",
      certificateNumber: "OSH-FL-55192",
      issuingBody: "National Safety Council",
      issuedDate: issuedAgo(forkExp1, 3),
      expiryDate: forkExp1,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-priya-epa",
      employeeId: "emp-priya",
      certName: "EPA 608 Type II & High-Pressure",
      category: "EPA 608",
      certificateNumber: "EPA-II-441820",
      issuingBody: "ESCO Institute",
      issuedDate: issuedAgo(epaExp1, 2),
      expiryDate: epaExp1,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-jordan-firstaid",
      employeeId: "emp-jordan",
      certName: "First Aid & Bloodborne Pathogens",
      category: "First Aid",
      certificateNumber: "ARC-FA-31904",
      issuingBody: "American Red Cross",
      issuedDate: issuedAgo(aidExp1, 2),
      expiryDate: aidExp1,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-caleb-osha10",
      employeeId: "emp-caleb",
      certName: "OSHA 10-Hour Safety Card",
      category: "OSHA 10/30",
      certificateNumber: "DOL-10-610283",
      issuingBody: "U.S. Dept of Labor OSHA",
      issuedDate: issuedAgo(oshaExp3, 2),
      expiryDate: oshaExp3,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-hannah-cdl",
      employeeId: "emp-hannah",
      certName: "DOT Medical Examiner & CDL Class B",
      category: "Driver License / CDL",
      certificateNumber: "TX-CDL-801134",
      issuingBody: "FMCSA Medical Registry",
      issuedDate: issuedAgo(cdlExp2, 2),
      expiryDate: cdlExp2,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-trevor-osha",
      employeeId: "emp-trevor",
      certName: "OSHA 10-Hour General Industry",
      category: "OSHA 10/30",
      certificateNumber: "DOL-10-882419",
      issuingBody: "U.S. Dept of Labor OSHA",
      issuedDate: issuedAgo(offset(215), 2),
      expiryDate: offset(215),
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-naomi-forklift",
      employeeId: "emp-naomi",
      certName: "Powered Industrial Truck / Forklift",
      category: "Forklift",
      certificateNumber: "OSH-FL-73811",
      issuingBody: "OSHA Outreach Training",
      issuedDate: issuedAgo(offset(305), 3),
      expiryDate: offset(305),
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-omar-cpr",
      employeeId: "emp-omar",
      certName: "CPR / AED First Responder",
      category: "CPR / AED",
      certificateNumber: "AHA-2025-91204",
      issuingBody: "American Heart Association",
      issuedDate: issuedAgo(offset(480), 2),
      expiryDate: offset(480),
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    },
    {
      id: "cert-lucy-osha30",
      employeeId: "emp-lucy",
      certName: "OSHA 30-Hour Outreach Trainer",
      category: "OSHA 10/30",
      certificateNumber: "DOL-30-991042",
      issuingBody: "U.S. Dept of Labor OSHA",
      issuedDate: issuedAgo(offset(610), 4),
      expiryDate: offset(610),
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    }
  ];
  const alertDeliveries = [
    {
      id: "alt_hist_01",
      dedupeKey: `cert-marcus-cpr::7::${cprExp1}::worker::sms`,
      certificationId: "cert-marcus-cpr",
      employeeId: "emp-marcus",
      employeeName: "Marcus Vance",
      certName: "CPR / AED Adult & Pediatric",
      expiryDate: cprExp1,
      tierDays: 7,
      recipientRole: "worker",
      recipientName: "Marcus Vance",
      recipientContact: "+15125550112",
      channel: "sms",
      messageBody: `URGENT (7-day compliance window): Marcus Vance's CPR / AED expires on ${cprExp1}. Text a photo of your renewed card to +1 (512) 555-0190.`,
      deliveryMode: "sandbox_outbox",
      providerStatus: "logged",
      providerRef: null,
      sentAt: new Date(referenceDate.getTime() - 1e3 * 60 * 60 * 48).toISOString()
    },
    {
      id: "alt_hist_02",
      dedupeKey: `cert-marcus-cpr::7::${cprExp1}::supervisor::email`,
      certificationId: "cert-marcus-cpr",
      employeeId: "emp-marcus",
      employeeName: "Marcus Vance",
      certName: "CPR / AED Adult & Pediatric",
      expiryDate: cprExp1,
      tierDays: 7,
      recipientRole: "supervisor",
      recipientName: "Ray Kowalski",
      recipientContact: "ray.kowalski@summitmechanical.example",
      channel: "email",
      messageBody: `[Supervisor CC \xB7 Ray Kowalski] Marcus Vance's CPR / AED expires on ${cprExp1}. Worker has been sent mobile SMS upload link.`,
      deliveryMode: "sandbox_outbox",
      providerStatus: "logged",
      providerRef: null,
      sentAt: new Date(referenceDate.getTime() - 1e3 * 60 * 60 * 48).toISOString()
    }
  ];
  const smsMessages = [
    {
      id: "sms_hist_01",
      direction: "outbound",
      employeeId: "emp-elena",
      employeeName: "Elena Rostova",
      phone: "+15125550118",
      body: `CertPulse Alert: Hi Elena, your OSHA 30-Hour Construction (#DOL-30-774105) expires on ${oshaExp2}. Reply with a photo of your new card to auto-update your record.`,
      mediaKey: null,
      extractedSummary: null,
      createdAt: new Date(referenceDate.getTime() - 1e3 * 60 * 60 * 6).toISOString()
    },
    {
      id: "sms_hist_02",
      direction: "inbound",
      employeeId: "emp-elena",
      employeeName: "Elena Rostova",
      phone: "+15125550118",
      body: "Just finished my refresher class \u2014 snapping a photo of the new wallet card shortly!",
      mediaKey: null,
      extractedSummary: null,
      createdAt: new Date(referenceDate.getTime() - 1e3 * 60 * 45).toISOString()
    }
  ];
  return {
    id: "ws_summit_01",
    slug: DEMO_WORKSPACE_SLUG,
    companyName: "Summit Mechanical & HVAC",
    industry: "Mechanical Contracting & Facility Service",
    timezone: "America/Chicago",
    createdAt: nowIso,
    updatedAt: nowIso,
    billing: {
      planId: "free_forever",
      planName: "Free Forever ($0/mo)",
      monthlyPriceUsd: 0,
      seatLimit: null,
      status: "active",
      cardBrand: null,
      cardLast4: null,
      billingEmail: "safety@summitmechanical.example",
      setupCompletedAt: nowIso,
      setupDurationSeconds: 185,
      currentPeriodEnd: "never",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    },
    integrations: readLiveIntegrationFlags(),
    employees,
    certifications,
    alertRules: DEFAULT_ALERT_RULES.map((r) => ({ ...r, channels: [...r.channels] })),
    alertDeliveries,
    smsMessages
  };
}
function createFreshWorkspace(params) {
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  return {
    id: `ws_${crypto.randomUUID().slice(0, 8)}`,
    slug: params.slug,
    companyName: params.companyName.trim(),
    industry: params.industry.trim() || "Field Operations & Trades",
    timezone: "America/Chicago",
    createdAt: nowIso,
    updatedAt: nowIso,
    billing: {
      planId: "free_forever",
      planName: "Free Forever ($0/mo)",
      monthlyPriceUsd: 0,
      seatLimit: null,
      status: "active",
      cardBrand: null,
      cardLast4: null,
      billingEmail: params.billingEmail.trim(),
      setupCompletedAt: nowIso,
      setupDurationSeconds: params.setupDurationSeconds ?? 210,
      currentPeriodEnd: "never",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    },
    integrations: readLiveIntegrationFlags(),
    employees: [],
    certifications: [],
    alertRules: DEFAULT_ALERT_RULES.map((r) => ({ ...r, channels: [...r.channels] })),
    alertDeliveries: [],
    smsMessages: []
  };
}

// src/lib/workspace-service.ts
var WORKSPACE_PREFIX = "certpulse/workspaces";
var MEDIA_PREFIX = "certpulse/media";
var AppError = class extends Error {
  constructor(status, message, code = "APP_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
};
function workspaceKey(slug) {
  return `${WORKSPACE_PREFIX}/${slug}.json`;
}
function slugifyCompanyName(name) {
  const cleaned = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `team-${crypto.randomUUID().slice(0, 6)}`;
}
function hydrateWorkspace(ws) {
  return {
    ...ws,
    billing: {
      ...ws.billing,
      planId: "free_forever",
      planName: "Free Forever ($0/mo)",
      monthlyPriceUsd: 0,
      seatLimit: null,
      status: "active",
      cardBrand: null,
      cardLast4: null,
      currentPeriodEnd: "never",
      stripeCustomerId: null,
      stripeSubscriptionId: null
    },
    integrations: readLiveIntegrationFlags()
  };
}
async function ensureSeededWorkspaces(storage) {
  const existingKeys = await storage.listKeys(WORKSPACE_PREFIX);
  if (existingKeys.length > 0) return;
  const demo = createDemoWorkspace(/* @__PURE__ */ new Date());
  await storage.putJson(workspaceKey(demo.slug), demo);
}
async function listWorkspaceSummaries(storage) {
  await ensureSeededWorkspaces(storage);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  const loaded = await Promise.all(keys.map((k) => storage.getJson(k)));
  const summaries = [];
  for (const raw of loaded) {
    if (!raw) continue;
    const ws = hydrateWorkspace(raw);
    summaries.push({
      id: ws.id,
      slug: ws.slug,
      companyName: ws.companyName,
      industry: ws.industry,
      seatCount: ws.employees.filter((e) => e.active).length,
      seatLimit: ws.billing.seatLimit,
      planName: ws.billing.planName,
      monthlyPriceUsd: ws.billing.monthlyPriceUsd
    });
  }
  return summaries.sort((a, b) => {
    if (a.slug === DEMO_WORKSPACE_SLUG) return -1;
    if (b.slug === DEMO_WORKSPACE_SLUG) return 1;
    return a.companyName.localeCompare(b.companyName);
  });
}
async function getWorkspace(storage, slug) {
  const cleanSlug = slugifyCompanyName(slug);
  let ws = await storage.getJson(workspaceKey(cleanSlug));
  if (!ws && cleanSlug === DEMO_WORKSPACE_SLUG) {
    ws = createDemoWorkspace(/* @__PURE__ */ new Date());
    await storage.putJson(workspaceKey(cleanSlug), ws);
  }
  if (!ws) {
    throw new AppError(404, `Workspace "${slug}" not found.`, "WORKSPACE_NOT_FOUND");
  }
  return hydrateWorkspace(ws);
}
async function saveWorkspace(storage, workspace) {
  const updated = {
    ...workspace,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    integrations: readLiveIntegrationFlags()
  };
  await storage.putJson(workspaceKey(updated.slug), updated);
  return updated;
}
async function createWorkspaceRecord(storage, input) {
  let targetSlug = slugifyCompanyName(input.slug || input.companyName);
  const existing = await storage.getJson(workspaceKey(targetSlug));
  if (existing) {
    targetSlug = `${targetSlug}-${crypto.randomUUID().slice(0, 4)}`;
  }
  const ws = createFreshWorkspace({
    slug: targetSlug,
    companyName: input.companyName,
    industry: input.industry || "Field Operations & Trades",
    billingEmail: input.billingEmail,
    setupDurationSeconds: input.setupDurationSeconds
  });
  return saveWorkspace(storage, ws);
}
async function addEmployeeToWorkspace(storage, slug, input) {
  const ws = await getWorkspace(storage, slug);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const slugTag = input.fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const employee = {
    id: `emp_${crypto.randomUUID().slice(0, 8)}`,
    fullName: input.fullName.trim(),
    roleTitle: input.roleTitle?.trim() || "Field Technician",
    department: input.department?.trim() || "Operations",
    phone: normalizePhone(input.phone),
    email: input.email?.trim() || `${slugTag}@company-team.local`,
    supervisor: {
      name: input.supervisorName.trim(),
      phone: normalizePhone(input.supervisorPhone),
      email: input.supervisorEmail?.trim() || "supervisor@company-team.local"
    },
    uploadToken: `tok_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    active: true,
    createdAt: nowIso
  };
  ws.employees.push(employee);
  let certification = null;
  if (input.initialCert?.certName && input.initialCert.expiryDate) {
    const classified = classifyCertificationType(input.initialCert.certName);
    const issued = input.initialCert.issuedDate || addDaysToIsoDate(input.initialCert.expiryDate, -730);
    const createdCert = {
      id: `cert_${crypto.randomUUID().slice(0, 8)}`,
      employeeId: employee.id,
      certName: input.initialCert.certName.trim(),
      category: classified.category,
      certificateNumber: input.initialCert.certificateNumber?.trim() || `CERT-${Math.floor(1e4 + Math.random() * 89999)}`,
      issuingBody: input.initialCert.issuingBody?.trim() || classified.issuingBody || "Verified Issuer",
      issuedDate: issued,
      expiryDate: input.initialCert.expiryDate,
      photoKey: null,
      ocrConfidence: null,
      ocrRawText: null,
      lastRenewedAt: null,
      updatedAt: nowIso
    };
    certification = createdCert;
    ws.certifications.push(createdCert);
  }
  const saved = await saveWorkspace(storage, ws);
  return { workspace: saved, employee, certification };
}
async function updateEmployeeInWorkspace(storage, slug, employeeId, patch) {
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
    supervisor: patch.supervisor ? {
      name: patch.supervisor.name.trim(),
      phone: normalizePhone(patch.supervisor.phone),
      email: patch.supervisor.email.trim()
    } : existing.supervisor
  };
  return saveWorkspace(storage, ws);
}
async function deleteEmployeeFromWorkspace(storage, slug, employeeId) {
  const ws = await getWorkspace(storage, slug);
  const before = ws.employees.length;
  ws.employees = ws.employees.filter((e) => e.id !== employeeId);
  if (ws.employees.length === before) {
    throw new AppError(404, "Employee not found.", "EMPLOYEE_NOT_FOUND");
  }
  ws.certifications = ws.certifications.filter((c) => c.employeeId !== employeeId);
  return saveWorkspace(storage, ws);
}
async function upsertCertificationInWorkspace(storage, slug, input) {
  const ws = await getWorkspace(storage, slug);
  const emp = ws.employees.find((e) => e.id === input.employeeId);
  if (!emp) {
    throw new AppError(404, "Target employee not found.", "EMPLOYEE_NOT_FOUND");
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const classified = classifyCertificationType(input.certName);
  if (input.id) {
    const idx = ws.certifications.findIndex((c) => c.id === input.id);
    if (idx === -1) {
      throw new AppError(404, "Certification not found.", "CERT_NOT_FOUND");
    }
    const prev = ws.certifications[idx];
    const updatedCert = {
      ...prev,
      certName: input.certName.trim(),
      category: input.category ?? classified.category,
      certificateNumber: input.certificateNumber?.trim() || prev.certificateNumber,
      issuingBody: input.issuingBody?.trim() || classified.issuingBody || prev.issuingBody,
      issuedDate: input.issuedDate || prev.issuedDate,
      expiryDate: input.expiryDate,
      updatedAt: nowIso
    };
    ws.certifications[idx] = updatedCert;
    const saved2 = await saveWorkspace(storage, ws);
    return { workspace: saved2, certification: updatedCert };
  }
  const createdCert = {
    id: `cert_${crypto.randomUUID().slice(0, 8)}`,
    employeeId: emp.id,
    certName: input.certName.trim(),
    category: input.category ?? classified.category,
    certificateNumber: input.certificateNumber?.trim() || `CERT-${Math.floor(1e4 + Math.random() * 89999)}`,
    issuingBody: input.issuingBody?.trim() || classified.issuingBody || "Verified Issuer",
    issuedDate: input.issuedDate || addDaysToIsoDate(input.expiryDate, -730),
    expiryDate: input.expiryDate,
    photoKey: null,
    ocrConfidence: null,
    ocrRawText: null,
    lastRenewedAt: null,
    updatedAt: nowIso
  };
  ws.certifications.push(createdCert);
  const saved = await saveWorkspace(storage, ws);
  return { workspace: saved, certification: createdCert };
}
async function importSpreadsheetToWorkspace(storage, slug, rawSpreadsheetText) {
  const ws = await getWorkspace(storage, slug);
  const parsed = parseSpreadsheetInput(rawSpreadsheetText);
  if (parsed.rows.length === 0) {
    throw new AppError(
      400,
      parsed.errors[0]?.message || "No valid rows found in spreadsheet input.",
      "INVALID_SPREADSHEET"
    );
  }
  const findExistingEmployee = (name, phone) => {
    const cleanName = name.trim().toLowerCase();
    const cleanPhone = normalizePhone(phone);
    return ws.employees.find(
      (e) => e.fullName.trim().toLowerCase() === cleanName || cleanPhone.length >= 10 && normalizePhone(e.phone) === cleanPhone
    );
  };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
          email: row.supervisorEmail
        },
        uploadToken: `tok_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        active: true,
        createdAt: nowIso
      };
      ws.employees.push(emp);
      addedEmployees += 1;
    }
    const existingCert = ws.certifications.find(
      (c) => c.employeeId === emp.id && (c.certName.toLowerCase() === row.certName.toLowerCase() || c.category === row.category)
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
        updatedAt: nowIso
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
    errors: parsed.errors
  };
}
async function extractCertificationFromSubmission(params) {
  if (params.imageBytes && params.mimeType) {
    const base64 = Buffer.from(params.imageBytes).toString("base64");
    const visionResult = await extractWithVisionAiIfConfigured({
      imageBase64: base64,
      mimeType: params.mimeType,
      hintText: params.hintText
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
function guessFileExtension(mimeType) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  if (mimeType.includes("pdf")) return "pdf";
  return "bin";
}
async function processInboundRenewal(storage, slug, params) {
  const ws = await getWorkspace(storage, slug);
  let employee;
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
    hintText: params.messageText
  });
  if (!employee && extraction.holderName) {
    const holderLower = extraction.holderName.toLowerCase();
    employee = ws.employees.find((e) => e.fullName.toLowerCase().includes(holderLower));
  }
  if (!employee) {
    throw new AppError(
      404,
      "Could not match sender phone number, token, or employee on this account.",
      "EMPLOYEE_NOT_MATCHED"
    );
  }
  let mediaKey = null;
  if (params.imageBytes && params.imageBytes.length > 0 && params.mimeType) {
    const ext = guessFileExtension(params.mimeType);
    const key = `${MEDIA_PREFIX}/${ws.slug}/${employee.id}-${Date.now()}.${ext}`;
    mediaKey = await storage.putMedia(key, params.imageBytes, params.mimeType);
  }
  const finalCertName = params.overrideCertName?.trim() || extraction.certName || "Safety Certification Renewal";
  const finalCategory = extraction.category;
  const todayIso = toIsoDateString(/* @__PURE__ */ new Date());
  const finalExpiry = params.overrideExpiryDate?.trim() || extraction.expiryDate || addDaysToIsoDate(todayIso, 730);
  const finalIssued = extraction.issuedDate || addDaysToIsoDate(finalExpiry, -730);
  const finalCertNum = params.overrideCertificateNumber?.trim() || extraction.certificateNumber || `OCR-${Math.floor(1e5 + Math.random() * 899999)}`;
  let cert;
  if (params.certificationId) {
    cert = ws.certifications.find(
      (c) => c.id === params.certificationId && c.employeeId === employee.id
    );
  }
  if (!cert) {
    const employeeCerts = ws.certifications.filter((c) => c.employeeId === employee.id);
    cert = employeeCerts.find((c) => c.category === finalCategory) ?? employeeCerts.find(
      (c) => c.certName.toLowerCase().includes(finalCertName.toLowerCase()) || finalCertName.toLowerCase().includes(c.certName.toLowerCase())
    ) ?? (employeeCerts.length === 1 ? employeeCerts[0] : void 0);
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
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
      updatedAt: nowIso
    };
    ws.certifications.push(cert);
  }
  const summary = `${cert.certName} (#${cert.certificateNumber}) \xB7 New Expiry ${cert.expiryDate} \xB7 OCR ${Math.round(extraction.confidence * 100)}%`;
  const inboundMessage = {
    id: `sms_${crypto.randomUUID().slice(0, 8)}`,
    direction: "inbound",
    employeeId: employee.id,
    employeeName: employee.fullName,
    phone: params.fromPhone ? normalizePhone(params.fromPhone) : employee.phone,
    body: params.messageText?.trim() || "[Photo MMS Upload]",
    mediaKey,
    extractedSummary: summary,
    createdAt: nowIso
  };
  const replyText = `CertPulse Verified: Thanks ${employee.fullName.split(" ")[0]}! Updated ${cert.certName} (#${cert.certificateNumber}) with new expiry ${cert.expiryDate}. Upcoming 60/30/7 alerts reset automatically.`;
  await sendTwilioSmsIfConfigured(employee.phone, replyText);
  const replyMessage = {
    id: `sms_${crypto.randomUUID().slice(0, 8)}`,
    direction: "outbound",
    employeeId: employee.id,
    employeeName: employee.fullName,
    phone: employee.phone,
    body: replyText,
    mediaKey: null,
    extractedSummary: null,
    createdAt: new Date(Date.now() + 500).toISOString()
  };
  ws.smsMessages.unshift(replyMessage, inboundMessage);
  ws.smsMessages = ws.smsMessages.slice(0, 100);
  const saved = await saveWorkspace(storage, ws);
  return {
    workspace: saved,
    employee,
    certification: cert,
    extraction,
    replyMessage
  };
}
async function triggerWorkspaceSweep(storage, slug, options = {}) {
  const ws = await getWorkspace(storage, slug);
  const { dispatched, skippedDeduplicated } = await runEscalationSweep(ws, options);
  if (dispatched.length > 0) {
    ws.alertDeliveries = [...dispatched.reverse(), ...ws.alertDeliveries].slice(0, 200);
    const smsEchoes = dispatched.filter((d) => d.channel === "sms" && d.recipientRole === "worker").map((d) => ({
      id: `sms_${crypto.randomUUID().slice(0, 8)}`,
      direction: "outbound",
      employeeId: d.employeeId,
      employeeName: d.employeeName,
      phone: d.recipientContact,
      body: d.messageBody,
      mediaKey: null,
      extractedSummary: null,
      createdAt: d.sentAt
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
    skippedDeduplicated
  };
}
async function updateWorkspaceAlertRules(storage, slug, rules) {
  const ws = await getWorkspace(storage, slug);
  ws.alertRules = rules;
  return saveWorkspace(storage, ws);
}
async function resolveMobilePortalByToken(storage, token) {
  await ensureSeededWorkspaces(storage);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  for (const key of keys) {
    const ws = await storage.getJson(key);
    if (!ws) continue;
    const emp = ws.employees.find((e) => e.uploadToken === token && e.active);
    if (emp) {
      return {
        workspace: hydrateWorkspace(ws),
        employee: emp,
        certifications: ws.certifications.filter((c) => c.employeeId === emp.id)
      };
    }
  }
  throw new AppError(404, "Mobile upload link is invalid or expired.", "TOKEN_NOT_FOUND");
}
async function findWorkspaceByPhone(storage, fromPhone) {
  await ensureSeededWorkspaces(storage);
  const norm = normalizePhone(fromPhone);
  const keys = await storage.listKeys(WORKSPACE_PREFIX);
  for (const key of keys) {
    const ws = await storage.getJson(key);
    if (!ws) continue;
    const emp = ws.employees.find((e) => e.active && normalizePhone(e.phone) === norm);
    if (emp) {
      return { workspace: hydrateWorkspace(ws), employee: emp };
    }
  }
  return null;
}
function escapeCsvCell(value) {
  const safe = /^[=@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
function exportWorkspaceToCsv(workspace) {
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
    "Last Renewed"
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
      c.lastRenewedAt ?? ""
    ];
    return cells.map(escapeCsvCell).join(",");
  });
  return [header, ...rows].join("\n");
}

// api/index.ts
var app = new Hono().basePath("/api");
var createWorkspaceSchema = z.object({
  companyName: z.string().min(2).max(120),
  slug: z.string().min(2).max(80).optional(),
  industry: z.string().max(120).optional(),
  billingEmail: z.string().email(),
  setupDurationSeconds: z.number().int().min(1).max(3600).optional()
});
var addEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100),
  roleTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().min(7).max(32),
  email: z.string().email().optional().or(z.literal("")),
  supervisorName: z.string().min(2).max(100),
  supervisorPhone: z.string().min(7).max(32),
  supervisorEmail: z.string().email().optional().or(z.literal("")),
  initialCert: z.object({
    certName: z.string().min(2).max(120),
    certificateNumber: z.string().max(80).optional(),
    issuingBody: z.string().max(120).optional(),
    issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).optional()
});
var updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  roleTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().min(7).max(32).optional(),
  email: z.string().email().optional(),
  active: z.boolean().optional(),
  supervisor: z.object({
    name: z.string().min(2).max(100),
    phone: z.string().min(7).max(32),
    email: z.string().email()
  }).optional()
});
var upsertCertSchema = z.object({
  id: z.string().optional(),
  employeeId: z.string().min(2),
  certName: z.string().min(2).max(120),
  category: z.enum([
    "CPR / AED",
    "OSHA 10/30",
    "Driver License / CDL",
    "Forklift",
    "EPA 608",
    "First Aid",
    "Custom"
  ]).optional(),
  certificateNumber: z.string().max(80).optional(),
  issuingBody: z.string().max(120).optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
var importCsvSchema = z.object({
  rawText: z.string().min(5)
});
var alertRuleSchema = z.object({
  id: z.string().min(2),
  daysBefore: z.number().int().min(0).max(365),
  label: z.string().min(2).max(80),
  severity: z.enum(["watch", "warning", "critical", "expired"]),
  enabled: z.boolean(),
  notifyWorker: z.boolean(),
  notifySupervisor: z.boolean(),
  channels: z.array(z.enum(["sms", "email"])).min(1),
  template: z.string().min(5).max(500)
});
var updateRulesSchema = z.object({
  rules: z.array(alertRuleSchema).min(1).max(10)
});
async function readJsonBody(req) {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "Invalid JSON request body.", "INVALID_JSON");
  }
}
function getRequestBaseUrl(req) {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://certpulse.vercel.app";
  }
}
var XML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
};
function escapeXml(value) {
  return value.replace(/[&<>"']/g, (ch) => XML_ESCAPE_MAP[ch] ?? ch);
}
async function parseSubmissionPayload(req) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const fileEntry = form.get("photo") ?? form.get("file");
    let imageBytes2;
    let mimeType;
    if (fileEntry && typeof fileEntry === "object" && "arrayBuffer" in fileEntry) {
      const buf = await fileEntry.arrayBuffer();
      imageBytes2 = new Uint8Array(buf);
      mimeType = fileEntry.type || "image/png";
    }
    const str = (key) => {
      const val = form.get(key);
      return typeof val === "string" && val.trim().length > 0 ? val.trim() : void 0;
    };
    return {
      employeeId: str("employeeId"),
      uploadToken: str("uploadToken"),
      fromPhone: str("fromPhone"),
      certificationId: str("certificationId"),
      messageText: str("messageText"),
      rawOcrText: str("rawOcrText"),
      overrideExpiryDate: str("overrideExpiryDate"),
      overrideCertName: str("overrideCertName"),
      overrideCertificateNumber: str("overrideCertificateNumber"),
      imageBytes: imageBytes2,
      mimeType
    };
  }
  const body = await readJsonBody(req);
  let imageBytes;
  if (body.imageBase64) {
    const cleaned = body.imageBase64.replace(/^data:[^;]+;base64,/, "");
    imageBytes = new Uint8Array(Buffer.from(cleaned, "base64"));
  }
  return {
    employeeId: body.employeeId,
    uploadToken: body.uploadToken,
    fromPhone: body.fromPhone,
    certificationId: body.certificationId,
    messageText: body.messageText,
    rawOcrText: body.rawOcrText,
    overrideExpiryDate: body.overrideExpiryDate,
    overrideCertName: body.overrideCertName,
    overrideCertificateNumber: body.overrideCertificateNumber,
    imageBytes,
    mimeType: body.mimeType || (imageBytes ? "image/png" : void 0)
  };
}
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status);
  }
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: err.issues[0]?.message || "Validation failed.",
        code: "VALIDATION_ERROR",
        issues: err.issues
      },
      400
    );
  }
  console.error("[certpulse-api] Unhandled error:", err);
  return c.json(
    {
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR"
    },
    500
  );
});
app.get("/health", async (c) => {
  const storage = getStorage();
  await ensureSeededWorkspaces(storage);
  return c.json({
    ok: true,
    service: "certpulse",
    storageDriver: storage.driver,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/workspaces", async (c) => {
  const storage = getStorage();
  const workspaces = await listWorkspaceSummaries(storage);
  return c.json({ workspaces });
});
app.post("/workspaces", async (c) => {
  const payload = createWorkspaceSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const workspace = await createWorkspaceRecord(storage, payload);
  return c.json(
    {
      workspace,
      metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications)
    },
    201
  );
});
app.get("/workspaces/:slug", async (c) => {
  const storage = getStorage();
  const workspace = await getWorkspace(storage, c.req.param("slug"));
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications)
  });
});
app.post("/workspaces/:slug/employees", async (c) => {
  const payload = addEmployeeSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const result = await addEmployeeToWorkspace(storage, c.req.param("slug"), {
    ...payload,
    email: payload.email || void 0,
    supervisorEmail: payload.supervisorEmail || void 0
  });
  return c.json(
    {
      ...result,
      metrics: computeWorkspaceMetrics(
        result.workspace.employees,
        result.workspace.certifications
      )
    },
    201
  );
});
app.patch("/workspaces/:slug/employees/:id", async (c) => {
  const patch = updateEmployeeSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const workspace = await updateEmployeeInWorkspace(
    storage,
    c.req.param("slug"),
    c.req.param("id"),
    patch
  );
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications)
  });
});
app.delete("/workspaces/:slug/employees/:id", async (c) => {
  const storage = getStorage();
  const workspace = await deleteEmployeeFromWorkspace(
    storage,
    c.req.param("slug"),
    c.req.param("id")
  );
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications)
  });
});
app.post("/workspaces/:slug/certifications", async (c) => {
  const payload = upsertCertSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const result = await upsertCertificationInWorkspace(
    storage,
    c.req.param("slug"),
    payload
  );
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications
    )
  });
});
app.post("/workspaces/:slug/import", async (c) => {
  const payload = importCsvSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const result = await importSpreadsheetToWorkspace(
    storage,
    c.req.param("slug"),
    payload.rawText
  );
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications
    )
  });
});
app.post("/workspaces/:slug/ocr", async (c) => {
  const parsed = await parseSubmissionPayload(c.req.raw);
  const extraction = await extractCertificationFromSubmission({
    imageBytes: parsed.imageBytes,
    mimeType: parsed.mimeType,
    rawOcrText: parsed.rawOcrText,
    hintText: parsed.messageText
  });
  return c.json({ extraction });
});
app.post("/workspaces/:slug/sms/inbound", async (c) => {
  const parsed = await parseSubmissionPayload(c.req.raw);
  const storage = getStorage();
  const result = await processInboundRenewal(storage, c.req.param("slug"), parsed);
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications
    )
  });
});
app.post("/workspaces/:slug/alerts/sweep", async (c) => {
  const storage = getStorage();
  const baseUrl = getRequestBaseUrl(c.req.raw);
  let forceCertificationId;
  try {
    const body = await c.req.json();
    forceCertificationId = body?.forceCertificationId;
  } catch {
  }
  const result = await triggerWorkspaceSweep(storage, c.req.param("slug"), {
    baseUrl,
    forceCertificationId
  });
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications
    )
  });
});
app.patch("/workspaces/:slug/alerts/rules", async (c) => {
  const payload = updateRulesSchema.parse(await readJsonBody(c.req.raw));
  const storage = getStorage();
  const workspace = await updateWorkspaceAlertRules(
    storage,
    c.req.param("slug"),
    payload.rules
  );
  return c.json({ workspace });
});
app.post("/workspaces/:slug/alerts/reset-defaults", async (c) => {
  const storage = getStorage();
  const ws = await getWorkspace(storage, c.req.param("slug"));
  ws.alertRules = DEFAULT_ALERT_RULES.map((r) => ({ ...r, channels: [...r.channels] }));
  const workspace = await saveWorkspace(storage, ws);
  return c.json({ workspace });
});
app.get("/workspaces/:slug/export.csv", async (c) => {
  const storage = getStorage();
  const ws = await getWorkspace(storage, c.req.param("slug"));
  const csv = exportWorkspaceToCsv(ws);
  const safeSlug = ws.slug.replace(/[^a-zA-Z0-9_-]/g, "") || "workspace";
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeSlug}-compliance.csv"`
    }
  });
});
app.get("/workspaces/:slug/files", async (c) => {
  const key = c.req.query("key");
  const slug = c.req.param("slug").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!key || !slug || key.includes("..") || key.includes("\\") || key.includes("\0") || !key.startsWith(`certpulse/media/${slug}/`)) {
    return c.json({ error: "Invalid media key for workspace." }, 400);
  }
  const storage = getStorage();
  const media = await storage.getMedia(key);
  if (!media) {
    return c.json({ error: "File not found." }, 404);
  }
  return new Response(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      "Content-Type": media.contentType,
      "Cache-Control": "private, max-age=3600"
    }
  });
});
app.get("/mobile/:token", async (c) => {
  const storage = getStorage();
  const data = await resolveMobilePortalByToken(storage, c.req.param("token"));
  return c.json({
    workspaceSlug: data.workspace.slug,
    companyName: data.workspace.companyName,
    portalSmsNumber: data.workspace.integrations.portalSmsNumber,
    employee: data.employee,
    certifications: data.certifications
  });
});
app.post("/mobile/:token/submit", async (c) => {
  const storage = getStorage();
  const token = c.req.param("token");
  const data = await resolveMobilePortalByToken(storage, token);
  const parsed = await parseSubmissionPayload(c.req.raw);
  const result = await processInboundRenewal(storage, data.workspace.slug, {
    ...parsed,
    employeeId: data.employee.id,
    uploadToken: token
  });
  return c.json({
    ok: true,
    certification: result.certification,
    extraction: result.extraction,
    replyMessage: result.replyMessage
  });
});
app.post("/webhooks/twilio", async (c) => {
  const storage = getStorage();
  const form = await c.req.raw.formData();
  const fromPhone = String(form.get("From") ?? "");
  const bodyText = String(form.get("Body") ?? "");
  const mediaUrl = String(form.get("MediaUrl0") ?? "");
  const mediaType = String(form.get("MediaContentType0") ?? "image/png");
  if (!fromPhone) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>CertPulse: Missing sender phone number.</Message></Response>`,
      400,
      { "Content-Type": "application/xml" }
    );
  }
  const matched = await findWorkspaceByPhone(storage, fromPhone);
  if (!matched) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>CertPulse: We could not find ${escapeXml(fromPhone)} on an active roster. Ask your supervisor to add your mobile number.</Message></Response>`,
      200,
      { "Content-Type": "application/xml" }
    );
  }
  let imageBytes;
  if (mediaUrl) {
    try {
      const isPrivateOrReservedIpv4 = (host) => {
        const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
        if (!match) return false;
        const parts = match.slice(1).map(Number);
        if (parts.some((n) => n > 255)) return true;
        return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
      };
      const validateSafeHttpsUrl = (raw) => {
        try {
          const parsed = new URL(raw);
          if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
            return null;
          }
          const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
          if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.includes(":") || isPrivateOrReservedIpv4(host)) {
            return null;
          }
          return parsed;
        } catch {
          return null;
        }
      };
      const initialUrl = validateSafeHttpsUrl(mediaUrl);
      const isTwilioMediaHost = initialUrl !== null && (initialUrl.hostname.toLowerCase() === "api.twilio.com" || initialUrl.hostname.toLowerCase().endsWith(".twiliocdn.com"));
      if (initialUrl && isTwilioMediaHost) {
        const headers = {};
        if (initialUrl.hostname.toLowerCase() === "api.twilio.com" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
          const creds = Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64");
          headers.Authorization = `Basic ${creds}`;
        }
        let res = await fetch(initialUrl.toString(), {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(1e4)
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          const redirectUrl = location ? validateSafeHttpsUrl(new URL(location, initialUrl).toString()) : null;
          if (redirectUrl) {
            res = await fetch(redirectUrl.toString(), {
              redirect: "error",
              signal: AbortSignal.timeout(1e4)
            });
          }
        }
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && (!contentType || contentType.startsWith("image/"))) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.byteLength <= 5 * 1024 * 1024) {
            imageBytes = buf;
          }
        }
      }
    } catch {
    }
  }
  const result = await processInboundRenewal(storage, matched.workspace.slug, {
    employeeId: matched.employee.id,
    fromPhone,
    messageText: bodyText,
    imageBytes,
    mimeType: mediaType
  });
  return c.text(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(result.replyMessage.body)}</Message></Response>`,
    200,
    { "Content-Type": "application/xml" }
  );
});
app.post("/cron/sweep", async (c) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = c.req.header("authorization") || "";
  const { timingSafeEqual } = await import("node:crypto");
  const expected = cronSecret ? `Bearer ${cronSecret}` : "";
  const providedBuf = Buffer.from(authHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (!cronSecret || providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return c.json({ error: "Unauthorized cron invocation" }, 401);
  }
  const storage = getStorage();
  const baseUrl = getRequestBaseUrl(c.req.raw);
  const summaries = await listWorkspaceSummaries(storage);
  const perWorkspace = [];
  for (const summary of summaries) {
    const res = await triggerWorkspaceSweep(storage, summary.slug, { baseUrl });
    perWorkspace.push({
      slug: summary.slug,
      dispatchedCount: res.dispatchedCount,
      skippedDeduplicated: res.skippedDeduplicated
    });
  }
  return c.json({
    ok: true,
    sweptWorkspaces: perWorkspace.length,
    results: perWorkspace,
    ranAt: (/* @__PURE__ */ new Date()).toISOString()
  });
});
async function dispatchToHono(req) {
  const url = new URL(req.url, "http://localhost");
  const routeParam = url.searchParams.get("__route");
  let targetReq = req;
  if (routeParam !== null) {
    url.searchParams.delete("__route");
    url.pathname = `/api/${routeParam.replace(/^\/+/, "")}`;
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;
    if (hasBody) {
      const bodyBuf = await req.arrayBuffer();
      targetReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
        body: bodyBuf
      });
    } else {
      targetReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers
      });
    }
  }
  return app.fetch(targetReq);
}
var GET = dispatchToHono;
var POST = dispatchToHono;
var PUT = dispatchToHono;
var PATCH = dispatchToHono;
var DELETE = dispatchToHono;
var OPTIONS = dispatchToHono;
var HEAD = dispatchToHono;
export {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
  app
};
