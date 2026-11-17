import { Hono } from "hono";
import { z } from "zod";
import { computeWorkspaceMetrics } from "../src/lib/compliance";
import { DEFAULT_ALERT_RULES } from "../src/lib/alerts";
import { getStorage } from "../src/lib/storage";
import {
  activateSelfServePlan,
  addEmployeeToWorkspace,
  AppError,
  createWorkspaceRecord,
  deleteEmployeeFromWorkspace,
  ensureSeededWorkspaces,
  exportWorkspaceToCsv,
  extractCertificationFromSubmission,
  findWorkspaceByPhone,
  getWorkspace,
  importSpreadsheetToWorkspace,
  listWorkspaceSummaries,
  processInboundRenewal,
  resolveMobilePortalByToken,
  saveWorkspace,
  triggerWorkspaceSweep,
  updateEmployeeInWorkspace,
  updateWorkspaceAlertRules,
  upsertCertificationInWorkspace,
} from "../src/lib/workspace-service";
import type { AlertRule } from "../src/lib/types";

export const app = new Hono().basePath("/api");

const createWorkspaceSchema = z.object({
  companyName: z.string().min(2).max(120),
  slug: z.string().min(2).max(80).optional(),
  industry: z.string().max(120).optional(),
  billingEmail: z.string().email(),
  setupDurationSeconds: z.number().int().min(1).max(3600).optional(),
});

const addEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100),
  roleTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().min(7).max(32),
  email: z.string().email().optional().or(z.literal("")),
  supervisorName: z.string().min(2).max(100),
  supervisorPhone: z.string().min(7).max(32),
  supervisorEmail: z.string().email().optional().or(z.literal("")),
  initialCert: z
    .object({
      certName: z.string().min(2).max(120),
      certificateNumber: z.string().max(80).optional(),
      issuingBody: z.string().max(120).optional(),
      issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  roleTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  phone: z.string().min(7).max(32).optional(),
  email: z.string().email().optional(),
  active: z.boolean().optional(),
  supervisor: z
    .object({
      name: z.string().min(2).max(100),
      phone: z.string().min(7).max(32),
      email: z.string().email(),
    })
    .optional(),
});

const upsertCertSchema = z.object({
  id: z.string().optional(),
  employeeId: z.string().min(2),
  certName: z.string().min(2).max(120),
  category: z
    .enum([
      "CPR / AED",
      "OSHA 10/30",
      "Driver License / CDL",
      "Forklift",
      "EPA 608",
      "First Aid",
      "Custom",
    ])
    .optional(),
  certificateNumber: z.string().max(80).optional(),
  issuingBody: z.string().max(120).optional(),
  issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const importCsvSchema = z.object({
  rawText: z.string().min(5),
});

const alertRuleSchema: z.ZodType<AlertRule> = z.object({
  id: z.string().min(2),
  daysBefore: z.number().int().min(0).max(365),
  label: z.string().min(2).max(80),
  severity: z.enum(["watch", "warning", "critical", "expired"]),
  enabled: z.boolean(),
  notifyWorker: z.boolean(),
  notifySupervisor: z.boolean(),
  channels: z.array(z.enum(["sms", "email"])).min(1),
  template: z.string().min(5).max(500),
});

const updateRulesSchema = z.object({
  rules: z.array(alertRuleSchema).min(1).max(10),
});

const checkoutSchema = z.object({
  planId: z.enum(["smb_25", "smb_growth_50"]),
  billingEmail: z.string().email(),
  cardNumber: z.string().min(12).max(24),
  cardBrand: z.string().max(32).optional(),
  expiry: z.string().max(10).optional(),
  cvc: z.string().max(6).optional(),
});

function getRequestBaseUrl(req: Request): string {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://certpulse.vercel.app";
  }
}

const XML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => XML_ESCAPE_MAP[ch] ?? ch);
}

async function parseSubmissionPayload(req: Request): Promise<{
  employeeId?: string;
  uploadToken?: string;
  fromPhone?: string;
  certificationId?: string;
  messageText?: string;
  rawOcrText?: string;
  overrideExpiryDate?: string;
  overrideCertName?: string;
  overrideCertificateNumber?: string;
  imageBytes?: Uint8Array;
  mimeType?: string;
}> {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const fileEntry = form.get("photo") ?? form.get("file");
    let imageBytes: Uint8Array | undefined;
    let mimeType: string | undefined;

    if (fileEntry && typeof fileEntry === "object" && "arrayBuffer" in fileEntry) {
      const buf = await (fileEntry as File).arrayBuffer();
      imageBytes = new Uint8Array(buf);
      mimeType = (fileEntry as File).type || "image/png";
    }

    const str = (key: string) => {
      const val = form.get(key);
      return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
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
      imageBytes,
      mimeType,
    };
  }

  const body = (await req.json()) as {
    employeeId?: string;
    uploadToken?: string;
    fromPhone?: string;
    certificationId?: string;
    messageText?: string;
    rawOcrText?: string;
    overrideExpiryDate?: string;
    overrideCertName?: string;
    overrideCertificateNumber?: string;
    imageBase64?: string;
    mimeType?: string;
  };

  let imageBytes: Uint8Array | undefined;
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
    mimeType: body.mimeType || (imageBytes ? "image/png" : undefined),
  };
}

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as 400 | 404 | 409);
  }
  if (err instanceof z.ZodError) {
    return c.json(
      {
        error: err.issues[0]?.message || "Validation failed.",
        code: "VALIDATION_ERROR",
        issues: err.issues,
      },
      400,
    );
  }
  console.error("[certpulse-api] Unhandled error:", err);
  return c.json(
    {
      error: err instanceof Error ? err.message : "Internal server error",
      code: "INTERNAL_ERROR",
    },
    500,
  );
});

