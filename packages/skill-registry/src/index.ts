import type { OpenPeachDb } from "../../store-sqlite/src/index.js";

export type SkillCandidateStatus = "shadow" | "promoted" | "rejected";
export type SkillStatus = "active" | "deprecated" | "blocked";
export type SkillReplayStatus = "passed" | "failed";
export type SkillOwnerApprovalDecision = "approved" | "rejected";

export type SkillEvidence = {
  taskId: string;
  eventType: string;
};

export type SkillCandidateInput = {
  candidateId: string;
  name: string;
  targetAgent: "main" | "home" | "lab";
  sourceTaskId?: string;
  draftMarkdown: string;
  evidence: SkillEvidence[];
  qualityScore: number;
  riskScore: number;
};

export type SkillCandidate = SkillCandidateInput & {
  sourceTaskId: string | undefined;
  status: SkillCandidateStatus;
};

export type SkillRecord = {
  skillId: string;
  candidateId: string;
  name: string;
  targetAgent: "main" | "home" | "lab";
  version: string;
  status: SkillStatus;
  markdown: string;
};

export type SkillReplayRunInput = {
  replayRunId: string;
  candidateId: string;
  status: SkillReplayStatus;
  score: number;
  notes: string;
};

export type SkillReplayRun = SkillReplayRunInput;

export type SkillOwnerApprovalInput = {
  approvalId: string;
  candidateId: string;
  reviewerIdentity: string;
  decision: SkillOwnerApprovalDecision;
  reason: string;
};

export type SkillOwnerApproval = SkillOwnerApprovalInput;

export type SkillPromotionBlocker =
  | "candidate_not_shadow"
  | "quality_below_threshold"
  | "risk_above_threshold"
  | "missing_passing_replay"
  | "owner_approval_required"
  | "owner_approval_rejected";

export type SkillCandidateReview = {
  candidate: SkillCandidate;
  replayRuns: SkillReplayRun[];
  ownerApproval: {
    required: boolean;
    status: "not_required" | "pending" | "approved" | "rejected";
    latest?: SkillOwnerApproval;
  };
  promotionEligibility: {
    canPromote: boolean;
    blockers: SkillPromotionBlocker[];
  };
};

const OWNER_APPROVAL_RISK_THRESHOLD = 0.5;
const ABSOLUTE_RISK_THRESHOLD = 0.7;

