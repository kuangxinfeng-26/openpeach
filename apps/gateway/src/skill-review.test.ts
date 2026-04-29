import { describe, expect, it } from "vitest";
import type { SkillCandidateReview } from "../../../packages/skill-registry/src/index.js";
import { formatSkillReviewForTelegram } from "./skill-review.js";

describe("formatSkillReviewForTelegram", () => {
  it("formats promotion-ready reviews as concise Telegram text", () => {
    expect(formatSkillReviewForTelegram(createReview({ canPromote: true }))).toBe(
      [
        "Skill candidate: skill-candidate-ready",
        "Name: bedtime-story",
        "Target agent: lab",
        "Status: shadow",
        "Quality/Risk: 0.91 / 0.20",
        "Replay: 1 passed, 0 failed",
        "Owner approval: not required",
        "Promotion: eligible",
      ].join("\n"),
    );
  });

  it("includes blockers for non-promotable reviews", () => {
    expect(
      formatSkillReviewForTelegram(
        createReview({
          canPromote: false,
          blockers: ["risk_above_threshold", "missing_passing_replay"],
        }),
      ),
    ).toContain("Blockers: risk_above_threshold, missing_passing_replay");
  });

  it("includes owner approval state for elevated-risk reviews", () => {
    expect(
      formatSkillReviewForTelegram(
        createReview({
          canPromote: false,
          blockers: ["owner_approval_required"],
          ownerApproval: {
            required: true,
            status: "pending",
          },
        }),
      ),
    ).toContain("Owner approval: pending");
  });
});

function createReview(input: {
  canPromote: boolean;
  blockers?: SkillCandidateReview["promotionEligibility"]["blockers"];
  ownerApproval?: SkillCandidateReview["ownerApproval"];
}): SkillCandidateReview {
  return {
    candidate: {
      candidateId: "skill-candidate-ready",
      name: "bedtime-story",
      targetAgent: "lab",
      sourceTaskId: "task-1",
      status: "shadow",
      draftMarkdown: "# Bedtime Story",
      evidence: [{ taskId: "task-1", eventType: "task.completed" }],
      qualityScore: 0.91,
      riskScore: 0.2,
    },
    replayRuns: [
      {
        replayRunId: "replay-1",
        candidateId: "skill-candidate-ready",
        status: "passed",
        score: 0.9,
        notes: "Replay passed.",
      },
    ],
    ownerApproval: input.ownerApproval ?? {
      required: false,
      status: "not_required",
    },
    promotionEligibility: {
      canPromote: input.canPromote,
      blockers: input.blockers ?? [],
    },
  };
}
