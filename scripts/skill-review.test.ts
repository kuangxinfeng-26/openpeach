import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillRegistry } from "../packages/skill-registry/src/index.js";
import { migrate, openPeachDb } from "../packages/store-sqlite/src/index.js";
import {
  formatSkillCandidateReviewJson,
  reviewSkillCandidate,
  runSkillReviewCli,
} from "./skill-review.js";

describe("skill review CLI", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("formats a skill candidate review as stable JSON", () => {
    const dbPath = seedReviewCandidate();

    expect(
      formatSkillCandidateReviewJson(
        reviewSkillCandidate({
          dbPath,
          candidateId: "skill-candidate-cli",
        }),
      ),
    ).toBe(
      [
        "{",
        '  "candidate": {',
        '    "candidateId": "skill-candidate-cli",',
        '    "name": "cli-review-skill",',
        '    "targetAgent": "lab",',
        '    "sourceTaskId": "task-cli",',
        '    "status": "shadow",',
        '    "draftMarkdown": "# CLI Review Skill",',
        '    "evidence": [',
        "      {",
        '        "taskId": "task-cli",',
        '        "eventType": "task.completed"',
        "      }",
        "    ],",
        '    "qualityScore": 0.9,',
        '    "riskScore": 0.2',
        "  },",
        '  "replayRuns": [',
        "    {",
        '      "replayRunId": "replay-cli",',
        '      "candidateId": "skill-candidate-cli",',
        '      "status": "passed",',
        '      "score": 0.9,',
        '      "notes": "Replay passed."',
        "    }",
        "  ],",
        '  "ownerApproval": {',
        '    "required": false,',
        '    "status": "not_required"',
        "  },",
        '  "promotionEligibility": {',
        '    "canPromote": true,',
        '    "blockers": []',
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("returns exit code 2 when the candidate is missing", () => {
    const dbPath = seedReviewCandidate();
    const stderr: string[] = [];

    expect(
      runSkillReviewCli({
        argv: ["missing-candidate"],
        env: { TAOQIBAO_STATE_DB: dbPath },
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(2);
    expect(stderr.join("\n")).toContain(
      "Skill candidate not found: missing-candidate",
    );
  });

  it("returns exit code 1 when required arguments are missing", () => {
    const stderr: string[] = [];

    expect(
      runSkillReviewCli({
        argv: [],
        env: {},
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(1);
    expect(stderr.join("\n")).toContain(
      "Usage: npm run skill:review -- <candidate_id>",
    );
  });

  it("returns exit code 1 for unknown options without throwing", () => {
    const stderr: string[] = [];

    expect(
      runSkillReviewCli({
        argv: ["--unknown"],
        env: {},
        stdout() {},
        stderr(message) {
          stderr.push(message);
        },
      }),
    ).toBe(1);
    expect(stderr.join("\n")).toContain("Unknown option: --unknown");
  });

  function seedReviewCandidate(): string {
    dir = mkdtempSync(join(tmpdir(), "openpeach-skill-review-cli-"));
    const dbPath = join(dir, "state.db");
    const db = openPeachDb(dbPath);

    try {
      migrate(db);
      const registry = createSkillRegistry(db);
      registry.createCandidate({
        candidateId: "skill-candidate-cli",
        name: "cli-review-skill",
        targetAgent: "lab",
        sourceTaskId: "task-cli",
        draftMarkdown: "# CLI Review Skill",
        evidence: [{ taskId: "task-cli", eventType: "task.completed" }],
        qualityScore: 0.9,
        riskScore: 0.2,
      });
      registry.createReplayRun({
        replayRunId: "replay-cli",
        candidateId: "skill-candidate-cli",
        status: "passed",
        score: 0.9,
        notes: "Replay passed.",
      });
    } finally {
      db.close();
    }

    return dbPath;
  }
});