export function createSkillRegistry(db: OpenPeachDb) {
  const insertCandidateStatement = db.prepare(`
    INSERT INTO skill_candidates (
      candidate_id,
      name,
      target_agent,
      source_task_id,
      status,
      draft_markdown,
      evidence_json,
      quality_score,
      risk_score,
      created_at_ms,
      updated_at_ms
    )
    VALUES (
      @candidateId,
      @name,
      @targetAgent,
      @sourceTaskId,
      'shadow',
      @draftMarkdown,
      @evidenceJson,
      @qualityScore,
      @riskScore,
      @nowMs,
      @nowMs
    )
  `);
  const getCandidateStatement = db.prepare(`
    SELECT
      candidate_id,
      name,
      target_agent,
      source_task_id,
      status,
      draft_markdown,
      evidence_json,
      quality_score,
      risk_score
    FROM skill_candidates
    WHERE candidate_id = ?
  `);
  const updateCandidateStatusStatement = db.prepare(`
    UPDATE skill_candidates
    SET status = @status,
        updated_at_ms = @nowMs
    WHERE candidate_id = @candidateId
  `);
  const insertSkillStatement = db.prepare(`
    INSERT INTO skills (
      skill_id,
      candidate_id,
      name,
      target_agent,
      version,
      status,
      markdown,
      created_at_ms,
      updated_at_ms
    )
    VALUES (
      @skillId,
      @candidateId,
      @name,
      @targetAgent,
      @version,
      'active',
      @markdown,
      @nowMs,
      @nowMs
    )
  `);
  const getSkillStatement = db.prepare(`
    SELECT
      skill_id,
      candidate_id,
      name,
      target_agent,
      version,
      status,
      markdown
    FROM skills
    WHERE skill_id = ?
  `);
  const listActiveSkillsStatement = db.prepare(`
    SELECT
      skill_id,
      candidate_id,
      name,
      target_agent,
      version,
      status,
      markdown
    FROM skills
    WHERE target_agent = ?
      AND status = 'active'
    ORDER BY created_at_ms, skill_id
  `);
  const updateSkillStatusStatement = db.prepare(`
    UPDATE skills
    SET status = @status,
        updated_at_ms = @nowMs
    WHERE skill_id = @skillId
  `);
  const insertReplayRunStatement = db.prepare(`
    INSERT INTO skill_replay_runs (
      replay_run_id,
      candidate_id,
      status,
      score,
      notes,
      created_at_ms
    )
    VALUES (
      @replayRunId,
      @candidateId,
      @status,
      @score,
      @notes,
      @nowMs
    )
  `);
  const listReplayRunsStatement = db.prepare(`
    SELECT
      replay_run_id,
      candidate_id,
      status,
      score,
      notes
    FROM skill_replay_runs
    WHERE candidate_id = ?
    ORDER BY created_at_ms, replay_run_id
  `);
  const getPassingReplayStatement = db.prepare(`
    SELECT replay_run_id
    FROM skill_replay_runs
    WHERE candidate_id = ?
      AND status = 'passed'
      AND score >= 0.8
    LIMIT 1
  `);
  const insertOwnerApprovalStatement = db.prepare(`
    INSERT INTO skill_owner_approvals (
      approval_id,
      candidate_id,
      reviewer_identity,
      decision,
      reason,
      created_at_ms
    )
    VALUES (
      @approvalId,
      @candidateId,
      @reviewerIdentity,
      @decision,
      @reason,
      @nowMs
    )
  `);
  const getLatestOwnerApprovalStatement = db.prepare(`
    SELECT
      approval_id,
      candidate_id,
      reviewer_identity,
      decision,
      reason
    FROM skill_owner_approvals
    WHERE candidate_id = ?
    ORDER BY created_at_ms DESC, approval_id DESC
    LIMIT 1
  `);

  function createCandidate(input: SkillCandidateInput): void {
    assertScoreRange(input.qualityScore);
    assertScoreRange(input.riskScore);
    insertCandidateStatement.run({
      ...input,
      sourceTaskId: input.sourceTaskId ?? null,
      evidenceJson: JSON.stringify(input.evidence),
      nowMs: Date.now(),
    });
  }

  function getCandidate(candidateId: string): SkillCandidate | undefined {
    const row = getCandidateStatement.get(candidateId) as
      | SkillCandidateRow
      | undefined;
    if (!row) {
      return undefined;
    }

    return toSkillCandidate(row);
  }

  function createReplayRun(input: SkillReplayRunInput): void {
    assertScoreRange(input.score);
    if (input.status !== "passed" && input.status !== "failed") {
      throw new Error(`Unsupported skill replay status: ${input.status}`);
    }
    if (!getCandidate(input.candidateId)) {
      throw new Error(`skill candidate not found: ${input.candidateId}`);
    }

    insertReplayRunStatement.run({
      ...input,
      nowMs: Date.now(),
    });
  }

  function listReplayRuns(candidateId: string): SkillReplayRun[] {
    return listReplayRunsStatement
      .all(candidateId)
      .map((row) => toSkillReplayRun(row as SkillReplayRunRow));
  }

  function createOwnerApproval(input: SkillOwnerApprovalInput): void {
    if (!isSupportedOwnerApprovalDecision(input.decision)) {
      throw new Error(`Unsupported owner approval decision: ${input.decision}`);
    }
    if (!getCandidate(input.candidateId)) {
      throw new Error(`skill candidate not found: ${input.candidateId}`);
    }

    insertOwnerApprovalStatement.run({
      ...input,
      nowMs: Date.now(),
    });
  }

  function getLatestOwnerApproval(
    candidateId: string,
  ): SkillOwnerApproval | undefined {
    const row = getLatestOwnerApprovalStatement.get(candidateId) as
      | SkillOwnerApprovalRow
      | undefined;
    return row ? toSkillOwnerApproval(row) : undefined;
  }

  function getCandidateReview(
    candidateId: string,
  ): SkillCandidateReview | undefined {
    const candidate = getCandidate(candidateId);
    if (!candidate) {
      return undefined;
    }
    const replayRuns = listReplayRuns(candidateId);
    const ownerApproval = evaluateOwnerApproval(
      candidate,
      getLatestOwnerApproval(candidateId),
    );

    return {
      candidate,
      replayRuns,
      ownerApproval,
      promotionEligibility: evaluatePromotionEligibility(
        candidate,
        replayRuns,
        ownerApproval,
      ),
    };
  }

  function getSkill(skillId: string): SkillRecord | undefined {
    const row = getSkillStatement.get(skillId) as SkillRow | undefined;
    if (!row) {
      return undefined;
    }

    return toSkillRecord(row);
  }

  function listActiveSkills(
    targetAgent: "main" | "home" | "lab",
  ): SkillRecord[] {
    return listActiveSkillsStatement
      .all(targetAgent)
      .map((row) => toSkillRecord(row as SkillRow));
  }

  function updateSkillStatus(
    skillId: string,
    status: Exclude<SkillStatus, "active">,
  ): void {
    if (!isSupportedSkillStatusUpdate(status)) {
      throw new Error(`Unsupported skill status update: ${status}`);
    }
    const skill = getSkill(skillId);
    if (!skill) {
      throw new Error(`skill not found: ${skillId}`);
    }
    if (skill.status === "blocked" && status !== "blocked") {
      throw new Error("Blocked skills cannot transition to another status");
    }
    if (skill.status === status) {
      return;
    }

    updateSkillStatusStatement.run({
      skillId,
      status,
      nowMs: Date.now(),
    });
  }

  function promoteCandidate(
    candidateId: string,
    input: { skillId: string; version: string },
  ): SkillRecord {
    const candidate = getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`skill candidate not found: ${candidateId}`);
    }
    const ownerApproval = evaluateOwnerApproval(
      candidate,
      getLatestOwnerApproval(candidateId),
    );
    const eligibility = evaluatePromotionEligibility(
      candidate,
      listReplayRuns(candidateId),
      ownerApproval,
    );
    if (eligibility.blockers.includes("candidate_not_shadow")) {
      throw new Error(`skill candidate is not in shadow status: ${candidateId}`);
    }
    if (eligibility.blockers.includes("quality_below_threshold")) {
      throw new Error("Skill candidate quality is below promotion threshold");
    }
    if (eligibility.blockers.includes("risk_above_threshold")) {
      throw new Error("Skill candidate risk is above promotion threshold");
    }
    if (eligibility.blockers.includes("missing_passing_replay")) {
      throw new Error("Skill candidate requires a passing replay before promotion");
    }
    if (eligibility.blockers.includes("owner_approval_required")) {
      throw new Error("Skill candidate requires owner approval before promotion");
    }
    if (eligibility.blockers.includes("owner_approval_rejected")) {
      throw new Error("Skill candidate owner approval was rejected");
    }

    const skill: SkillRecord = {
      skillId: input.skillId,
      candidateId,
      name: candidate.name,
      targetAgent: candidate.targetAgent,
      version: input.version,
      status: "active",
      markdown: candidate.draftMarkdown,
    };
    const nowMs = Date.now();
    const transaction = db.transaction(() => {
      insertSkillStatement.run({
        ...skill,
        nowMs,
      });
      updateCandidateStatusStatement.run({
        candidateId,
        status: "promoted",
        nowMs,
      });
    });
    transaction();

    return skill;
  }

  return {
    createCandidate,
    createOwnerApproval,
    createReplayRun,
    getCandidate,
    getCandidateReview,
    getSkill,
    listActiveSkills,
    listReplayRuns,
    promoteCandidate,
    updateSkillStatus,
  };
}

