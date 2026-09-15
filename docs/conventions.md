# Project Conventions

This document establishes coding standards, style preferences, architectural patterns, git workflows, and testing practices for this repository.

---

## 1. Code Style & Formatting

### General TypeScript & Next.js Standards
- **Strict Typing**: Type annotations are required for all function arguments, return types, public interfaces, and API request/response contracts. Avoid `any` — use `unknown` with type narrowing or Zod schemas.
- **Next.js App Router Architecture**:
  - Default to **Server Components** for layouts and data-fetching pages.
  - Mark interactive UI with `'use client'` at the very top of the file (e.g., `DashboardClient.tsx`, `ErpImportClient.tsx`).
  - Keep business logic in `src/lib/` services, never embedded directly in React components or Next.js route handlers.
- **Prisma Client Access**:
  - Always import the shared singleton client from `@/lib/prisma` (or `../src/lib/prisma`). Never instantiate `new PrismaClient()` in request handlers.
- **Database & Enums Compatibility**:
  - Because SQLite does not support native enums, status fields in Prisma are strings, validated at runtime and typed via `src/lib/statusTypes.ts` (`ReconciliationStatus`).
  - When migrating to PostgreSQL, keep string values identical to maintain complete backward compatibility.

### Domain Invariants & Rules
- **Zero-Tolerance Matching Invariant (`src/lib/matching.ts`)**:
  - `computeMatch` must remain pure, synchronous, and strict: `difference = Math.abs(confirmed - erp)`.
  - Exactly `difference === 0` yields `result: 1` (`Matched`). Any non-zero difference yields `result: 0` (`Flagged`).
  - **NEVER** introduce epsilon rounding, tolerance bands, or approximations without an explicit architectural decision record (ADR).
- **ERP Import History Retention**:
  - Never delete or overwrite historical `ErpTimesheetRow` records in place.
  - When importing updated timesheets for an existing `(employeeCode, projectCode, month)`, mark the previous row `isCurrent: false` and insert the new row with `isCurrent: true`.

### Adapter Pattern Standards
- External providers (ERP systems, messaging channels) must implement their respective interface:
  - `ErpAdapter` (`src/lib/adapters/erp/types.ts`): Must return normalized `ErpTimesheetEntry[]` aggregated to one monthly total per employee/project.
  - `MessagingAdapter` (`src/lib/adapters/messaging/types.ts`): Must implement `send(message: OutboundMessage): Promise<SendResult>`.
- Selection of active adapters is centralized in factory functions (`getErpAdapter()`, `getMessagingAdapter()`) driven by environment variables (`ERP_MODE`, `MESSAGING_CHANNEL`).

---

## 2. Git & Version Control

- **Commit Message Format**:
  - Follow the Conventional Commits specification: `<type>(<scope>): <short imperative summary>`
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
  - Examples:
    - `feat(erp): add ERPNext Timesheet webhook signature validation`
    - `fix(matching): ensure zero confirmed hours correctly flags non-zero ERP hours`
    - `test(tokens): add replay attack and token expiration test cases`
- **Pre-Commit Guard**:
  - Repository includes `.githooks/pre-commit` to prevent committing secrets (API keys, private keys, `.env` files).
  - Ensure githooks are active via `git config core.hooksPath .githooks`.
- **Surgical Changes**: Keep pull requests and commits scoped to a single logical change with accompanying tests.

---

## 3. Error Handling & Logging

- **Input Validation**: Validate all inbound HTTP request payloads (JSON bodies, query params, webhook payloads) using `zod` schemas before processing.
- **Non-blocking Ingestion**: ERP CSV and API imports must capture per-row validation errors and store them in `ErpImportBatch.errors` without aborting the entire batch.
- **Explicit API Responses**:
  - Return standardized HTTP status codes: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `410 Gone` (expired/used tokens), `500 Internal Server Error`.
  - Include `{ error: string }` or `{ error: object, ok: false }` in JSON payloads.
- **Secure Logging & Auditability**:
  - Never log raw confirmation tokens, passwords, database credentials, or API secrets.
  - Record business-critical events in `AuditEvent` with `reconciliationRecordId`, `eventType`, `actor`, and a JSON `details` payload.
  - Record all outbound communications in `MessageLog` with delivery status (`mocked: boolean`).

---

## 4. Testing Conventions

- **Test Runner**: Vitest (`npm test` / `npm run test:watch`).
- **File Organization & Naming**:
  - Test files reside in `tests/` named `<module>.test.ts`.
- **Testing Layers**:
  1. **Pure Unit Tests**: Test deterministic domain logic with exhaustive boundary and edge cases without DB dependencies (`tests/matching.test.ts`, `tests/templates.test.ts`, `tests/erpNextAggregation.test.ts`, `tests/csvExport.test.ts`, `tests/erpCsvAdapter.test.ts`).
  2. **Database Integration Tests**: Test real ORM interactions, uniqueness constraints, token hashing, and row superseding against the migrated SQLite database (`tests/tokens.test.ts`, `tests/erpImportService.test.ts`).
- **Test Structure (AAA Pattern)**:
  - **Arrange**: Set up database fixtures or input data.
  - **Act**: Call the service or unit function under test.
  - **Assert**: Assert expected return values, database state changes, and error behaviors.
- **Coverage Requirements**:
  - Always add unit tests for any modifications to matching math, token lifecycle, adapter parsers, or import services.

