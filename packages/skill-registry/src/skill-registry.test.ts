import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openPeachDb } from "../../store-sqlite/src/index.js";
import { createSkillRegistry } from "./index.js";

describe("skill registry", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("stores lab-generated skill candidates in shadow status", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);

      registry.createCandidate({
        candidateId: "skill-candidate-1",
        name: "home-camera-confirmation",
        targetAgent: "lab",
        sourceTaskId: "task-1",
        draftMarkdown: "# Home Camera Confirmation\n\nConfirm before recording.",
        evidence: [{ taskId: "task-1", eventType: "task.completed" }],
        qualityScore: 0.82,
        riskScore: 0.3,
      });

      expect(registry.getCandidate("skill-candidate-1")).toEqual({
        candidateId: "skill-candidate-1",
        name: "home-camera-confirmation",
        targetAgent: "lab",
        sourceTaskId: "task-1",
        status: "shadow",
        draftMarkdown: "# Home Camera Confirmation\n\nConfirm before recording.",
        evidence: [{ taskId: "task-1", eventType: "task.completed" }],
        qualityScore: 0.82,
        riskScore: 0.3,
      });
    } finally {
      db.close();
    }
  });

  it("promotes only sufficiently proven shadow candidates", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-2",
        name: "story-bunny-bedtime",
        targetAgent: "lab",
        sourceTaskId: "task-2",
        draftMarkdown: "# Story Bunny Bedtime\n\nUse the toy bridge.",
        evidence: [{ taskId: "task-2", eventType: "device.command_acknowledged" }],
        qualityScore: 0.91,
        riskScore: 0.2,
      });
      registry.createReplayRun({
        replayRunId: "replay-skill-candidate-2",
        candidateId: "skill-candidate-2",
        status: "passed",
        score: 0.9,
        notes: "Replay produced the expected toy bridge command.",
      });

      const skill = registry.promoteCandidate("skill-candidate-2", {
        skillId: "skill-story-bunny-bedtime",
        version: "0.1.0",
      });

      expect(skill).toEqual({
        skillId: "skill-story-bunny-bedtime",
        candidateId: "skill-candidate-2",
        name: "story-bunny-bedtime",
        targetAgent: "lab",
        version: "0.1.0",
        status: "active",
        markdown: "# Story Bunny Bedtime\n\nUse the toy bridge.",
      });
      expect(registry.getCandidate("skill-candidate-2")?.status).toBe("promoted");
    } finally {
      db.close();
    }
  });

  it("supports destructured registry methods without losing state", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      const { createCandidate, createReplayRun, promoteCandidate, getCandidate } =
        registry;

      createCandidate({
        candidateId: "skill-candidate-destructured",
        name: "destructured-skill",
        targetAgent: "lab",
        sourceTaskId: "task-destructured",
        draftMarkdown: "# Destructured Skill",
        evidence: [{ taskId: "task-destructured", eventType: "task.completed" }],
        qualityScore: 0.9,
        riskScore: 0.2,
      });
      createReplayRun({
        replayRunId: "replay-skill-candidate-destructured",
        candidateId: "skill-candidate-destructured",
        status: "passed",
        score: 0.9,
        notes: "Replay passed through destructured method usage.",
      });

      expect(
        promoteCandidate("skill-candidate-destructured", {
          skillId: "skill-destructured",
          version: "0.1.0",
        }),
      ).toMatchObject({
        skillId: "skill-destructured",
        status: "active",
      });
      expect(getCandidate("skill-candidate-destructured")?.status).toBe(
        "promoted",
      );
    } finally {
      db.close();
    }
  });

  it("rejects invalid candidate scores", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);

      expect(() =>
        registry.createCandidate({
          candidateId: "skill-candidate-invalid-score",
          name: "invalid-score",
          targetAgent: "lab",
          draftMarkdown: "# Invalid Score",
          evidence: [],
          qualityScore: 1.5,
          riskScore: 0.1,
        }),
      ).toThrow("Skill candidate scores must be between 0 and 1");
    } finally {
      db.close();
    }
  });

  it("stores replay runs for a skill candidate before promotion", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-replay",
        name: "replayable-skill",
        targetAgent: "lab",
        sourceTaskId: "task-replay",
        draftMarkdown: "# Replayable Skill",
        evidence: [{ taskId: "task-replay", eventType: "task.completed" }],
        qualityScore: 0.9,
        riskScore: 0.2,
      });

      registry.createReplayRun({
        replayRunId: "replay-run-1",
        candidateId: "skill-candidate-replay",
        status: "passed",
        score: 0.88,
        notes: "Replay matched the expected task trace.",
      });

      expect(registry.listReplayRuns("skill-candidate-replay")).toEqual([
        {
          replayRunId: "replay-run-1",
          candidateId: "skill-candidate-replay",
          status: "passed",
          score: 0.88,
          notes: "Replay matched the expected task trace.",
        },
      ]);
    } finally {
      db.close();
    }
  });

  it("refuses promotion until the candidate has a passing replay", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-no-replay",
        name: "no-replay-skill",
        targetAgent: "lab",
        sourceTaskId: "task-no-replay",
        draftMarkdown: "# No Replay Skill",
        evidence: [{ taskId: "task-no-replay", eventType: "task.completed" }],
        qualityScore: 0.95,
        riskScore: 0.1,
      });

      expect(() =>
        registry.promoteCandidate("skill-candidate-no-replay", {
          skillId: "skill-no-replay",
          version: "0.1.0",
        }),
      ).toThrow("Skill candidate requires a passing replay before promotion");

      registry.createReplayRun({
        replayRunId: "replay-run-failed",
        candidateId: "skill-candidate-no-replay",
        status: "failed",
        score: 0.91,
        notes: "Replay did not preserve the expected safety gate.",
      });

      expect(() =>
        registry.promoteCandidate("skill-candidate-no-replay", {
          skillId: "skill-no-replay",
          version: "0.1.0",
        }),
      ).toThrow("Skill candidate requires a passing replay before promotion");
    } finally {
      db.close();
    }
  });

  it("refuses to promote low-quality candidates", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-low",
        name: "weak-skill",
        targetAgent: "lab",
        sourceTaskId: "task-low",
        draftMarkdown: "# Weak Skill",
        evidence: [{ taskId: "task-low", eventType: "task.failed" }],
        qualityScore: 0.5,
        riskScore: 0.1,
      });

      expect(() =>
        registry.promoteCandidate("skill-candidate-low", {
          skillId: "skill-weak",
          version: "0.1.0",
        }),
      ).toThrow("Skill candidate quality is below promotion threshold");
    } finally {
      db.close();
    }
  });

  it("lists only active skills and allows deprecating promoted skills", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-deprecate",
        skillId: "skill-deprecate",
      });
      registry.promoteCandidate("skill-candidate-deprecate", {
        skillId: "skill-deprecate",
        version: "0.1.0",
      });

      expect(registry.listActiveSkills("lab")).toMatchObject([
        {
          skillId: "skill-deprecate",
          status: "active",
        },
      ]);

      registry.updateSkillStatus("skill-deprecate", "deprecated");

      expect(registry.getSkill("skill-deprecate")).toMatchObject({
        skillId: "skill-deprecate",
        status: "deprecated",
      });
      expect(registry.listActiveSkills("lab")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("treats blocked skills as terminally disabled", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-block",
        skillId: "skill-block",
      });
      registry.promoteCandidate("skill-candidate-block", {
        skillId: "skill-block",
        version: "0.1.0",
      });

      registry.updateSkillStatus("skill-block", "blocked");

      expect(registry.getSkill("skill-block")).toMatchObject({
        skillId: "skill-block",
        status: "blocked",
      });
      expect(registry.listActiveSkills("lab")).toEqual([]);
      expect(() =>
        registry.updateSkillStatus("skill-block", "deprecated"),
      ).toThrow("Blocked skills cannot transition to another status");
    } finally {
      db.close();
    }
  });

  it("rejects unsupported skill status updates at runtime", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-invalid-status",
        skillId: "skill-invalid-status",
      });
      registry.promoteCandidate("skill-candidate-invalid-status", {
        skillId: "skill-invalid-status",
        version: "0.1.0",
      });

      expect(() =>
        registry.updateSkillStatus(
          "skill-invalid-status",
          "active" as Parameters<typeof registry.updateSkillStatus>[1],
        ),
      ).toThrow("Unsupported skill status update: active");
    } finally {
      db.close();
    }
  });

  it("returns a review view with replay evidence and promotion blockers", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-review",
        name: "review-skill",
        targetAgent: "lab",
        sourceTaskId: "task-review",
        draftMarkdown: "# Review Skill",
        evidence: [{ taskId: "task-review", eventType: "task.failed" }],
        qualityScore: 0.79,
        riskScore: 0.8,
      });
      registry.createReplayRun({
        replayRunId: "replay-review-failed",
        candidateId: "skill-candidate-review",
        status: "failed",
        score: 0.9,
        notes: "Replay exposed unsafe behavior.",
      });

      expect(registry.getCandidateReview("skill-candidate-review")).toEqual({
        candidate: {
          candidateId: "skill-candidate-review",
          name: "review-skill",
          targetAgent: "lab",
          sourceTaskId: "task-review",
          status: "shadow",
          draftMarkdown: "# Review Skill",
          evidence: [{ taskId: "task-review", eventType: "task.failed" }],
          qualityScore: 0.79,
          riskScore: 0.8,
        },
        replayRuns: [
          {
            replayRunId: "replay-review-failed",
            candidateId: "skill-candidate-review",
            status: "failed",
            score: 0.9,
            notes: "Replay exposed unsafe behavior.",
          },
        ],
        ownerApproval: {
          required: false,
          status: "not_required",
          latest: undefined,
        },
        promotionEligibility: {
          canPromote: false,
          blockers: [
            "quality_below_threshold",
            "risk_above_threshold",
            "missing_passing_replay",
          ],
        },
      });
    } finally {
      db.close();
    }
  });

  it("marks a sufficiently proven shadow candidate as promotion eligible", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-review-ready",
        skillId: "skill-review-ready",
      });

      expect(
        registry.getCandidateReview("skill-candidate-review-ready")
          ?.promotionEligibility,
      ).toEqual({
        canPromote: true,
        blockers: [],
      });
    } finally {
      db.close();
    }
  });

  it("requires owner approval before promoting elevated-risk candidates", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-owner-approval",
        skillId: "skill-owner-approval",
        riskScore: 0.6,
      });

      expect(
        registry.getCandidateReview("skill-candidate-owner-approval"),
      ).toMatchObject({
        ownerApproval: {
          required: true,
          status: "pending",
        },
        promotionEligibility: {
          canPromote: false,
          blockers: ["owner_approval_required"],
        },
      });
      expect(() =>
        registry.promoteCandidate("skill-candidate-owner-approval", {
          skillId: "skill-owner-approval",
          version: "0.1.0",
        }),
      ).toThrow("Skill candidate requires owner approval before promotion");
    } finally {
      db.close();
    }
  });

  it("promotes elevated-risk candidates after owner approval", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-owner-approved",
        skillId: "skill-owner-approved",
        riskScore: 0.6,
      });

      registry.createOwnerApproval({
        approvalId: "approval-owner-approved",
        candidateId: "skill-candidate-owner-approved",
        reviewerIdentity: "telegram:456",
        decision: "approved",
        reason: "Owner reviewed the elevated-risk skill.",
      });

      expect(
        registry.getCandidateReview("skill-candidate-owner-approved"),
      ).toMatchObject({
        ownerApproval: {
          required: true,
          status: "approved",
          latest: {
            approvalId: "approval-owner-approved",
            reviewerIdentity: "telegram:456",
            decision: "approved",
          },
        },
        promotionEligibility: {
          canPromote: true,
          blockers: [],
        },
      });
      expect(
        registry.promoteCandidate("skill-candidate-owner-approved", {
          skillId: "skill-owner-approved",
          version: "0.1.0",
        }),
      ).toMatchObject({
        skillId: "skill-owner-approved",
        status: "active",
      });
    } finally {
      db.close();
    }
  });

  it("keeps rejected owner approvals as promotion blockers", () => {
    const db = openTestDb();

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      createPromotableCandidate(registry, {
        candidateId: "skill-candidate-owner-rejected",
        skillId: "skill-owner-rejected",
        riskScore: 0.6,
      });

      registry.createOwnerApproval({
        approvalId: "approval-owner-rejected",
        candidateId: "skill-candidate-owner-rejected",
        reviewerIdentity: "telegram:456",
        decision: "rejected",
        reason: "Too much device-control risk.",
      });

      expect(
        registry.getCandidateReview("skill-candidate-owner-rejected"),
      ).toMatchObject({
        ownerApproval: {
          required: true,
          status: "rejected",
        },
        promotionEligibility: {
          canPromote: false,
          blockers: ["owner_approval_rejected"],
        },
      });
      expect(() =>
        registry.promoteCandidate("skill-candidate-owner-rejected", {
          skillId: "skill-owner-rejected",
          version: "0.1.0",
        }),
      ).toThrow("Skill candidate owner approval was rejected");
    } finally {
      db.close();
    }
  });

  function openTestDb() {
    dir = mkdtempSync(join(tmpdir(), "openpeach-skill-registry-"));
    return openPeachDb(join(dir, "state.db"));
  }
});

function createPromotableCandidate(
  registry: ReturnType<typeof createSkillRegistry>,
  input: { candidateId: string; skillId: string; riskScore?: number },
): void {
  registry.createCandidate({
    candidateId: input.candidateId,
    name: input.skillId,
    targetAgent: "lab",
    sourceTaskId: `task-${input.skillId}`,
    draftMarkdown: `# ${input.skillId}`,
    evidence: [{ taskId: `task-${input.skillId}`, eventType: "task.completed" }],
    qualityScore: 0.9,
    riskScore: input.riskScore ?? 0.2,
  });
  registry.createReplayRun({
    replayRunId: `replay-${input.skillId}`,
    candidateId: input.candidateId,
    status: "passed",
    score: 0.9,
    notes: "Replay passed.",
  });
}