app.get("/health", async (c) => {
  const storage = getStorage();
  await ensureSeededWorkspaces(storage);
  return c.json({
    ok: true,
    service: "certpulse",
    storageDriver: storage.driver,
    timestamp: new Date().toISOString(),
  });
});

app.get("/workspaces", async (c) => {
  const storage = getStorage();
  const workspaces = await listWorkspaceSummaries(storage);
  return c.json({ workspaces });
});

app.post("/workspaces", async (c) => {
  const payload = createWorkspaceSchema.parse(await c.req.json());
  const storage = getStorage();
  const workspace = await createWorkspaceRecord(storage, payload);
  return c.json(
    {
      workspace,
      metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications),
    },
    201,
  );
});

app.get("/workspaces/:slug", async (c) => {
  const storage = getStorage();
  const workspace = await getWorkspace(storage, c.req.param("slug"));
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications),
  });
});

app.post("/workspaces/:slug/employees", async (c) => {
  const payload = addEmployeeSchema.parse(await c.req.json());
  const storage = getStorage();
  const result = await addEmployeeToWorkspace(storage, c.req.param("slug"), {
    ...payload,
    email: payload.email || undefined,
    supervisorEmail: payload.supervisorEmail || undefined,
  });
  return c.json(
    {
      ...result,
      metrics: computeWorkspaceMetrics(
        result.workspace.employees,
        result.workspace.certifications,
      ),
    },
    201,
  );
});

app.patch("/workspaces/:slug/employees/:id", async (c) => {
  const patch = updateEmployeeSchema.parse(await c.req.json());
  const storage = getStorage();
  const workspace = await updateEmployeeInWorkspace(
    storage,
    c.req.param("slug"),
    c.req.param("id"),
    patch,
  );
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications),
  });
});

app.delete("/workspaces/:slug/employees/:id", async (c) => {
  const storage = getStorage();
  const workspace = await deleteEmployeeFromWorkspace(
    storage,
    c.req.param("slug"),
    c.req.param("id"),
  );
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications),
  });
});

app.post("/workspaces/:slug/certifications", async (c) => {
  const payload = upsertCertSchema.parse(await c.req.json());
  const storage = getStorage();
  const result = await upsertCertificationInWorkspace(
    storage,
    c.req.param("slug"),
    payload,
  );
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications,
    ),
  });
});

app.post("/workspaces/:slug/import", async (c) => {
  const payload = importCsvSchema.parse(await c.req.json());
  const storage = getStorage();
  const result = await importSpreadsheetToWorkspace(
    storage,
    c.req.param("slug"),
    payload.rawText,
  );
  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications,
    ),
  });
});

app.post("/workspaces/:slug/ocr", async (c) => {
  const parsed = await parseSubmissionPayload(c.req.raw);
  const extraction = await extractCertificationFromSubmission({
    imageBytes: parsed.imageBytes,
    mimeType: parsed.mimeType,
    rawOcrText: parsed.rawOcrText,
    hintText: parsed.messageText,
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
      result.workspace.certifications,
    ),
  });
});

app.post("/workspaces/:slug/alerts/sweep", async (c) => {
  const storage = getStorage();
  const baseUrl = getRequestBaseUrl(c.req.raw);
  let forceCertificationId: string | undefined;
  try {
    const body = (await c.req.json()) as { forceCertificationId?: string };
    forceCertificationId = body?.forceCertificationId;
  } catch {
    // Empty body is valid for full sweep
  }

  const result = await triggerWorkspaceSweep(storage, c.req.param("slug"), {
    baseUrl,
    forceCertificationId,
  });

  return c.json({
    ...result,
    metrics: computeWorkspaceMetrics(
      result.workspace.employees,
      result.workspace.certifications,
    ),
  });
});

