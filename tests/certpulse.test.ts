import { beforeEach, describe, expect, it } from "vitest";
import { app, GET, POST } from "../api/index";
import { matchEscalationRule, runEscalationSweep } from "../src/lib/alerts";
import {
  computeWorkspaceMetrics,
  getComplianceBucket,
  getDaysRemaining,
} from "../src/lib/compliance";
import { parseSpreadsheetInput } from "../src/lib/csv-importer";
import { parseCertificateText } from "../src/lib/ocr-parser";
import { buildSampleSpreadsheetTsv, createDemoWorkspace } from "../src/lib/seed";
import { MemoryStorageAdapter, setStorageOverride } from "../src/lib/storage";

describe("Compliance date math & scoring", () => {
  const ref = new Date("2026-06-01T12:00:00.000Z");

  it("classifies UTC days remaining accurately across 60/30/7/expired tiers", () => {
    expect(getDaysRemaining("2026-05-20", ref)).toBe(-12);
    expect(getComplianceBucket(-12)).toBe("expired");

    expect(getDaysRemaining("2026-06-01", ref)).toBe(0);
    expect(getComplianceBucket(0)).toBe("critical_7");
    expect(getComplianceBucket(7)).toBe("critical_7");

    expect(getComplianceBucket(8)).toBe("warning_30");
    expect(getComplianceBucket(30)).toBe("warning_30");

    expect(getComplianceBucket(31)).toBe("watch_60");
    expect(getComplianceBucket(60)).toBe("watch_60");

    expect(getComplianceBucket(61)).toBe("compliant");
  });

  it("computes compliance rate & OSHA/DOT exposure from demo roster", () => {
    const ws = createDemoWorkspace(ref);
    const metrics = computeWorkspaceMetrics(ws.employees, ws.certifications, ref);
    expect(metrics.activeSeats).toBe(12);
    expect(metrics.counts.total).toBe(13);
    expect(metrics.counts.expired).toBe(2);
    expect(metrics.counts.critical7).toBe(2);
    expect(metrics.complianceScore).toBe(Math.round(((13 - 2) / 13) * 100));
    expect(metrics.estimatedFineExposureUsd).toBeGreaterThan(30_000);
  });
});

describe("OCR card text parser", () => {
  it("extracts CPR expiry date over earlier issued date and captures AHA card #", () => {
    const raw = [
      "AMERICAN HEART ASSOCIATION",
      "COURSE COMPLETION CARD: CPR / AED ADULT",
      "NAME: MARCUS VANCE",
      "ISSUED: 05/12/2026",
      "EXPIRES: 05/12/2028",
      "CARD NO: AHA-2026-99124",
    ].join("\n");

    const parsed = parseCertificateText(raw, undefined, "tesseract_parser");
    expect(parsed.category).toBe("CPR / AED");
    expect(parsed.issuedDate).toBe("2026-05-12");
    expect(parsed.expiryDate).toBe("2028-05-12");
    expect(parsed.certificateNumber).toBe("AHA-2026-99124");
    expect(parsed.confidence).toBeGreaterThan(0.8);
  });

  it("extracts month-name expiration date for OSHA 30-Hour card", () => {
    const raw = [
      "U.S. Department of Labor - OSHA 30-Hour Construction",
      "Student: Elena Rostova",
      "Card # DOL-30-884210",
      "Completed May 04, 2026",
      "Valid Thru Nov 18, 2029",
    ].join("\n");

    const parsed = parseCertificateText(raw);
    expect(parsed.category).toBe("OSHA 10/30");
    expect(parsed.expiryDate).toBe("2029-11-18");
    expect(parsed.certificateNumber).toBe("DOL-30-884210");
  });
});

