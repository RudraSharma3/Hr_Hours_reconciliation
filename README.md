# ⏱️ Employee Hours Reconciliation Automation

[![Vercel Deployment](https://img.shields.io/badge/Vercel-Live%20Production%20Demo-brightgreen?style=flat-square&logo=vercel)](https://hr-hours-reconciliation.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![Google Chat](https://img.shields.io/badge/Google%20Chat-Cards%20v2-4285F4?style=flat-square&logo=googlechat)](https://developers.google.com/workspace/chat)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Vitest](https://img.shields.io/badge/Vitest-Unit%20Tests-6E9F18?style=flat-square&logo=vitest)](https://vitest.dev/)

> **Automates the monthly verification and reconciliation of ERP timesheet hours against employee-confirmed hours.**  
> Eliminates manual HR chasing, protects confidential billable hours with zero-knowledge verification, and flags discrepancies instantly for review.

---

### 🌐 Live Production Demo

- **🔗 Admin Dashboard & Web Portal**: [https://hr-hours-reconciliation.vercel.app](https://hr-hours-reconciliation.vercel.app)
- **🤖 Google Chat Bot Interactive Endpoint**: `https://hr-hours-reconciliation.vercel.app/api/chat/google`
- **🔑 Demo Admin Credentials**:
  - **Email**: `admin@example.com`
  - **Password**: `ChangeMe123!`

---

## 📑 Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Core Architecture & Verification Workflow](#2-core-architecture--verification-workflow)
3. [Key Features](#3-key-features)
4. [Technology Stack](#4-technology-stack)
5. [Local Development Setup](#5-local-development-setup)
6. [Google Chat Bot Integration (Cards v2)](#6-google-chat-bot-integration-cards-v2)
7. [ERPNext Integration Guide](#7-erpnext-integration-guide)
8. [Scheduled Background Jobs & Cron](#8-scheduled-background-jobs--cron)
9. [API Route Reference](#9-api-route-reference)
10. [Repository Structure & Codebase Map](#10-repository-structure--codebase-map)
11. [Security Architecture](#11-security-architecture)
12. [Testing & Quality Assurance](#12-testing--quality-assurance)

---

## 1. Executive Summary & Problem Statement

### ❌ The Problem
In standard organizational workflows, HR teams manually compare timesheets recorded in ERP systems against employee recollections at the end of every billing cycle:
- **High Friction**: HR sends countless manual emails/messages asking employees to verify their hours.
- **Data Leakage**: Revealing recorded ERP hours upfront biases the employee ("anchor bias") rather than collecting honest hours worked.
- **Unmanaged Exceptions**: Discrepancies get lost in chat threads, delaying payroll and client invoicing.

### ✅ The Solution
This platform automates the entire verification loop:
1. **ERP Ingestion**: Automatically pulls or imports monthly project hours from ERPNext or CSV uploads.
2. **Zero-Knowledge (Blind) Requests**: Prompts employees via **Google Chat Cards v2** (or secure magic links) to submit their worked hours *without* seeing the recorded ERP hours.
3. **Zero-Tolerance Matching Engine**: Computes exact difference (`|confirmed - erp| === 0`).
   - **Exact Match**: Instantly approved and marked `RESOLVED`.
   - **Discrepancy**: Employee is immediately prompted for an explanation, and the record is flagged for HR review on the admin dashboard.
4. **Audit Trail**: Every interaction, token generation, timestamp, and justification is permanently preserved.

---

## 2. Core Architecture & Verification Workflow

```mermaid
sequenceDiagram
    autonumber
    actor ERP as ERP / CSV Import
    actor Bot as Google Chat / Email
    actor Emp as Employee
    actor HR as HR Admin Dashboard

    ERP->>Bot: 1. Monthly Timesheets Ingested
    Bot->>Emp: 2. Blind Request ("How many hours did you spend on Project X?")
    Emp->>Bot: 3. Submits Confirmed Hours (e.g. 77 hrs)
    
    alt Exact Match (difference === 0)
        Bot-->>Emp: ✅ Approved & Reconciled Card
    else Discrepancy Flagged (difference > 0)
        Bot-->>Emp: ⚠️ Mismatch Card: Prompt for Justification
        Emp->>Bot: Submits Reason (e.g. "5 hrs overtime approved by lead")
        Bot->>HR: ⏳ Escalates Record to Dashboard for HR Confirmation
        HR->>HR: Reviews Explanation & Resolves Record
    end
```

---

## 3. Key Features

- **Dual-Channel Employee Delivery**:
  - **Google Chat Bot**: Fully native Google Workspace Add-on Cards v2 with single-card multi-project layouts, real-time interactive text inputs, and dynamic action routing.
  - **Secure Magic Links**: Web-based fallback with single-use SHA-256 hashed tokens.
- **Zero-Tolerance Matching**: `src/lib/matching.ts` enforces exact matching (`difference === 0 → result: 1`). Any discrepancy is flagged without rounding or tolerance leaks.
- **ERP Adapters & Idempotency**:
  - Modular ERP adapter architecture supporting both CSV files and live ERPNext REST API / Webhooks.
  - Historical versioning (`isCurrent: false` on superseding imports).
- **Automated Escalation Engine**:
  - Automated reminder cron job with configurable intervals and max reminder thresholds before automatic HR escalation.
- **Comprehensive HR Dashboard**:
  - Real-time statistics (Matched, Flagged, Awaiting Response, Escalated).
  - Search and filter by employee, project, status, and billing month.
  - Full audit logs with actor tracing, diff breakdown, and single-click CSV exports.

---

## 4. Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5.0+ (Strict mode)
- **Database & ORM**: PostgreSQL (Production: Neon / Supabase) & SQLite (Local testing) via Prisma ORM
- **Styling**: Tailwind CSS & Lucide Icons
- **Chat Protocol**: Google Workspace Add-ons / Google Chat API (Cards v2)
- **Testing**: Vitest with TypeScript & Node environment
- **Deployment**: Vercel Serverless

---

## 5. Local Development Setup

### 1. Prerequisites
- **Node.js** 18.17+ or 20+
- **npm** or **pnpm**
- **Git**

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/RudraSharma3/Hr_Hours_reconciliation.git
cd Hr_Hours_reconciliation
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to create your local `.env`:
```bash
cp .env.example .env
```

Key environment variables:
```env
# Database (Postgres in production or local Postgres/SQLite)
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Base URL for confirmation links and webhook callbacks
APP_BASE_URL="http://localhost:3000"

# Admin Authentication
JWT_SECRET="generate-a-secure-48-character-secret"

# Cron Shared Secret
CRON_SECRET="generate-a-secure-32-character-secret"

# Messaging Provider (mock, google_chat, or email)
MESSAGING_CHANNEL="google_chat"
```

### 4. Database Setup & Seeding
```bash
# Push schema to database
npx prisma db push

# Seed sample data (Employees, Projects, Timesheets, Admin user)
npx prisma db seed
```

### 5. Start the Development Server
```bash
npm run dev
```

Visit `http://localhost:3000` and log in with default credentials:
- **Email**: `admin@example.com`
- **Password**: `ChangeMe123!`

---

## 6. Google Chat Bot Integration (Cards v2)

The bot supports direct interactive reconciliation in Google Chat using the **Google Workspace Add-on Cards v2 format**.

### Configuration in Google Cloud Console
1. Navigate to **Google Cloud Console** → **APIs & Services** → **Google Chat API** → **Configuration**.
2. **App Status**: Set to `Live - available to users`.
3. **Interactive Features**: Check `Receive 1:1 messages` and `Join spaces and group conversations`.
4. **Connection Settings**: Select **HTTP endpoint URL** and enter:
   ```
   https://<your-domain>/api/chat/google
   ```
5. **Visibility**: Choose your Workspace domain.

### Dynamic Action Routing Architecture
For Google Workspace Add-on endpoints, card actions require dynamic function URLs and buffered framing:
- **Framing**: `chatJson()` sends non-chunked JSON responses with explicit `Content-Length` to satisfy strict Google Workspace proxies.
- **Action Function**: `getChatActionFunctionUrl()` routes actions dynamically using `actionName` parameters (`submitHoursConfirmation`, `submitHoursExplanation`).

---

## 7. ERPNext Integration Guide

### Mode 1: Scheduled REST Pull
Set `ERP_MODE=erpnext` in `.env` and provide credentials:
```env
ERP_MODE="erpnext"
ERPNEXT_BASE_URL="https://your-instance.frappe.cloud"
ERPNEXT_API_KEY="your-api-key"
ERPNEXT_API_SECRET="your-api-secret"
```
The scheduled cron `/api/cron/pull-erpnext` will fetch Timesheet documents, aggregate hours by `(employee, project, month)`, and ingest records.

### Mode 2: Real-Time Webhook
Configure a Frappe Webhook on `Timesheet` docstatus changes pointing to:
```
POST https://<your-domain>/api/erp/webhook/erpnext
```

---

## 8. Scheduled Background Jobs & Cron

Protect all cron endpoints with the `Authorization: Bearer <CRON_SECRET>` header:

| Endpoint | Frequency | Description |
| :--- | :--- | :--- |
| `/api/cron/pull-erpnext` | Daily (`0 1 * * *`) | Ingests approved timesheets from ERPNext |
| `/api/cron/generate-requests` | Monthly (`0 2 1 * *`) | Generates pending reconciliation records |
| `/api/cron/send-reminders` | Daily (`0 9 * * *`) | Sends reminder cards for unconfirmed timesheets |
| `/api/cron/escalate` | Daily (`0 18 * * *`) | Escalates records exceeding max reminders to HR |

---

## 9. API Route Reference

### Authentication & Admin
- `POST /api/admin/login`: Issues httpOnly JWT session cookie.
- `GET /api/admin/me`: Returns active administrator identity.
- `POST /api/admin/logout`: Clears session cookie.

### Reconciliation Operations
- `GET /api/reconciliation`: Search, sort, and filter records.
- `GET /api/reconciliation/[id]`: Fetches record details and complete audit trail.
- `POST /api/reconciliation/broadcast`: Dispatches reconciliation cards to employees.
- `GET /api/reconciliation/export`: Generates downloadable CSV report.

### Inbound Chat Webhook
- `POST /api/chat/google`: Google Chat interactive event receiver (`MESSAGE`, `CARD_CLICKED`, `ADDED_TO_SPACE`).

---

## 10. Repository Structure & Codebase Map

```
employee-hours-reconciliation/
├── prisma/
│   ├── schema.prisma              # Database schema & relations
│   └── seed.ts                    # Test seed generator
├── src/
│   ├── app/                       # Next.js 14 App Router
│   │   ├── api/                   # API routes (chat, admin, erp, cron)
│   │   ├── confirm/[token]/       # Web-based confirmation magic link
│   │   ├── dashboard/             # HR analytics dashboard
│   │   ├── erp-import/            # CSV upload & batch history
│   │   ├── reconciliation/        # Searchable record management
│   │   └── settings/              # SLA & template configuration
│   ├── components/                # Reusable UI widgets & shells
│   └── lib/                       # Core business logic
│       ├── adapters/              # Modular Messaging & ERP adapters
│       │   ├── erp/               # CSV & ERPNext implementations
│       │   └── messaging/         # Google Chat (Cards v2) & Email adapters
│       ├── auth/                  # JWT session management & password hashing
│       ├── matching.ts            # Zero-tolerance match calculation
│       ├── reconciliationService.ts # Main reconciliation state machine
│       ├── erpImportService.ts    # Batch history & employee/project provisioning
│       └── tokens.ts              # Secure single-use token hashing
├── tests/                         # Vitest unit & integration test suites
└── docs/                          # Architectural decision records & schemas
```

---

## 11. Security Architecture

1. **Hashed Magic Tokens**:
   - Single-use, cryptographically generated tokens (`crypto.randomBytes(32)`).
   - Only `SHA-256` token hashes are stored in the database.
2. **Admin Authentication**:
   - Passwords hashed with `bcrypt` (12 salt rounds).
   - Encrypted `httpOnly`, `SameSite=Lax`, `Secure` JWT session cookies.
3. **No Secret Leaks**:
   - Strict `.env` isolation; zero credentials committed to version control.
   - Zero-Knowledge UI prevents leaking client rates or ERP recorded totals.

---

## 12. Testing & Quality Assurance

Run the automated test suite with Vitest:
```bash
# Run all unit and integration tests
npm test

# Run Google Chat Adapter tests
npx vitest run tests/googleChatAdapter.test.ts

# Run TypeScript typecheck
npx tsc --noEmit
```

---

## 📄 License
Internal Proprietary Software — Employee Hours Reconciliation System.
