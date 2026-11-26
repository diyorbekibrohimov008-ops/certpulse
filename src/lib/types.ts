export type ComplianceBucket =
  | "expired"
  | "critical_7"
  | "warning_30"
  | "watch_60"
  | "compliant";

export type AlertChannel = "sms" | "email";
export type RecipientRole = "worker" | "supervisor";

export interface SupervisorContact {
  name: string;
  phone: string;
  email: string;
}

export interface Employee {
  id: string;
  fullName: string;
  roleTitle: string;
  department: string;
  phone: string;
  email: string;
  supervisor: SupervisorContact;
  uploadToken: string;
  active: boolean;
  createdAt: string;
}

export interface Certification {
  id: string;
  employeeId: string;
  certName: string;
  category:
    | "CPR / AED"
    | "OSHA 10/30"
    | "Driver License / CDL"
    | "Forklift"
    | "EPA 608"
    | "First Aid"
    | "Custom";
  certificateNumber: string;
  issuingBody: string;
  issuedDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  photoKey: string | null;
  ocrConfidence: number | null;
  ocrRawText: string | null;
  lastRenewedAt: string | null;
  updatedAt: string;
}

export interface AlertRule {
  id: string;
  daysBefore: number; // 60, 30, 7, or 0 (expired)
  label: string;
  severity: "watch" | "warning" | "critical" | "expired";
  enabled: boolean;
  notifyWorker: boolean;
  notifySupervisor: boolean;
  channels: AlertChannel[];
  template: string;
}

export interface AlertDelivery {
  id: string;
  dedupeKey: string;
  certificationId: string;
  employeeId: string;
  employeeName: string;
  certName: string;
  expiryDate: string;
  tierDays: number;
  recipientRole: RecipientRole;
  recipientName: string;
  recipientContact: string;
  channel: AlertChannel;
  messageBody: string;
  deliveryMode: "live_twilio" | "live_resend" | "sandbox_outbox";
  providerStatus: "sent" | "logged" | "failed";
  providerRef: string | null;
  sentAt: string;
}

export interface SmsMessage {
  id: string;
  direction: "inbound" | "outbound";
  employeeId: string | null;
  employeeName: string;
  phone: string;
  body: string;
  mediaKey: string | null;
  extractedSummary: string | null;
  createdAt: string;
}

export interface BillingInfo {
  planId: "free_forever";
  planName: string;
  monthlyPriceUsd: number;
  seatLimit: number | null;
  status: "active";
  cardBrand: string | null;
  cardLast4: string | null;
  billingEmail: string;
  setupCompletedAt: string | null;
  setupDurationSeconds: number | null;
  currentPeriodEnd: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface WorkspaceIntegrations {
  portalSmsNumber: string;
  twilioFromNumber: string;
  hasTwilioConfig: boolean;
  hasResendConfig: boolean;
  hasVisionAiConfig: boolean;
}

export interface Workspace {
  id: string;
  slug: string;
  companyName: string;
  industry: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  billing: BillingInfo;
  integrations: WorkspaceIntegrations;
  employees: Employee[];
  certifications: Certification[];
  alertRules: AlertRule[];
  alertDeliveries: AlertDelivery[];
  smsMessages: SmsMessage[];
}

export interface WorkspaceSummary {
  id: string;
  slug: string;
  companyName: string;
  industry: string;
  seatCount: number;
  seatLimit: number | null;
  planName: string;
  monthlyPriceUsd: number;
}

export interface OcrExtractionResult {
  certName: string | null;
  category: Certification["category"];
  holderName: string | null;
  certificateNumber: string | null;
  issuingBody: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  confidence: number;
  engine: "vision_ai" | "tesseract_parser" | "server_pattern";
  matchedLines: string[];
  rawText: string;
}
