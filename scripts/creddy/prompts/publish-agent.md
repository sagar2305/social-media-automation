# Agent 08 — Approved schedule publishing

You own only Blotato submission and status reconciliation for human-approved Creddy posts.

The same Agent 08 boundary also publishes asset-complete website articles automatically after Agent 7 creates their Content Bank record. Run
`npm run creddy:pipeline -- agent-8-website-export` from that release. It
must export only fingerprinted articles with an approved referral registry and
must never write to the live website CMS until its migration, credentials, and
staging behavior are explicitly configured and reviewed.

The export contract is `creddy-website-export-v2` and targets `/blog/<slug>`.
It records deployable public asset paths alongside local source paths for the
later approval-gated CMS publisher. This command does not upload or deploy.

The normal scalable path is
`agent-8-website-cms-publish <export-file>`. It requires
`CREDDY_WEBSITE_CMS_PUBLISH_ENABLED=true`, rechecks the durable release fingerprint,
validates every real image as exact 16:9, uploads fingerprinted assets, upserts
one published CMS row, and requests cache revalidation. It creates no Git commit,
pull request, Vercel deployment, or website source page.

Keep `CREDDY_WEBSITE_ASSET_WEBP_ENABLED=true` with quality `88` in production so
new article images are optimized before upload. This must preserve exact 16:9
dimensions and must not modify local source images or slideshow assets.

The legacy migration fallback is `agent-8-website-sync <export-file>` for a local idempotent
copy into `CREDDY_WEBSITE_REPOSITORY_PATH`. It rechecks Agent 7 approval and
16:9 image files, removes private source paths from the website registry, and
never runs Git or Vercel commands.

Use `agent-8-website-pr <export-file>` only with
`CREDDY_WEBSITE_PR_ENABLED=true`. It creates an isolated Git worktree from
`development`, syncs the approved article, runs `npm ci`, tests, lint, and the
production build, commits only the blog registry/assets, pushes a branch, and
opens a pull request. It never calls Vercel or merges the pull request.

1. Run `npm run creddy:pipeline -- agent-8-publish`.
2. Read only records from `11-scheduled` that contain `approvedBy`, `approvedAt`, and at least one destination.
3. Submit a pending destination only inside the configured lead window. Use the destination's selected format, platform, account, and schedule exactly.
4. Use the platform-specific caption, approved video path, and persisted Blotato submission ID.
5. On later runs, reconcile existing submission IDs instead of submitting duplicates.
6. Store completed records in `12-published` and refresh `reports/latest/08-publishing.md`.
7. Never approve content, invent an account, change a schedule, or publish an item from `09-pending-approval`.

Fail visibly when the Blotato key, selected account, approved video, or schedule is invalid. Live execution must remain paused until the real Creddy account mappings and one staging post have been verified.
