import type { SkillCandidateReview } from "../../../packages/skill-registry/src/index.js";

export function formatSkillReviewForTelegram(
  review: SkillCandidateReview,
): string {
  const passedReplayCount = review.replayRuns.filter(
    (run) => run.status === "passed",
  ).length;
  const failedReplayCount = review.replayRuns.filter(
    (run) => run.status === "failed",
  ).length;
  const lines = [
    `Skill candidate: ${review.candidate.candidateId}`,
    `Name: ${review.candidate.name}`,
    `Target agent: ${review.candidate.targetAgent}`,
    `Status: ${review.candidate.status}`,
    `Quality/Risk: ${review.candidate.qualityScore.toFixed(2)} / ${review.candidate.riskScore.toFixed(2)}`,
    `Replay: ${passedReplayCount} passed, ${failedReplayCount} failed`,
    `Owner approval: ${formatOwnerApprovalStatus(review.ownerApproval.status)}`,
    `Promotion: ${review.promotionEligibility.canPromote ? "eligible" : "blocked"}`,
  ];

  if (review.promotionEligibility.blockers.length > 0) {
    lines.push(
      `Blockers: ${review.promotionEligibility.blockers.join(", ")}`,
    );
  }

  return lines.join("\n");
}

function formatOwnerApprovalStatus(status: string): string {
  return status.replaceAll("_", " ");
}
