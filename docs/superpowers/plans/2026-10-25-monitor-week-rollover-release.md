# Monitor Week Rollover and HP Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve access to the October 19 review after Monday and prepare a guarded HP update.

**Architecture:** Add a recent-week selector to the existing Monitor state, reusing per-week round resolution and local keys. Add a version-pinned HP release script and runbook using the existing backup and restore helpers.

**Tech Stack:** Browser ES modules, Node tests, PostgreSQL 18, Windows PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-10-25-monitor-week-rollover-release-design.md`

## Global Constraints

- No stock, movement, `.env`, V2 list or offline queue deletion.
- Only `SmartInventoryV2` may stop; no automatic production database restore.
- Fail closed on SHA, DB version, dirty tree, backup or verification mismatch.

## Review Focus

- Monday rollover opens prior week deliberately and keeps its decision count.
- A week switch flushes selected inputs and does not blend week or round queues.
- Offline network failure does not authorize cycle closure.
- Backup validation includes a temporary restore rather than archive integrity alone.
- Code rollback keeps additive migration 022 and post-backup data intact.

---

### Task 1: Recent-week selection

**Files:** `v2/src/replenishment/monitorReviewWeeks.js`, `v2/src/ui/monitorReviewPilotUi.js`, `v2/test/monitorReviewWeeks.test.js`, `v2/scripts/monitorPilotBrowserSmoke.mjs`.

- [ ] Write a failing test for 2026-10-26 returning both 2026-10-26 and 2026-10-19, including year rollover.
- [ ] Verify it fails, implement the week list and selected-week validation, and verify it passes.
- [ ] Add a browser test that selects the previous week and observes its independent data and cycle; verify RED then implement the UI transition.
- [ ] Run client suite and browser smoke; commit.

### Task 2: Guarded HP release

**Files:** `docs/VIGIA/VIGIA_HP_MONITOR_CYCLES_DEPLOY_SAFE.ps1`, `docs/VIGIA/VIGIA_HP_MONITOR_CYCLES_RELEASE.md`, `.github/workflows/v2-tests.yml`.

- [ ] Prepare a pinned release procedure that runs the read-only precheck, creates new backups, validates temporary DB restore and requires explicit operator confirmation.
- [ ] Update the Windows syntax CI job for the release script and verify parse in CI.
- [ ] Verify the candidate ancestry and exact changed files, migration count, service health and rollback behavior in the procedure; commit.

### Task 3: Final verification

- [ ] Run the full client suite, syntax checks and CI at the exact HEAD.
- [ ] Review the diff and document HP-specific checks that remain unverified without access to the machine.
