/**
 * Local job runner for development and for wiring into any scheduler that
 * can execute a shell command (cron, systemd timer, GitHub Actions, etc.)
 * instead of hitting the HTTP /api/cron/* endpoints.
 *
 * Usage:
 *   npm run job:generate-requests
 *   npm run job:send-reminders
 *   npm run job:escalate
 *
 * See README "Scheduling jobs" for production options (Vercel Cron hitting
 * the /api/cron/* routes, or running this script from a real crontab).
 */
import {
  generateReconciliationRequests,
  sendReminders,
  escalateUnresolved,
} from '../src/lib/reconciliationService';
import { importFromErpNext } from '../src/lib/erpImportService';
import { prisma } from '../src/lib/prisma';

async function main() {
  const job = process.argv[2];

  switch (job) {
    case 'pullErpNext': {
      const month = process.argv[3];
      if (!month) {
        console.error('Usage: npm run job:pull-erpnext -- 2026-08');
        process.exit(1);
      }
      const result = await importFromErpNext(month);
      console.log('importFromErpNext:', result);
      break;
    }
    case 'generateRequests': {
      const month = process.argv[3];
      const result = await generateReconciliationRequests(month);
      console.log('generateReconciliationRequests:', result);
      break;
    }
    case 'sendReminders': {
      const result = await sendReminders();
      console.log('sendReminders:', result);
      break;
    }
    case 'escalate': {
      const result = await escalateUnresolved();
      console.log('escalateUnresolved:', result);
      break;
    }
    default:
      console.error('Unknown job. Use: pullErpNext | generateRequests | sendReminders | escalate');
      process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
