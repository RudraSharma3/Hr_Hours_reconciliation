/**
 * Local Webhook Tester
 *
 * Sends simulated Google Chat card actions directly to your local Next.js dev server (http://localhost:3000)
 * or to production to verify request processing, database updates, and response cards in real-time.
 *
 * Usage:
 *   Local dev:        npm run test:bot
 *   Against Vercel:   npm run test:bot:prod
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ENDPOINT = `${BASE_URL}/api/chat/google`;

async function postEvent(name, payload) {
  console.log(`\n===============================================================`);
  console.log(`📡 [TEST] ${name}`);
  console.log(`===============================================================`);
  console.log('📤 Sending to:', ENDPOINT);

  try {
    const start = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const duration = Date.now() - start;
    console.log(`📥 HTTP Status: ${res.status} (${duration}ms)`);

    const json = await res.json();
    console.log('📦 Bot Response:\n', JSON.stringify(json, null, 2));

    if (json.hostAppDataAction?.chatDataAction?.updateMessageAction) {
      console.log('✅ Google Workspace Add-on updateMessageAction returned successfully!');
    } else if (json.actionResponse) {
      console.log('✅ Google Chat API actionResponse returned successfully!');
    }

    return json;
  } catch (err) {
    console.error(`❌ Request Failed:`, err.message);
    if (err.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Tip: Make sure your local server is running with: npm run dev');
    }
  }
}

async function run() {
  console.log('🤖 LOCAL GOOGLE CHAT WEBHOOK TESTER');
  console.log('Targeting:', BASE_URL);

  // 1. Test Text Command: "help"
  await postEvent('1. Employee sends text: "help"', {
    type: 'MESSAGE',
    user: { displayName: 'Rudra Sharma', email: 'rudra@bytepx.com' },
    message: { text: 'help' },
  });

  // 2. Test Text Command: "pending"
  const pendingResp = await postEvent('2. Employee sends text: "pending"', {
    type: 'MESSAGE',
    user: { displayName: 'Rudra Sharma', email: 'rudra@bytepx.com' },
    message: { text: 'pending' },
  });

  // Extract pending records if available
  let pendingRecordId = 'test-record-id';
  let inputFieldName = 'confirmedHours';
  let projectName = 'Project';

  const sections = pendingResp?.cardsV2?.[0]?.card?.sections || [];
  if (sections.length > 0) {
    for (const sec of sections) {
      const btn = sec.widgets?.find((w) => w.buttonList)?.buttonList?.buttons?.[0];
      const params = btn?.onClick?.action?.parameters || [];
      const recParam = params.find((p) => p.key === 'reconciliationRecordId');
      const inputParam = params.find((p) => p.key === 'inputFieldName');

      if (recParam?.value) {
        pendingRecordId = recParam.value;
        inputFieldName = inputParam?.value || 'confirmedHours';
        projectName = sec.header || 'Assigned Project';
        break;
      }
    }
  }

  console.log(`\n🔎 Found Active Pending Record for testing: [${projectName}] (ID: ${pendingRecordId})`);

  // 3. Test Card Button: Exact Match Submission
  await postEvent(`3. Employee submits Exact Match (120 hrs on ${projectName})`, {
    commonEventObject: {
      invokedFunction: 'submitHoursConfirmation',
      parameters: {
        reconciliationRecordId: pendingRecordId,
        inputFieldName,
      },
      formInputs: {
        [inputFieldName]: {
          stringInputs: { value: ['120'] },
        },
      },
    },
  });

  // 4. Test Card Button: Mismatch / Discrepancy Submission
  await postEvent(`4. Employee submits Mismatch (95 hrs on ${projectName})`, {
    commonEventObject: {
      invokedFunction: 'submitHoursConfirmation',
      parameters: {
        reconciliationRecordId: pendingRecordId,
        inputFieldName,
      },
      formInputs: {
        [inputFieldName]: {
          stringInputs: { value: ['95'] },
        },
      },
    },
  });

  // 5. Test Card Button: Justification Reason Submission
  await postEvent(`5. Employee submits Justification for Mismatch on ${projectName}`, {
    commonEventObject: {
      invokedFunction: 'submitHoursExplanation',
      parameters: {
        reconciliationRecordId: pendingRecordId,
        confirmedHours: '95',
      },
      formInputs: {
        employeeExplanation: {
          stringInputs: { value: ['5 hours unbilled client revision meeting'] },
        },
      },
    },
  });

  console.log('\n🎉 Local Webhook Tests Completed Successfully!');
}

run().catch(console.error);
