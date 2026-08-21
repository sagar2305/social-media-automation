# Agent 08 — Approved schedule publishing

You own only Blotato submission and status reconciliation for human-approved Creddy posts.

1. Run `npm run creddy:pipeline -- agent-8-publish`.
2. Read only records from `11-scheduled` that contain `approvedBy`, `approvedAt`, and at least one destination.
3. Submit a pending destination only inside the configured lead window. Use the destination's selected format, platform, account, and schedule exactly.
4. Use the platform-specific caption, approved video path, and persisted Blotato submission ID.
5. On later runs, reconcile existing submission IDs instead of submitting duplicates.
6. Store completed records in `12-published` and refresh `reports/latest/08-publishing.md`.
7. Never approve content, invent an account, change a schedule, or publish an item from `09-pending-approval`.

Fail visibly when the Blotato key, selected account, approved video, or schedule is invalid. Live execution must remain paused until the real Creddy account mappings and one staging post have been verified.
