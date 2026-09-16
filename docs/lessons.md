# Verified Lessons

Only add lessons here that have been validated through recurrence or verified review, and pass the 10-point quality check.

---

| Date | Category | Scope | Lesson | Evidence / Incident | Prevention Rule | Superseded By |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-16 | [ARCH] | PROJECT | Google Workspace Add-on Chat apps require wrapping synchronous responses in `hostAppDataAction.chatDataAction.createMessageAction.message` or `updateMessageAction.message` rather than direct Chat API format | Incident: Google Chat displayed "Bot not responding" (GSuiteAddOns 503/schema error) until wrapped in hostAppDataAction | Always detect `event.commonEventObject` and encapsulate responses in `hostAppDataAction` for Workspace Add-on deployments | - |
| 2026-09-16 | [ARCH] | PROJECT | Google Workspace Add-on responses must never include top-level `renderActions` alongside `hostAppDataAction` — they are mutually exclusive in the Add-on response schema | Incident: Submitting form card triggered "Hours Reconciliation Bot is unable to process your request." when both were returned | Keep `hostAppDataAction` as the sole top-level response envelope when creating or updating chat messages | - |