describe("Excel/TSV & CSV importer", () => {
  it("parses tab-separated Excel paste with MM/DD/YYYY dates and US phone normalization", () => {
    const tsv = [
      "Employee Name\tPhone\tSupervisor Name\tSupervisor Phone\tCertification\tCard #\tExpiry Date",
      "Sammy Vega\t(512) 555-0199\tRay Kowalski\t512-555-0101\tOSHA 30-Hour\tDOL-30-1122\t08/15/2027",
      "Nora Patel\t5125550188\tDana Morales\t5125550102\tCPR / AED\tAHA-4455\t2028-01-20",
    ].join("\n");

    const result = parseSpreadsheetInput(tsv);
    expect(result.delimiter).toBe("tab");
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].phone).toBe("+15125550199");
    expect(result.rows[0].expiryDate).toBe("2027-08-15");
    expect(result.rows[1].category).toBe("CPR / AED");

    const sampleRes = parseSpreadsheetInput(buildSampleSpreadsheetTsv());
    expect(sampleRes.errors).toHaveLength(0);
    expect(sampleRes.rows).toHaveLength(4);
  });
});

describe("60/30/7 escalating worker + supervisor notifications & deduplication", () => {
  it("dispatches to both worker and supervisor once per tier per expiry cycle", async () => {
    const ref = new Date("2026-06-01T12:00:00.000Z");
    const ws = createDemoWorkspace(ref);
    expect(matchEscalationRule(5, ws.alertRules)?.daysBefore).toBe(7);
    expect(matchEscalationRule(23, ws.alertRules)?.daysBefore).toBe(30);
    expect(matchEscalationRule(52, ws.alertRules)?.daysBefore).toBe(60);

    const first = await runEscalationSweep(ws, { referenceDate: ref });
    expect(first.dispatched.length).toBeGreaterThan(10);
    expect(first.dispatched.some((d) => d.recipientRole === "worker")).toBe(true);
    expect(first.dispatched.some((d) => d.recipientRole === "supervisor")).toBe(true);

    // Save deliveries onto workspace and run again -> strictly deduplicated
    ws.alertDeliveries.push(...first.dispatched);
    const second = await runEscalationSweep(ws, { referenceDate: ref });
    expect(second.dispatched).toHaveLength(0);
    expect(second.skippedDeduplicated).toBe(first.dispatched.length);
  });
});