type SkillCandidateRow = {
  candidate_id: string;
  name: string;
  target_agent: "main" | "home" | "lab";
  source_task_id: string | null;
  status: SkillCandidateStatus;
  draft_markdown: string;
  evidence_json: string;
  quality_score: number;
  risk_score: number;
};

type SkillReplayRunRow = {
  replay_run_id: string;
  candidate_id: string;
  status: SkillReplayStatus;
  score: number;
  notes: string;
};

type SkillOwnerApprovalRow = {
  approval_id: string;
  candidate_id: string;
  reviewer_identity: string;
  decision: SkillOwnerApprovalDecision;
  reason: string;
};

type SkillRow = {
  skill_id: string;
  candidate_id: string;
  name: string;
  target_agent: "main" | "home" | "lab";
  version: string;
  status: SkillStatus;
  markdown: string;
};

function toSkillCandidate(row: SkillCandidateRow): SkillCandidate {
  return {
    candidateId: row.candidate_id,
    name: row.name,
    targetAgent: row.target_agent,
    sourceTaskId: row.source_task_id ?? undefined,
    status: row.status,
    draftMarkdown: row.draft_markdown,
    evidence: JSON.parse(row.evidence_json) as SkillEvidence[],
    qualityScore: row.quality_score,
    riskScore: row.risk_score,
  };
}

