import type { Certification, ComplianceBucket, Employee } from "./types";

const MS_PER_DAY = 86_400_000;

export function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = parseIsoDateUtc(isoDate);
  return toIsoDateString(new Date(base.getTime() + days * MS_PER_DAY));
}

export function parseIsoDateUtc(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Invalid ISO date string: ${isoDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getDaysRemaining(expiryDate: string, referenceDate: Date = new Date()): number {
  const todayUtc = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  );
  const expiryUtc = parseIsoDateUtc(expiryDate).getTime();
  return Math.round((expiryUtc - todayUtc) / MS_PER_DAY);
}

export function getComplianceBucket(daysRemaining: number): ComplianceBucket {
  if (daysRemaining < 0) return "expired";
  if (daysRemaining <= 7) return "critical_7";
  if (daysRemaining <= 30) return "warning_30";
  if (daysRemaining <= 60) return "watch_60";
  return "compliant";
}

export function getBucketMeta(bucket: ComplianceBucket): {
  label: string;
  shortLabel: string;
  tone: "rose" | "orange" | "amber" | "emerald";
  fineRiskUsd: number;
} {
  switch (bucket) {
    case "expired":
      return {
        label: "Expired",
        shortLabel: "Expired",
        tone: "rose",
        fineRiskUsd: 16_131,
      };
    case "critical_7":
      return {
        label: "Critical (≤ 7d)",
        shortLabel: "≤ 7d",
        tone: "rose",
        fineRiskUsd: 5_000,
      };
    case "warning_30":
      return {
        label: "Action (≤ 30d)",
        shortLabel: "≤ 30d",
        tone: "orange",
        fineRiskUsd: 1_500,
      };
    case "watch_60":
      return {
        label: "Watch (≤ 60d)",
        shortLabel: "≤ 60d",
        tone: "amber",
        fineRiskUsd: 0,
      };
    case "compliant":
      return {
        label: "Compliant",
        shortLabel: "Valid",
        tone: "emerald",
        fineRiskUsd: 0,
      };
  }
}

export interface ComputedCertificationRow {
  cert: Certification;
  employee: Employee;
  daysRemaining: number;
  bucket: ComplianceBucket;
}

export function computeWorkspaceMetrics(
  employees: Employee[],
  certifications: Certification[],
  referenceDate: Date = new Date(),
) {
  const employeeMap = new Map(employees.map((emp) => [emp.id, emp]));
  const rows: ComputedCertificationRow[] = [];

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
    compliant: rows.filter((r) => r.bucket === "compliant").length,
  };

  const nonExpiredCount = counts.total - counts.expired;
  const complianceScore =
    counts.total === 0 ? 100 : Math.round((nonExpiredCount / counts.total) * 100);

  const estimatedFineExposureUsd = rows.reduce(
    (sum, row) => sum + getBucketMeta(row.bucket).fineRiskUsd,
    0,
  );

  return {
    rows,
    counts,
    complianceScore,
    estimatedFineExposureUsd,
    activeSeats: employees.filter((e) => e.active).length,
  };
}
