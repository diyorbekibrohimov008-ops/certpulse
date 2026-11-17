import { getDaysRemaining } from "./compliance";
import type {
  AlertChannel,
  AlertDelivery,
  AlertRule,
  Certification,
  Employee,
  RecipientRole,
  Workspace,
} from "./types";

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "rule-60",
    daysBefore: 60,
    label: "60-Day Early Notice",
    severity: "watch",
    enabled: true,
    notifyWorker: true,
    notifySupervisor: true,
    channels: ["sms", "email"],
    template:
      "Heads up {{employeeName}}: your {{certName}} (#{{certificateNumber}}) expires in {{daysRemaining}} days on {{expiryDate}}. Text a photo of your renewed card or upload here: {{uploadUrl}}",
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
    template:
      "Action needed: {{employeeName}}'s {{certName}} expires in {{daysRemaining}} days ({{expiryDate}}). Renew and text a card photo to avoid scheduling hold: {{uploadUrl}}",
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
    template:
      "URGENT (7-day compliance window): {{employeeName}}'s {{certName}} expires on {{expiryDate}} ({{daysRemaining}} days left). Text a photo immediately to stay OSHA/DOT compliant: {{uploadUrl}}",
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
    template:
      "COMPLIANCE STOP: {{employeeName}}'s {{certName}} expired on {{expiryDate}}. Pause restricted duties and upload renewal photo now: {{uploadUrl}}",
  },
];

function renderAlertMessage(
  rule: AlertRule,
  employee: Employee,
  cert: Certification,
  daysRemaining: number,
  recipientRole: RecipientRole,
  baseUrl: string,
): string {
  const uploadUrl = `${baseUrl.replace(/\/$/, "")}/m/${employee.uploadToken}`;
  const rendered = rule.template
    .replaceAll("{{employeeName}}", employee.fullName)
    .replaceAll("{{certName}}", cert.certName)
    .replaceAll("{{certificateNumber}}", cert.certificateNumber)
    .replaceAll("{{daysRemaining}}", String(Math.max(0, daysRemaining)))
    .replaceAll("{{expiryDate}}", cert.expiryDate)
    .replaceAll("{{uploadUrl}}", uploadUrl);

  if (recipientRole === "supervisor") {
    return `[Supervisor CC · ${employee.supervisor.name}] ${rendered}`;
  }
  return rendered;
}

export function matchEscalationRule(
  daysRemaining: number,
  rules: AlertRule[],
): AlertRule | null {
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

export async function sendTwilioSmsIfConfigured(to: string, body: string): Promise<{
  mode: AlertDelivery["deliveryMode"];
  status: AlertDelivery["providerStatus"];
  ref: string | null;
}> {
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
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { mode: "live_twilio", status: "failed", ref: `http_${res.status}` };
    }
    const json = (await res.json()) as { sid?: string };
    return { mode: "live_twilio", status: "sent", ref: json.sid ?? null };
  } catch {
    return { mode: "live_twilio", status: "failed", ref: "network_error" };
  }
}

async function sendResendEmailIfConfigured(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{
  mode: AlertDelivery["deliveryMode"];
  status: AlertDelivery["providerStatus"];
  ref: string | null;
}> {
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.body,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { mode: "live_resend", status: "failed", ref: `http_${res.status}` };
    }
    const json = (await res.json()) as { id?: string };
    return { mode: "live_resend", status: "sent", ref: json.id ?? null };
  } catch {
    return { mode: "live_resend", status: "failed", ref: "network_error" };
  }
}

export async function runEscalationSweep(
  workspace: Workspace,
  options: {
    baseUrl?: string;
    referenceDate?: Date;
    forceCertificationId?: string;
  } = {},
): Promise<{
  dispatched: AlertDelivery[];
  skippedDeduplicated: number;
}> {
  const referenceDate = options.referenceDate ?? new Date();
  const baseUrl = options.baseUrl ?? "https://certpulse.vercel.app";
  const employeeMap = new Map(workspace.employees.map((e) => [e.id, e]));
  const existingKeys = new Set(workspace.alertDeliveries.map((d) => d.dedupeKey));

  const dispatched: AlertDelivery[] = [];
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

    const roles: RecipientRole[] = [];
    if (matchedRule.notifyWorker) roles.push("worker");
    if (matchedRule.notifySupervisor) roles.push("supervisor");

    for (const recipientRole of roles) {
      const recipientName =
        recipientRole === "worker" ? employee.fullName : employee.supervisor.name;
      for (const channel of matchedRule.channels) {
        const recipientContact =
          recipientRole === "worker"
            ? channel === "sms"
              ? employee.phone
              : employee.email
            : channel === "sms"
              ? employee.supervisor.phone
              : employee.supervisor.email;

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
          baseUrl,
        );

        const deliveryResult =
          channel === "sms"
            ? await sendTwilioSmsIfConfigured(recipientContact, messageBody)
            : await sendResendEmailIfConfigured({
                to: recipientContact,
                subject: `[CertPulse ${matchedRule.label}] ${employee.fullName} — ${cert.certName}`,
                body: messageBody,
              });

        const delivery: AlertDelivery = {
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
          sentAt: new Date().toISOString(),
        };

        dispatched.push(delivery);
        existingKeys.add(dedupeKey);
      }
    }
  }

  return { dispatched, skippedDeduplicated };
}
