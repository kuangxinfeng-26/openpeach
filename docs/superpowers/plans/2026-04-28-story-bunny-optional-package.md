# Story Bunny Optional Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional OpenPeach package that pre-wires AI Story Bunny as a child-safe toy device without importing firmware, private artifacts, or unfinished hardware work.

**Architecture:** Keep AI Story Bunny outside the default OpenPeach runtime path. Add `packages/toy-story-bunny` with bridge contract types, a mock bridge, and a `DeviceAdapter` implementation that can later be enabled by `home`. The package treats the toy as a child-facing terminal and preserves the rule that OpenPeach cannot bypass the toy safety runtime.

**Tech Stack:** TypeScript, Vitest, Zod, npm workspaces, existing `@openpeach/device-adapter` boundary.

---

### File Structure

- Create: `packages/toy-story-bunny/package.json`
- Create: `packages/toy-story-bunny/src/index.ts`
- Create: `packages/toy-story-bunny/src/story-bunny-contract.test.ts`
- Create: `packages/toy-story-bunny/src/story-bunny-adapter.test.ts`
- Modify: `README.md`
- Create: `docs/optional-toy-story-bunny.md`
- Modify: `docs/phase2-home-device-mvp.md`

### Task 1: Bridge Contract And Mock

- [ ] **Step 1: Write failing contract tests**

Add tests that validate bridge request/response schemas and mock bridge fallback behavior.

- [ ] **Step 2: Run contract tests to verify RED**

Run: `npm test -- packages/toy-story-bunny/src/story-bunny-contract.test.ts`
Expected: FAIL because the package and exports do not exist yet.

- [ ] **Step 3: Implement minimal contract and mock bridge**

Create `packages/toy-story-bunny/src/index.ts` with request/response schemas, typed scene IDs, and `createMockStoryBunnyBridge()`.

- [ ] **Step 4: Run contract tests to verify GREEN**

Run: `npm test -- packages/toy-story-bunny/src/story-bunny-contract.test.ts`
Expected: PASS.

### Task 2: DeviceAdapter Wrapper

- [ ] **Step 1: Write failing adapter tests**

Add tests for describing the toy, reading state, triggering play/bedtime scenes, idempotent command replay, and preserving child-safe fallback text.

- [ ] **Step 2: Run adapter tests to verify RED**

Run: `npm test -- packages/toy-story-bunny/src/story-bunny-adapter.test.ts`
Expected: FAIL because the adapter exports do not exist yet.

- [ ] **Step 3: Implement minimal adapter**

Expose `createStoryBunnyToyAdapter()` as a `DeviceAdapter` with `read_state`, `trigger_play_scene`, and `trigger_bedtime_scene`.

- [ ] **Step 4: Run adapter tests to verify GREEN**

Run: `npm test -- packages/toy-story-bunny/src/story-bunny-adapter.test.ts`
Expected: PASS.

### Task 3: Documentation And Release Hygiene

- [ ] **Step 1: Document optional package usage**

Add `docs/optional-toy-story-bunny.md` explaining what is included, what is explicitly excluded, how it relates to the separate AI toy firmware project, and what hardware work remains unverified.

- [ ] **Step 2: Update project docs**

Update `README.md` and `docs/phase2-home-device-mvp.md` to point to the optional package while keeping it out of default runtime startup.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- packages/toy-story-bunny/src/story-bunny-contract.test.ts packages/toy-story-bunny/src/story-bunny-adapter.test.ts
npm test
npm run check
```

Expected: all pass.