describe("End-to-end Hono API & SMB 25-seat limit", () => {
  beforeEach(() => {
    setStorageOverride(new MemoryStorageAdapter());
    process.env.CRON_SECRET = "test_cron_secret_123456";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.RESEND_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("seeds default workspace, enforces 25-seat limit, upgrades plan, and processes MMS photo upload", async () => {
    const healthRes = await app.fetch(new Request("http://localhost/api/health"));
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { storageDriver: string };
    expect(healthJson.storageDriver).toBe("memory");

    // Verify Vercel rewrite __route dispatch helper works identically
    const rewriteRes = await GET(
      new Request("http://localhost/api/index?__route=workspaces/summit-mechanical"),
    );
    expect(rewriteRes.status).toBe(200);
    const wsData = (await rewriteRes.json()) as {
      workspace: { slug: string; employees: Array<{ id: string; uploadToken: string }> };
      metrics: { activeSeats: number };
    };
    expect(wsData.workspace.slug).toBe("summit-mechanical");
    expect(wsData.metrics.activeSeats).toBe(12);

    // Multipart MMS photo upload renews Marcus Vance's expired CPR cert and persists photo bytes
    const form = new FormData();
    const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    form.append("photo", new File([fakePngBytes], "cpr-card.png", { type: "image/png" }));
    form.append("employeeId", "emp-marcus");
    form.append("certificationId", "cert-marcus-cpr");
    form.append(
      "rawOcrText",
      "AMERICAN HEART ASSOCIATION\nCPR / AED\nCARD NO: AHA-2026-NEW99\nEXPIRES: 2029-11-15",
    );

    const mmsRes = await POST(
      new Request(
        "http://localhost/api/index?__route=workspaces/summit-mechanical/sms/inbound",
        { method: "POST", body: form },
      ),
    );
    expect(mmsRes.status).toBe(200);
    const mmsJson = (await mmsRes.json()) as {
      certification: { expiryDate: string; certificateNumber: string; photoKey: string | null };
      replyMessage: { body: string };
    };
    expect(mmsJson.certification.expiryDate).toBe("2029-11-15");
    expect(mmsJson.certification.certificateNumber).toBe("AHA-2026-NEW99");
    expect(mmsJson.certification.photoKey).toContain("certpulse/media/summit-mechanical/");
    expect(mmsJson.replyMessage.body).toContain("2029-11-15");

    // Fetch stored image photo back cleanly
    const imgRes = await app.fetch(
      new Request(
        `http://localhost/api/workspaces/summit-mechanical/files?key=${encodeURIComponent(mmsJson.certification.photoKey!)}`,
      ),
    );
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toBe("image/png");

    // Twilio webhook returns XML TwiML
    const twilioForm = new FormData();
    twilioForm.append("From", "+15125550118");
    twilioForm.append("Body", "OSHA 30-Hour CARD NO DOL-30-99100 EXPIRES 2029-12-01");
    const twilioRes = await app.fetch(
      new Request("http://localhost/api/webhooks/twilio", {
        method: "POST",
        body: twilioForm,
      }),
    );
    expect(twilioRes.status).toBe(200);
    expect(twilioRes.headers.get("content-type")).toContain("application/xml");
    const twiml = await twilioRes.text();
    expect(twiml).toContain("<Response><Message>");
    expect(twiml).toContain("2029-12-01");

    // Create fresh workspace & test 25-seat SMB cap + self-serve upgrade
    const createRes = await app.fetch(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: "Lone Star Electric",
          industry: "Electrical",
          billingEmail: "owner@lonestar.example",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const createdJson = (await createRes.json()) as {
      workspace: { slug: string; billing: { seatLimit: number } };
    };
    const slug = createdJson.workspace.slug;
    expect(createdJson.workspace.billing.seatLimit).toBe(25);

    const rows25 = Array.from({ length: 25 }, (_, i) =>
      `Worker ${i + 1}\t+15125551${String(i).padStart(3, "0")}\tBoss\t+15125550000\tOSHA 10\tC-${i}\t2027-09-01`,
    );
    const import25Res = await app.fetch(
      new Request(`http://localhost/api/workspaces/${slug}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: [
            "Employee Name\tPhone\tSupervisor Name\tSupervisor Phone\tCertification\tCard #\tExpiry Date",
            ...rows25,
          ].join("\n"),
        }),
      }),
    );
    expect(import25Res.status).toBe(200);

    // 26th employee must trigger 409 SEAT_LIMIT_REACHED
    const emp26Res = await app.fetch(
      new Request(`http://localhost/api/workspaces/${slug}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Worker 26",
          phone: "+15125559999",
          supervisorName: "Boss",
          supervisorPhone: "+15125550000",
        }),
      }),
    );
    expect(emp26Res.status).toBe(409);

    // Upgrade to Growth 50 via self-serve checkout -> 26th succeeds
    const checkoutRes = await app.fetch(
      new Request(`http://localhost/api/workspaces/${slug}/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: "smb_growth_50",
          billingEmail: "owner@lonestar.example",
          cardNumber: "4242424242424242",
        }),
      }),
    );
    expect(checkoutRes.status).toBe(200);

    const emp26AfterUpgrade = await app.fetch(
      new Request(`http://localhost/api/workspaces/${slug}/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Worker 26",
          phone: "+15125559999",
          supervisorName: "Boss",
          supervisorPhone: "+15125550000",
        }),
      }),
    );
    expect(emp26AfterUpgrade.status).toBe(201);

    // Cron sweep rejects bad secret and passes valid CRON_SECRET
    const badCron = await app.fetch(
      new Request("http://localhost/api/cron/sweep", { method: "POST" }),
    );
    expect(badCron.status).toBe(401);

    const goodCron = await app.fetch(
      new Request("http://localhost/api/cron/sweep", {
        method: "POST",
        headers: { Authorization: "Bearer test_cron_secret_123456" },
      }),
    );
    expect(goodCron.status).toBe(200);
    const cronJson = (await goodCron.json()) as { ok: boolean; sweptWorkspaces: number };
    expect(cronJson.ok).toBe(true);
    expect(cronJson.sweptWorkspaces).toBe(2);
  });
});
