import type {
  AlertDelivery,
  AlertRule,
  Certification,
  Employee,
  OcrExtractionResult,
  SmsMessage,
  Workspace,
  WorkspaceSummary,
} from "./types";
import type { ComputedCertificationRow } from "./compliance";

export interface WorkspaceMetrics {
  rows: ComputedCertificationRow[];
  counts: {
    total: number;
    expired: number;
    critical7: number;
    warning30: number;
    watch60: number;
    compliant: number;
  };
  complianceScore: number;
  estimatedFineExposureUsd: number;
  activeSeats: number;
}

export interface WorkspacePayload {
  workspace: Workspace;
  metrics: WorkspaceMetrics;
}

export class ClientApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new ClientApiError(res.status, text || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new ClientApiError(
      res.status,
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
      typeof data.code === "string" ? data.code : undefined,
    );
  }
  return data as T;
}

export const apiClient = {
  listWorkspaces: () =>
    requestJson<{ workspaces: WorkspaceSummary[] }>("/api/workspaces"),

  getWorkspace: (slug: string) =>
    requestJson<WorkspacePayload>(`/api/workspaces/${encodeURIComponent(slug)}`),

  createWorkspace: (input: {
    companyName: string;
    industry: string;
    billingEmail: string;
    setupDurationSeconds?: number;
  }) =>
    requestJson<WorkspacePayload>("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  addEmployee: (
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
        expiryDate: string;
      };
    },
  ) =>
    requestJson<WorkspacePayload & { employee: Employee; certification: Certification | null }>(
      `/api/workspaces/${encodeURIComponent(slug)}/employees`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),

  deleteEmployee: (slug: string, employeeId: string) =>
    requestJson<WorkspacePayload>(
      `/api/workspaces/${encodeURIComponent(slug)}/employees/${encodeURIComponent(employeeId)}`,
      { method: "DELETE" },
    ),

  upsertCertification: (
    slug: string,
    input: {
      id?: string;
      employeeId: string;
      certName: string;
      certificateNumber?: string;
      issuingBody?: string;
      issuedDate?: string;
      expiryDate: string;
    },
  ) =>
    requestJson<WorkspacePayload & { certification: Certification }>(
      `/api/workspaces/${encodeURIComponent(slug)}/certifications`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),

  importSpreadsheet: (slug: string, rawText: string) =>
    requestJson<
      WorkspacePayload & {
        addedEmployees: number;
        addedCertifications: number;
        updatedCertifications: number;
        errors: Array<{ rowIndex: number; message: string }>;
      }
    >(`/api/workspaces/${encodeURIComponent(slug)}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    }),

  previewOcr: (slug: string, formData: FormData) =>
    requestJson<{ extraction: OcrExtractionResult }>(
      `/api/workspaces/${encodeURIComponent(slug)}/ocr`,
      {
        method: "POST",
        body: formData,
      },
    ),

  submitSmsRenewal: (slug: string, formData: FormData) =>
    requestJson<
      WorkspacePayload & {
        employee: Employee;
        certification: Certification;
        extraction: OcrExtractionResult;
        replyMessage: SmsMessage;
      }
    >(`/api/workspaces/${encodeURIComponent(slug)}/sms/inbound`, {
      method: "POST",
      body: formData,
    }),

  runAlertSweep: (slug: string, forceCertificationId?: string) =>
    requestJson<
      WorkspacePayload & {
        dispatchedCount: number;
        dispatched: AlertDelivery[];
        skippedDeduplicated: number;
      }
    >(`/api/workspaces/${encodeURIComponent(slug)}/alerts/sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(forceCertificationId ? { forceCertificationId } : {}),
    }),

  saveAlertRules: (slug: string, rules: AlertRule[]) =>
    requestJson<{ workspace: Workspace }>(
      `/api/workspaces/${encodeURIComponent(slug)}/alerts/rules`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules }),
      },
    ),

  resetAlertRules: (slug: string) =>
    requestJson<{ workspace: Workspace }>(
      `/api/workspaces/${encodeURIComponent(slug)}/alerts/reset-defaults`,
      { method: "POST" },
    ),

  getMobilePortal: (token: string) =>
    requestJson<{
      workspaceSlug: string;
      companyName: string;
      portalSmsNumber: string;
      employee: Employee;
      certifications: Certification[];
    }>(`/api/mobile/${encodeURIComponent(token)}`),

  submitMobileRenewal: (token: string, formData: FormData) =>
    requestJson<{
      ok: boolean;
      certification: Certification;
      extraction: OcrExtractionResult;
      replyMessage: SmsMessage;
    }>(`/api/mobile/${encodeURIComponent(token)}/submit`, {
      method: "POST",
      body: formData,
    }),
};
