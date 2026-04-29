# OpenPeach Phase 3 Skill Registry MVP

Phase 3 starts with a guarded skill registry, not full automatic self-evolution. The goal is to make future skill evolution auditable before any generated skill can affect `main`, `home`, or family automation behavior.

## Implemented Slice

- `@openpeach/skill-registry` stores skill candidates in SQLite.
- `@openpeach/skill-evolution` can turn completed `lab` task traces into `shadow` skill candidates.
- `@openpeach/skill-replay` runs local replay checks and writes replay results back to SQLite.
- Explicit `lab:` / self-improvement style requests route to the lightweight `LabAgentRuntime`.
- New candidates enter `shadow` status by default.
- Each candidate records:
  - candidate id
  - skill name
  - target agent
  - source task id
  - draft Markdown
  - evidence records
  - quality score
  - risk score
- Promotion creates an `active` skill record and marks the candidate `promoted`.
- Promotion is blocked when quality is below `0.8` or risk is above `0.7`.
- `skill_replay_runs` records replay evidence before promotion.
- Promotion is blocked until the candidate has at least one passing replay with score `>= 0.8`.
- `skill_owner_approvals` records owner approval or rejection for elevated-risk candidates.
- Elevated-risk candidates with risk score `>= 0.5` and `<= 0.7` require owner approval before promotion.
- Active skills can be moved to `deprecated` or `blocked` status.
- `listActiveSkills()` only returns skills whose status is still `active`.
- `blocked` is terminal in this MVP. It is intended for unsafe or bad skills that should not be re-enabled implicitly.
- `getCandidateReview()` returns a read-only review view with the candidate, replay runs, owner approval state, and promotion blockers.
- The gateway persists events first, then runs skill evolution as a non-hot-path follow-up. Skill evolution failures do not break the user-facing reply path.
- Gateway event publishing is factored through `createGatewayEventPublisher()`, so persistence and `task.completed` -> skill-candidate proposal are covered by an end-to-end lab pipeline test instead of living only in the executable entry point.
- `LabAgentRuntime` emits the same `task.created`, `task.completed`, and `reply.queued` events as the user-facing runtimes, so its successful task traces can feed the evolution engine.

## SQLite Tables

```text
skill_candidates
  candidate_id
  name
  target_agent
  source_task_id
  status
  draft_markdown
  evidence_json
  quality_score
  risk_score
  created_at_ms
  updated_at_ms

skills
  skill_id
  candidate_id
  name
  target_agent
  version
  status
  markdown
  created_at_ms
  updated_at_ms

skill_replay_runs
  replay_run_id
  candidate_id
  status
  score
  notes
  created_at_ms

skill_owner_approvals
  approval_id
  candidate_id
  reviewer_identity
  decision
  reason
  created_at_ms
```

## Safety Rules

- Skill candidates do not become active automatically.
- `shadow` candidates are stored for review and replay; they are not executed by the runtime.
- Lab task traces only become candidates when the task targets `lab`, uses `candidate_memory` or `promote_if_verified`, and has `task.completed` evidence.
- Repeated completion events are idempotent. The generated candidate id is derived from the source task id.
- Promotion currently requires explicit code/API action and score thresholds.
- Promotion also requires replay evidence. A generated skill cannot become active just because its quality/risk scores look acceptable.
- Replay checks are intentionally local and conservative in this MVP. They validate review structure, obvious unsafe phrases, and when source task data is available, the source task id, completion event, acceptance contract, reporting contract, and escalation policy before recording pass/fail evidence.
- Elevated-risk candidates require explicit owner approval. A replay-passing skill still cannot promote itself when it carries meaningful family, project, or device-control risk.
- Owner rejection is a promotion blocker until a later approval record supersedes it.
- The review view uses the same promotion eligibility logic as `promoteCandidate()`, so visible blockers and enforcement do not drift.
- High-risk or low-quality candidates must stay out of `active`.
- Deprecated skills stay in the audit trail but are excluded from active use.
- Blocked skills are treated as terminally disabled.

## Promotion Blockers

```text
candidate_not_shadow
quality_below_threshold
risk_above_threshold
missing_passing_replay
owner_approval_required
owner_approval_rejected
```

