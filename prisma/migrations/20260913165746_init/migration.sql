-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ErpImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "rawContent" TEXT NOT NULL,
    "errors" TEXT
);

-- CreateTable
CREATE TABLE "ErpTimesheetRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "erpHours" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ErpTimesheetRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ErpImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReconciliationRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "erpHours" REAL NOT NULL,
    "erpImportRowId" TEXT,
    "employeeConfirmedHours" REAL,
    "difference" REAL,
    "result" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_RESPONSE',
    "employeeExplanation" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" DATETIME,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalisedAt" DATETIME,
    CONSTRAINT "ReconciliationRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReconciliationRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConfirmationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliationRecordId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'INITIAL',
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfirmationToken_reconciliationRecordId_fkey" FOREIGN KEY ("reconciliationRecordId") REFERENCES "ReconciliationRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliationRecordId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_reconciliationRecordId_fkey" FOREIGN KEY ("reconciliationRecordId") REFERENCES "ReconciliationRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliationRecordId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "mocked" BOOLEAN NOT NULL DEFAULT true,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageLog_reconciliationRecordId_fkey" FOREIGN KEY ("reconciliationRecordId") REFERENCES "ReconciliationRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "reminderIntervalDays" INTEGER NOT NULL DEFAULT 3,
    "maxReminders" INTEGER NOT NULL DEFAULT 2,
    "escalationEmail" TEXT NOT NULL DEFAULT 'hr-escalations@example.com',
    "initialRequestSubject" TEXT NOT NULL DEFAULT 'Please confirm your project hours for {{month}}',
    "initialRequestBody" TEXT NOT NULL DEFAULT 'Hi {{employeeName}},

Please confirm the hours you worked on {{projectName}} during {{month}} using the secure link below:

{{link}}

Thanks,
HR Team',
    "mismatchSubject" TEXT NOT NULL DEFAULT 'Action needed: hours mismatch for {{month}}',
    "mismatchBody" TEXT NOT NULL DEFAULT 'Hi {{employeeName}},

Our records show a difference between your confirmed hours and the ERP timesheet for {{projectName}} ({{month}}).

You confirmed: {{confirmedHours}}
ERP shows: {{erpHours}}
Difference: {{difference}}

Please review and correct or explain using the secure link below:

{{link}}

Thanks,
HR Team',
    "reminderSubject" TEXT NOT NULL DEFAULT 'Reminder: hours confirmation pending for {{month}}',
    "reminderBody" TEXT NOT NULL DEFAULT 'Hi {{employeeName}},

This is a reminder that we still need your confirmation of hours for {{projectName}} ({{month}}).

{{link}}

Thanks,
HR Team',
    "escalationSubject" TEXT NOT NULL DEFAULT 'Escalation: unresolved hours discrepancy for {{month}}',
    "escalationBody" TEXT NOT NULL DEFAULT 'An unresolved hours discrepancy needs review.

Employee: {{employeeName}}
Project: {{projectName}}
Month: {{month}}
Confirmed: {{confirmedHours}}
ERP: {{erpHours}}
Difference: {{difference}}
Reminders sent: {{reminderCount}}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "ErpTimesheetRow_employeeCode_projectCode_month_idx" ON "ErpTimesheetRow"("employeeCode", "projectCode", "month");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_status_idx" ON "ReconciliationRecord"("status");

-- CreateIndex
CREATE INDEX "ReconciliationRecord_month_idx" ON "ReconciliationRecord"("month");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRecord_employeeId_projectId_month_key" ON "ReconciliationRecord"("employeeId", "projectId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ConfirmationToken_tokenHash_key" ON "ConfirmationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ConfirmationToken_reconciliationRecordId_idx" ON "ConfirmationToken"("reconciliationRecordId");

-- CreateIndex
CREATE INDEX "AuditEvent_reconciliationRecordId_idx" ON "AuditEvent"("reconciliationRecordId");

-- CreateIndex
CREATE INDEX "MessageLog_reconciliationRecordId_idx" ON "MessageLog"("reconciliationRecordId");
