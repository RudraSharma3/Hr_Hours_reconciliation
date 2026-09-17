# Verified Lessons

Only add lessons here that have been validated through recurrence or verified review, and pass the 10-point quality check.

---

| Date | Category | Scope | Lesson | Evidence / Incident | Prevention Rule | Superseded By |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-16 | [ARCH] | PROJECT | Google Workspace Add-on Chat apps require wrapping synchronous responses in `hostAppDataAction.chatDataAction.createMessageAction.message` or `updateMessageAction.message` rather than direct Chat API format | Incident: Google Chat displayed "Bot not responding" (GSuiteAddOns 503/schema error) until wrapped in hostAppDataAction | Always detect `event.commonEventObject` and encapsulate responses in `hostAppDataAction` for Workspace Add-on deployments | - |
| 2026-09-17 | [ARCH] | PROJECT | "Z Mode" represents strict Google Workspace Add-on (`google.apps.card.v1`) envelope and action specification (`hostAppDataAction.chatDataAction.createMessageAction` with `function` and `parameters`) | Incident: Switching between Chat API and Add-on schemas caused invalid response code 3 | Maintain Z Mode as canonical protocol for locked Add-on deployments | - |