## Verification

```bash
npm test -- packages/skill-registry/src/skill-registry.test.ts
npm test -- packages/skill-evolution/src/skill-evolution.test.ts
npm test -- packages/skill-replay/src/skill-replay.test.ts
npm test -- apps/gateway/src/evolution-publisher.test.ts
npm test -- scripts/skill-review.test.ts
npm test -- scripts/skill-replay.test.ts
npm run check
```

## Skill Evolution Entry Point

The Phase 3 evolution entry point is deliberately narrow:

```text
completed lab TaskPacket + task.completed evidence
-> @openpeach/skill-evolution
-> skill_candidates row in shadow status
```

It does not call the language model, does not execute the generated skill, and does not promote it. The generated draft Markdown is a conservative review artifact that points back to the source task and evidence. This keeps OpenPeach's self-improvement loop auditable while the real replay runner is still under construction.

## Lab Runtime MVP

The `lab` agent is now routable for explicit project and self-improvement work. The first routing patterns include:

```text
lab:
reusable skill
self-improvement
skill candidate
github idea
ai toy project
```

Lab tasks use `targetAgent: lab`, `executionMode: job`, `priority: P3`, and `memoryPolicy: candidate_memory`. The runtime still replies in the source Telegram session, but its completed task trace is eligible for shadow skill candidate creation. This keeps `lab` useful without giving it automatic promotion or device-control authority.

## Local Replay CLI

Use the local replay CLI to run the MVP acceptance checks and store a replay result:

```bash
npm run skill:replay -- <candidate_id>
```

For deterministic testing or automation, pass an explicit replay run id:

```bash
npm run skill:replay -- <candidate_id> --run-id <replay_run_id>
```

The CLI reads `TAOQIBAO_STATE_DB` when set. Otherwise it defaults to:

```text
$OPENPEACH_HOME/families/$TAOQIBAO_FAMILY_ID/state.db
```

The runner records `passed` when the candidate draft contains the required review sections and no obvious unsafe phrase. When the candidate has a `source_task_id` and the SQLite task/event trace exists, replay also requires the draft to cite the source task id, preserve the task's acceptance/reporting/escalation contracts, and have `task.completed` evidence in both the event log and candidate evidence. It records `failed` when structure is missing, unsafe text such as `bypass approval` / `disable safety` appears, source evidence is missing, or the draft drops those task contracts. This is still not the final semantic replay engine; it is the first source-backed executable gate before owner review and promotion.

## Local Review CLI

Use the local CLI to inspect a candidate without changing runtime state:

```bash
npm run skill:review -- <candidate_id>
```

The CLI reads `TAOQIBAO_STATE_DB` when set. Otherwise it defaults to:

```text
$OPENPEACH_HOME/families/$TAOQIBAO_FAMILY_ID/state.db
```

It prints the same review object returned by `getCandidateReview()` as JSON. The command is intentionally read-only and does not promote, deprecate, or block skills.

## Telegram Owner Command

Owners can inspect a candidate from Telegram:

```text
/skill_review <candidate_id>
/skill_approve <candidate_id> [reason]
/skill_reject <candidate_id> [reason]
```

Telegram bot username suffixes are accepted, for example:

```text
/skill_review@kxf_openpeach_bot <candidate_id>
/skill_approve@kxf_openpeach_bot <candidate_id> [reason]
/skill_reject@kxf_openpeach_bot <candidate_id> [reason]
```

The command runs after identity allowlist checks plus an explicit `owner` role check, and before normal task admission. It does not create a task, does not call the language model, and only queues a read-only review reply. Incomplete or malformed `/skill_review` commands return `Usage: /skill_review <candidate_id>` instead of falling through to the language model.

Approval and rejection commands write `skill_owner_approvals` audit records, then return the updated candidate review. They do not promote a skill automatically. Promotion remains a separate registry action guarded by score, replay, risk, and owner approval checks.

## Next Work

- Extend source-backed replay into candidate-specific semantic acceptance checks.
- Add richer lab tools for code/project inspection, GitHub idea absorption, and AI toy package evolution.