app.patch("/workspaces/:slug/alerts/rules", async (c) => {
  const payload = updateRulesSchema.parse(await c.req.json());
  const storage = getStorage();
  const workspace = await updateWorkspaceAlertRules(
    storage,
    c.req.param("slug"),
    payload.rules,
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

app.post("/workspaces/:slug/billing/checkout", async (c) => {
  const payload = checkoutSchema.parse(await c.req.json());
  const storage = getStorage();
  const workspace = await activateSelfServePlan(
    storage,
    c.req.param("slug"),
    payload,
  );
  return c.json({
    workspace,
    metrics: computeWorkspaceMetrics(workspace.employees, workspace.certifications),
  });
});

app.get("/workspaces/:slug/export.csv", async (c) => {
  const storage = getStorage();
  const ws = await getWorkspace(storage, c.req.param("slug"));
  const csv = exportWorkspaceToCsv(ws);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ws.slug}-compliance.csv"`,
    },
  });
});

app.get("/workspaces/:slug/files", async (c) => {
  const key = c.req.query("key");
  const slug = c.req.param("slug");
  if (!key || !key.startsWith(`certpulse/media/${slug}/`)) {
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
      "Cache-Control": "private, max-age=3600",
    },
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
    certifications: data.certifications,
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
    uploadToken: token,
  });
  return c.json({
    ok: true,
    certification: result.certification,
    extraction: result.extraction,
    replyMessage: result.replyMessage,
  });
});

// Live Twilio MMS webhook (receives From, Body, MediaUrl0, MediaContentType0)
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
      { "Content-Type": "application/xml" },
    );
  }

  const matched = await findWorkspaceByPhone(storage, fromPhone);
  if (!matched) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>CertPulse: We could not find ${escapeXml(fromPhone)} on an active roster. Ask your supervisor to add your mobile number.</Message></Response>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }

  let imageBytes: Uint8Array | undefined;
  if (mediaUrl) {
    try {
      const isPrivateOrReservedIpv4 = (host: string): boolean => {
        const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
        if (!match) return false;
        const parts = match.slice(1).map(Number);
        if (parts.some((n) => n > 255)) return true;
        return (
          parts[0] === 10 ||
          parts[0] === 127 ||
          parts[0] === 0 ||
          (parts[0] === 169 && parts[1] === 254) ||
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) ||
          (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
        );
      };

      const validateSafeHttpsUrl = (raw: string): URL | null => {
        try {
          const parsed = new URL(raw);
          if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
            return null;
          }
          const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
          if (
            host === "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host.endsWith(".internal") ||
            host === "::1" ||
            host.startsWith("fc") ||
            host.startsWith("fd") ||
            host.startsWith("fe80") ||
            host.includes(":") ||
            isPrivateOrReservedIpv4(host)
          ) {
            return null;
          }
          return parsed;
        } catch {
          return null;
        }
      };

      const initialUrl = validateSafeHttpsUrl(mediaUrl);
      const isTwilioMediaHost =
        initialUrl !== null &&
        (initialUrl.hostname.toLowerCase() === "api.twilio.com" ||
          initialUrl.hostname.toLowerCase().endsWith(".twiliocdn.com"));

      if (initialUrl && isTwilioMediaHost) {
        const headers: Record<string, string> = {};
        if (
          initialUrl.hostname.toLowerCase() === "api.twilio.com" &&
          process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN
        ) {
          const creds = Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
          ).toString("base64");
          headers.Authorization = `Basic ${creds}`;
        }
        let res = await fetch(initialUrl.toString(), {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          const redirectUrl = location ? validateSafeHttpsUrl(new URL(location, initialUrl).toString()) : null;
          if (redirectUrl) {
            res = await fetch(redirectUrl.toString(), {
              redirect: "error",
              signal: AbortSignal.timeout(10000),
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
      // Proceed with body text fallback if MMS fetch fails
    }
  }

  const result = await processInboundRenewal(storage, matched.workspace.slug, {
    employeeId: matched.employee.id,
    fromPhone,
    messageText: bodyText,
    imageBytes,
    mimeType: mediaType,
  });

  return c.text(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(result.replyMessage.body)}</Message></Response>`,
    200,
    { "Content-Type": "application/xml" },
  );
});

// Scheduled 24/7 escalation sweep invoked by Vercel Schedules (protected by CRON_SECRET)
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
      skippedDeduplicated: res.skippedDeduplicated,
    });
  }

  return c.json({
    ok: true,
    sweptWorkspaces: perWorkspace.length,
    results: perWorkspace,
    ranAt: new Date().toISOString(),
  });
});

async function dispatchToHono(req: Request): Promise<Response> {
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
        body: bodyBuf,
      });
    } else {
      targetReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
      });
    }
  }

  return app.fetch(targetReq);
}

export const GET = dispatchToHono;
export const POST = dispatchToHono;
export const PUT = dispatchToHono;
export const PATCH = dispatchToHono;
export const DELETE = dispatchToHono;
export const OPTIONS = dispatchToHono;
export const HEAD = dispatchToHono;
