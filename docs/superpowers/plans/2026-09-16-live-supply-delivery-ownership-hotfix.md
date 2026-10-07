# LIVE_SUPPLY_DELIVERY Ownership Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a WAREHOUSE user to sync physical `LIVE_SUPPLY_DELIVERY` child documents that belong to their own live-supply cart without weakening ownership checks for foreign ENTRY/SUPPLY documents.

**Architecture:** Keep the synthetic child `ownerId` (`live-delivery:<parentCartId>`) unchanged. Teach server-side operational ownership to recognize only canonical `LIVE_SUPPLY_DELIVERY` documents, resolve `metadata.parentCartId`, and authorize through the canonical parent cart owner. The same resolution must protect child CREATE, child UPDATE, child lines, child movements, and direct document ownership checks.

**Tech Stack:** Node.js 22, `node:test`, PostgreSQL-backed sync server.

**Spec:** Incident diagnosis from production sync queue: WAREHOUSE receives `OPERATIONAL_DOCUMENT_FORBIDDEN` for physical live-supply deliveries whose client intentionally uses synthetic owners.

## Global Constraints

- Do not rewrite or delete client IndexedDB data or the 118 queued events.
- Preserve the synthetic delivery owner format `live-delivery:<parentCartId>`.
- GOD and DEV_ADMIN/dev bypass behavior must remain unchanged.
- Normal ENTRY/SUPPLY ownership checks must remain unchanged.
- A child is eligible for inherited ownership only when `type=SUPPLY`, `metadata.kind=LIVE_SUPPLY_DELIVERY`, `metadata.parentCartId` is present, and `ownerId` exactly matches `live-delivery:<parentCartId>`.
- The referenced parent must exist in the same workspace, be `SUPPLY`, and be owned by the authenticated operational actor.

---

### Task 1: Reproduce the rejected live-delivery CREATE

**Files:**
- Modify: `v2/test/operationalOwnership.test.js`

**Interfaces:**
- Consumes: `assertOperationalEventOwnership(client, auth, event)`
- Produces: regression coverage showing an owned live-supply delivery CREATE is accepted and a foreign-parent child is rejected.

- [ ] **Step 1: Write the failing test**

Extend the fake client to return document metadata, then add a test that creates a synthetic `LIVE_SUPPLY_DELIVERY` child with `parentCartId=supply-a`, where `supply-a.ownerId=firebase-a`, and expects no rejection.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- operationalOwnership.test.js`
Expected: FAIL because current CREATE ownership compares the synthetic child owner directly with `firebase-a`.

- [ ] **Step 3: Commit the RED test**

Commit message: `test: reproduce live supply delivery ownership rejection`

### Task 2: Resolve CREATE ownership through the parent cart

**Files:**
- Modify: `v2/server/src/security/operationalOwnership.js`
- Test: `v2/test/operationalOwnership.test.js`

**Interfaces:**
- Consumes: child payload `{ type, ownerId, metadata.kind, metadata.parentCartId }`
- Produces: parent-resolved authorization for canonical live-delivery CREATE events.

- [ ] **Step 1: Implement the minimal parent-resolution helper**

Recognize only a canonical live-delivery shape and query its parent in the same workspace.

- [ ] **Step 2: Keep foreign/spoofed children forbidden**

Require exact synthetic owner format and require the parent owner to match the actor.

- [ ] **Step 3: Run the ownership test**

Run: `npm test -- operationalOwnership.test.js`
Expected: PASS for own parent; forbidden for foreign/spoofed parent.

- [ ] **Step 4: Commit**

Commit message: `fix: authorize live supply delivery create via parent owner`

### Task 3: Cover child UPDATE, lines, movements, and direct access

**Files:**
- Modify: `v2/test/operationalOwnership.test.js`
- Modify: `v2/server/src/security/operationalOwnership.js`

**Interfaces:**
- Consumes: canonical server child row with `metadata.kind=LIVE_SUPPLY_DELIVERY` and `metadata.parentCartId`.
- Produces: inherited parent ownership for every guarded event and direct document ownership check.

- [ ] **Step 1: Add failing tests for canonical child rows**

Test `document UPDATE`, `documentLine`, `movement`, and `assertOperationalDocumentOwnership` for an owned parent and a foreign parent.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm test -- operationalOwnership.test.js`
Expected: FAIL because current canonical lookup compares the synthetic child owner directly.

- [ ] **Step 3: Reuse the parent-resolution helper for canonical rows**

Select `metadata` with `type, owner_id`, resolve eligible child ownership through the parent, and preserve existing behavior for every other document.

- [ ] **Step 4: Run focused and full tests**

Run: `npm test -- operationalOwnership.test.js`
Then: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

Commit message: `fix: inherit live delivery ownership across sync events`

### Task 4: Review and recovery validation

**Files:**
- No production data mutation.

**Interfaces:**
- Consumes: draft hotfix PR and the existing 118-event client queue.
- Produces: verified server hotfix ready for controlled deployment.

- [ ] **Step 1: Review diff scope**

Only ownership server code, ownership tests, and this plan may change.

- [ ] **Step 2: Run CI on a draft PR**

Expected: client tests, server syntax, and server integration all PASS.

- [ ] **Step 3: Deploy the hotfix branch to the test server only after CI**

Do not merge automatically.

- [ ] **Step 4: Re-open the affected PC and observe queue recovery**

Expected: 403 errors stop, failed events retry successfully, pending count falls toward zero, and no client-side owner rewrite is needed.
