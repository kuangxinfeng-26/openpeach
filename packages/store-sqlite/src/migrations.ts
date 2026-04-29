import type { OpenPeachDb } from "./db.js";

export function migrate(db: OpenPeachDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      core_agent_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      message_id UNINDEXED,
      session_id UNINDEXED,
      text
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      source_session_id TEXT,
      target_agent TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      objective TEXT NOT NULL,
      packet_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT,
      session_id TEXT,
      payload_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbox (
      outbox_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_events (
      device_event_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT,
      session_id TEXT,
      payload_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_candidates (
      candidate_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_agent TEXT NOT NULL,
      source_task_id TEXT,
      status TEXT NOT NULL,
      draft_markdown TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      quality_score REAL NOT NULL,
      risk_score REAL NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      skill_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_agent TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES skill_candidates(candidate_id)
    );

    CREATE TABLE IF NOT EXISTS skill_replay_runs (
      replay_run_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      notes TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES skill_candidates(candidate_id)
    );

    CREATE TABLE IF NOT EXISTS skill_owner_approvals (
      approval_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      reviewer_identity TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES skill_candidates(candidate_id)
    );

    CREATE INDEX IF NOT EXISTS idx_skill_owner_approvals_candidate
      ON skill_owner_approvals(candidate_id, created_at_ms);
  `);

  const taskColumns = db.prepare("PRAGMA table_info(tasks)").all() as Array<{
    name: string;
  }>;
  if (!taskColumns.some((column) => column.name === "packet_json")) {
    db.exec("ALTER TABLE tasks ADD COLUMN packet_json TEXT");
  }
}