function toSkillReplayRun(row: SkillReplayRunRow): SkillReplayRun {
  return {
    replayRunId: row.replay_run_id,
    candidateId: row.candidate_id,
    status: row.status,
    score: row.score,
    notes: row.notes,
  };
}

function toSkillOwnerApproval(row: SkillOwnerApprovalRow): SkillOwnerApproval {
  return {
    approvalId: row.approval_id,
    candidateId: row.candidate_id,
    reviewerIdentity: row.reviewer_identity,
    decision: row.decision,
    reason: row.reason,
  };
}

function toSkillRecord(row: SkillRow): SkillRecord {
  return {
    skillId: row.skill_id,
    candidateId: row.candidate_id,
    name: row.name,
    targetAgent: row.target_agent,
    version: row.version,
    status: row.status,
    markdown: row.markdown,
  };
}

function evaluatePromotionEligibility(
  candidate: SkillCandidate,
  replayRuns: SkillReplayRun[],
  ownerApproval: SkillCandidateReview["ownerApproval"],
): SkillCandidateReview["promotionEligibility"] {
  const blockers: SkillPromotionBlocker[] = [];
  if (candidate.status !== "shadow") {
    blockers.push("candidate_not_shadow");
  }
  if (candidate.qualityScore < 0.8) {
    blockers.push("quality_below_threshold");
  }
  if (candidate.riskScore > ABSOLUTE_RISK_THRESHOLD) {
    blockers.push("risk_above_threshold");
  }
  if (
    !replayRuns.some((run) => run.status === "passed" && run.score >= 0.8)
  ) {
    blockers.push("missing_passing_replay");
  }
  if (ownerApproval.required && ownerApproval.status === "rejected") {
    blockers.push("owner_approval_rejected");
  } else if (ownerApproval.required && ownerApproval.status !== "approved") {
    blockers.push("owner_approval_required");
  }

  return {
    canPromote: blockers.length === 0,
    blockers,
  };
}

function evaluateOwnerApproval(
  candidate: SkillCandidate,
  latestApproval: SkillOwnerApproval | undefined,
): SkillCandidateReview["ownerApproval"] {
  const required =
    candidate.riskScore >= OWNER_APPROVAL_RISK_THRESHOLD &&
    candidate.riskScore <= ABSOLUTE_RISK_THRESHOLD;
  if (!required) {
    return {
      required: false,
      status: "not_required",
      latest: latestApproval,
    };
  }
  if (!latestApproval) {
    return {
      required: true,
      status: "pending",
    };
  }

  return {
    required: true,
    status: latestApproval.decision,
    latest: latestApproval,
  };
}

function assertScoreRange(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Skill candidate scores must be between 0 and 1");
  }
}

function isSupportedSkillStatusUpdate(
  status: string,
): status is Exclude<SkillStatus, "active"> {
  return status === "deprecated" || status === "blocked";
}

function isSupportedOwnerApprovalDecision(
  decision: string,
): decision is SkillOwnerApprovalDecision {
  return decision === "approved" || decision === "rejected";
}
