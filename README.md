# CertPulse — Free Employee Certification & Compliance Alerts

> 100% free forever ($0/mo, unlimited employees). Automated safety card tracking, photo OCR renewals, and escalating expiry reminders for field teams and small businesses.

Live Production URL: [https://certpulse-one.vercel.app](https://certpulse-one.vercel.app)

---

## Overview

CertPulse helps field service teams, trade crews, and small businesses replace error-prone spreadsheets with simple, free certification tracking:

- **Mobile Upload Portal**: Workers take a photo of renewal cards (CPR, OSHA, CDL, Forklift, EPA 608) on their phones. Built-in OCR detects expiration dates automatically.
- **Escalating Alerts**: Automated notices delivered at 60, 30, and 7-day intervals to both worker and supervisor.
- **100% Free Forever**: No monthly subscription, no seat limits, no trials, and no credit card required.
- **Spreadsheet Importer**: Paste tab-delimited or comma-delimited rosters directly from Excel or Google Sheets.
- **Audit Export**: 1-click CSV export with full employee and certification records.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Vite
- **API**: Hono serverless endpoints running on Vercel Functions
- **Storage**: Vercel Blob (production) with local filesystem and in-memory fallbacks
- **OCR Engine**: Tesseract.js in-browser processing with server pattern matching
- **Testing**: Vitest with comprehensive compliance calculation test suite

---

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm

### Installation

```bash
git clone https://github.com/diyorbekibrohimov008-ops/certpulse.git
cd certpulse
npm install
```

### Local Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Running Tests & Typechecks

```bash
npm test
npm run typecheck
npm run build
```

---

## Architecture & API Routes

- `GET /api/health` — System status and active storage driver
- `GET /api/workspaces` — List company workspaces
- `GET /api/workspaces/:slug` — Workspace roster, certs, and calculated compliance score
- `POST /api/workspaces/:slug/employees` — Add team member with optional initial certification
- `POST /api/workspaces/:slug/import` — Ingest Excel TSV / CSV crew data
- `POST /api/workspaces/:slug/ocr` — Extract expiry and card details from uploaded images
- `POST /api/workspaces/:slug/sms/inbound` — Handle photo renewals and update records
- `POST /api/workspaces/:slug/alerts/sweep` — Run 60/30/7-day notification escalation
- `GET /api/mobile/:token` — Worker mobile renewal portal endpoint
- `POST /api/cron/sweep` — Scheduled cron endpoint for daily automated sweeps

---

## License

MIT License.
