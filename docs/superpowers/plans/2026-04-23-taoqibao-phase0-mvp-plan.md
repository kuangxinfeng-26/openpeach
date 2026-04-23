# Taoqibao Phase 0 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Linux + npm deployable Taoqibao MVP: Telegram private chat -> `main` agent -> SQLite session persistence/search -> typed task execution -> external NLP reply.

**Architecture:** Phase 0 keeps the runtime deliberately small. A Telegram ingress adapter normalizes messages into `HumanEnvelope`, identity/session modules bind them to a logical session, the task engine creates a typed `TaskPacket`, `main` calls an external NLP adapter, and SQLite stores sessions, messages, tasks, events, and outbox records. This follows the already agreed Route C: OpenClaw-style external boundaries, Hermes-style unified SQLite/FTS state, and claw-code-style typed task packets/events.

**Tech Stack:** Linux target, Node.js 22+, TypeScript ESM, npm workspaces, Vitest, `tsx`, `zod`, `better-sqlite3`, `grammy`, `undici`, `dotenv`.

---

## Source Alignment

This plan is based on `docs/taoqibao-design-v2.md`, especially section 22.1. It intentionally limits Phase 0 to:

- Telegram private chat only.
- `main` agent only.
- Unified SQLite state database with FTS5.
- Logical session key + transcript/message artifacts.
- Minimal `TaskPacket`, admission controller, task registry, and event bus.
- External NLP model adapter.
- npm-based install/start flow for Linux.

This plan intentionally defers:

- Personal WeChat channel.
- `home` full device control.
- `lab` full skill evolution.
- Family multi-member UI and cross-platform identity binding.
- Camera, smart light, Home Assistant, MQTT, AI toy live adapters.
- Local ASR/TTS.
- Full web console.

## File Structure

Create this repository shape:

```text
package.json
package-lock.json
tsconfig.base.json
vitest.config.ts
.env.example
.gitignore
README.md
docs/phase0-runbook.md
deploy/systemd/taoqibao.service
apps/gateway/package.json
apps/gateway/src/index.ts
apps/gateway/src/config.ts
apps/gateway/src/doctor.ts
apps/gateway/src/pipeline.ts
apps/gateway/src/pipeline.test.ts
packages/envelope/package.json
packages/envelope/src/index.ts
packages/envelope/src/human-envelope.ts
packages/envelope/src/telegram-normalizer.ts
packages/envelope/src/telegram-normalizer.test.ts
packages/identity/package.json
packages/identity/src/index.ts
packages/identity/src/identity.ts
packages/identity/src/identity.test.ts
packages/store-sqlite/package.json
packages/store-sqlite/src/index.ts
packages/store-sqlite/src/db.ts
packages/store-sqlite/src/migrations.ts
packages/store-sqlite/src/repositories.ts
packages/store-sqlite/src/repositories.test.ts
packages/session-kernel/package.json
packages/session-kernel/src/index.ts
packages/session-kernel/src/session-key.ts
packages/session-kernel/src/session-service.ts
packages/session-kernel/src/session-search.ts
packages/session-kernel/src/session-kernel.test.ts
packages/event-bus/package.json
packages/event-bus/src/index.ts
packages/event-bus/src/events.ts
packages/event-bus/src/event-bus.test.ts
packages/task-engine/package.json
packages/task-engine/src/index.ts
packages/task-engine/src/task-packet.ts
packages/task-engine/src/admission.ts
packages/task-engine/src/task-registry.ts
packages/task-engine/src/task-engine.test.ts
packages/model-adapters/package.json
packages/model-adapters/src/index.ts
packages/model-adapters/src/external-chat.ts
packages/model-adapters/src/external-chat.test.ts
packages/runtime/package.json
packages/runtime/src/index.ts
packages/runtime/src/main-agent.ts
packages/runtime/src/main-agent.test.ts
packages/channel-telegram/package.json
packages/channel-telegram/src/index.ts
packages/channel-telegram/src/telegram-adapter.ts
packages/channel-telegram/src/telegram-adapter.test.ts
scripts/check-phase0.mjs
```

Responsibility boundaries:

- `apps/gateway`: composition root, env loading, process startup, pipeline assembly, doctor command.
- `packages/envelope`: platform-neutral `HumanEnvelope` and Telegram-specific normalization.
- `packages/identity`: allowlist, channel identity, requester role, minimal Phase 0 policy.
- `packages/store-sqlite`: SQLite connection, migrations, repositories, FTS5.
- `packages/session-kernel`: logical session key, session context, explicit session search.
- `packages/event-bus`: typed runtime events and persistence bridge.
- `packages/task-engine`: `TaskPacket`, admission decision, task lifecycle state.
- `packages/model-adapters`: external NLP chat completion adapter.
- `packages/runtime`: `main` agent behavior and turn execution.
- `packages/channel-telegram`: Telegram polling/send adapter.

## Environment Contract

Use these environment variables:

```bash
TAOQIBAO_STATE_DB="$HOME/.taoqibao/state.db"
TAOQIBAO_FAMILY_ID="main"
TAOQIBAO_CORE_AGENT_ID="main"
TAOQIBAO_OWNER_TELEGRAM_USER_IDS="123456789"
TELEGRAM_BOT_TOKEN="000000:replace-me"
TAOQIBAO_MODEL_BASE_URL="https://api.example.com/v1"
TAOQIBAO_MODEL_API_KEY="replace-me"
TAOQIBAO_MODEL_NAME="replace-me"
TAOQIBAO_MODEL_TIMEOUT_MS="30000"
TAOQIBAO_LOG_LEVEL="info"
```

Rules:

- Never commit real API keys or bot tokens.
- Phase 0 treats users not in `TAOQIBAO_OWNER_TELEGRAM_USER_IDS` as denied.
- Phase 0 uses only Telegram private chats.
- Phase 0 session scene is `default`, thread is `dm`.

## Task 1: Bootstrap npm Workspace

**Files:**

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `README.md`
- Create: each workspace `package.json`

- [ ] **Step 1: Write the root package manifest**

Create `package.json`:

```json
{
  "name": "taoqibao",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0",
    "npm": ">=10.0.0"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "tsc -b",
    "check": "tsc -b --pretty false",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx apps/gateway/src/index.ts",
    "start": "node apps/gateway/dist/index.js",
    "doctor": "tsx apps/gateway/src/doctor.ts",
    "phase0:check": "node scripts/check-phase0.mjs"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "grammy": "^1.34.0",
    "undici": "^7.3.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": ".",
    "outDir": "dist",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Add test config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Add workspace package manifests**

Each package should use this pattern, replacing name/path:

```json
{
  "name": "@taoqibao/envelope",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/packages/envelope/src/index.js",
  "types": "dist/packages/envelope/src/index.d.ts"
}
```

`apps/gateway/package.json` should be:

```json
{
  "name": "@taoqibao/gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and no pnpm/yarn lockfile is introduced.

- [ ] **Step 6: Run baseline checks**

Run:

```bash
npm run check
npm test
```

Expected: `check` may initially fail until source files exist; `test` should pass after test files are added in later tasks.

- [ ] **Step 7: Commit**

If this directory is not yet a git repo, initialize it first:

```bash
git init
git add .
git commit -m "chore: bootstrap taoqibao npm workspace"
```

## Task 2: Define HumanEnvelope and Telegram Normalizer

**Files:**

- Create: `packages/envelope/src/index.ts`
- Create: `packages/envelope/src/human-envelope.ts`
- Create: `packages/envelope/src/telegram-normalizer.ts`
- Create: `packages/envelope/src/telegram-normalizer.test.ts`

- [ ] **Step 1: Write failing envelope tests**

Create `packages/envelope/src/telegram-normalizer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeTelegramMessage } from "./telegram-normalizer.js";

describe("normalizeTelegramMessage", () => {
  it("normalizes a Telegram private text message into HumanEnvelope", () => {
    const envelope = normalizeTelegramMessage({
      botAccountId: "bot-main",
      message: {
        message_id: 10,
        date: 1710000000,
        chat: { id: 123, type: "private" },
        from: { id: 456, is_bot: false, first_name: "Owner" },
        text: "你好，淘气包",
      },
    });

    expect(envelope).toMatchObject({
      channel: "telegram",
      accountId: "bot-main",
      chatType: "private",
      peerId: "456",
      text: "你好，淘气包",
      messageId: "10",
    });
  });

  it("rejects non-text messages in Phase 0", () => {
    expect(() =>
      normalizeTelegramMessage({
        botAccountId: "bot-main",
        message: {
          message_id: 11,
          date: 1710000001,
          chat: { id: 123, type: "private" },
          from: { id: 456, is_bot: false, first_name: "Owner" },
        },
      }),
    ).toThrow(/text/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/envelope/src/telegram-normalizer.test.ts
```

Expected: FAIL because implementation files do not exist.

- [ ] **Step 3: Implement envelope schema**

Create `packages/envelope/src/human-envelope.ts`:

```ts
import { z } from "zod";

export const HumanEnvelopeSchema = z.object({
  id: z.string(),
  channel: z.literal("telegram"),
  accountId: z.string(),
  chatType: z.enum(["private", "group", "supergroup", "channel"]),
  peerId: z.string(),
  chatId: z.string(),
  threadId: z.string().optional(),
  messageId: z.string(),
  text: z.string().min(1),
  timestampMs: z.number().int().positive(),
  raw: z.unknown(),
});

export type HumanEnvelope = z.infer<typeof HumanEnvelopeSchema>;
```

- [ ] **Step 4: Implement Telegram normalizer**

Create `packages/envelope/src/telegram-normalizer.ts`:

```ts
import { HumanEnvelopeSchema, type HumanEnvelope } from "./human-envelope.js";

type TelegramLikeMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
  from?: { id: number; is_bot: boolean; first_name?: string };
  text?: string;
  message_thread_id?: number;
};

export function normalizeTelegramMessage(input: {
  botAccountId: string;
  message: TelegramLikeMessage;
}): HumanEnvelope {
  const { botAccountId, message } = input;
  if (!message.text || message.text.trim().length === 0) {
    throw new Error("Phase 0 only supports Telegram text messages");
  }
  const peerId = message.from?.id ?? message.chat.id;
  return HumanEnvelopeSchema.parse({
    id: `telegram:${botAccountId}:${message.chat.id}:${message.message_id}`,
    channel: "telegram",
    accountId: botAccountId,
    chatType: message.chat.type,
    peerId: String(peerId),
    chatId: String(message.chat.id),
    threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
    messageId: String(message.message_id),
    text: message.text.trim(),
    timestampMs: message.date * 1000,
    raw: message,
  });
}
```

- [ ] **Step 5: Export package API**

Create `packages/envelope/src/index.ts`:

```ts
export * from "./human-envelope.js";
export * from "./telegram-normalizer.js";
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run packages/envelope/src/telegram-normalizer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/envelope
git commit -m "feat: add phase0 human envelope"
```

## Task 3: Add Identity and Phase 0 Access Policy

**Files:**

- Create: `packages/identity/src/index.ts`
- Create: `packages/identity/src/identity.ts`
- Create: `packages/identity/src/identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Create `packages/identity/src/identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity.js";

const envelope = {
  channel: "telegram" as const,
  accountId: "bot-main",
  chatType: "private" as const,
  peerId: "456",
  chatId: "456",
};

describe("resolveIdentity", () => {
  it("resolves owner Telegram user", () => {
    const identity = resolveIdentity(envelope, {
      ownerTelegramUserIds: ["456"],
      familyId: "main",
    });

    expect(identity).toMatchObject({
      allowed: true,
      role: "owner",
      personId: "person:telegram:456",
      familyId: "main",
    });
  });

  it("denies unknown Telegram users in Phase 0", () => {
    const identity = resolveIdentity(envelope, {
      ownerTelegramUserIds: ["999"],
      familyId: "main",
    });

    expect(identity.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/identity/src/identity.test.ts
```

Expected: FAIL because `resolveIdentity` is missing.

- [ ] **Step 3: Implement identity resolver**

Create `packages/identity/src/identity.ts`:

```ts
type MinimalEnvelope = {
  channel: "telegram";
  accountId: string;
  chatType: string;
  peerId: string;
  chatId: string;
};

export type ResolvedIdentity = {
  allowed: boolean;
  channelIdentityId: string;
  personId?: string;
  familyId: string;
  role: "owner" | "unknown";
  reason?: string;
};

export function resolveIdentity(
  envelope: MinimalEnvelope,
  config: { ownerTelegramUserIds: string[]; familyId: string },
): ResolvedIdentity {
  const channelIdentityId = `${envelope.channel}:${envelope.accountId}:${envelope.peerId}`;
  if (envelope.chatType !== "private") {
    return {
      allowed: false,
      channelIdentityId,
      familyId: config.familyId,
      role: "unknown",
      reason: "Phase 0 only supports Telegram private chats",
    };
  }
  if (!config.ownerTelegramUserIds.includes(envelope.peerId)) {
    return {
      allowed: false,
      channelIdentityId,
      familyId: config.familyId,
      role: "unknown",
      reason: "Telegram user is not allowlisted",
    };
  }
  return {
    allowed: true,
    channelIdentityId,
    personId: `person:telegram:${envelope.peerId}`,
    familyId: config.familyId,
    role: "owner",
  };
}
```

- [ ] **Step 4: Export package API**

Create `packages/identity/src/index.ts`:

```ts
export * from "./identity.js";
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run packages/identity/src/identity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identity
git commit -m "feat: add phase0 identity policy"
```

## Task 4: Add SQLite Store and FTS5 Schema

**Files:**

- Create: `packages/store-sqlite/src/index.ts`
- Create: `packages/store-sqlite/src/db.ts`
- Create: `packages/store-sqlite/src/migrations.ts`
- Create: `packages/store-sqlite/src/repositories.ts`
- Create: `packages/store-sqlite/src/repositories.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `packages/store-sqlite/src/repositories.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTaoqibaoDb } from "./db.js";
import { migrate } from "./migrations.js";
import { createRepositories } from "./repositories.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taoqibao-store-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SQLite repositories", () => {
  it("persists messages and returns FTS search results", () => {
    const db = openTaoqibaoDb(join(dir, "state.db"));
    migrate(db);
    const repo = createRepositories(db);

    repo.upsertSession({
      sessionId: "session-1",
      sessionKey: "family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm",
      familyId: "main",
      coreAgentId: "main",
    });
    repo.appendMessage({
      messageId: "message-1",
      sessionId: "session-1",
      role: "user",
      text: "客厅灯测试",
      timestampMs: Date.now(),
    });

    expect(repo.searchMessages("客厅灯")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/store-sqlite/src/repositories.test.ts
```

Expected: FAIL because store modules are missing.

- [ ] **Step 3: Implement database opener**

Create `packages/store-sqlite/src/db.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type TaoqibaoDb = Database.Database;

export function openTaoqibaoDb(path: string): TaoqibaoDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
```

- [ ] **Step 4: Implement migrations**

Create `packages/store-sqlite/src/migrations.ts` with tables:

```ts
import type { TaoqibaoDb } from "./db.js";

export function migrate(db: TaoqibaoDb): void {
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
      session_id TEXT NOT NULL REFERENCES sessions(session_id),
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts
    USING fts5(message_id UNINDEXED, session_id UNINDEXED, text);

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      source_session_id TEXT NOT NULL,
      target_agent TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      objective TEXT NOT NULL,
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
  `);
}
```

- [ ] **Step 5: Implement repositories**

Create `packages/store-sqlite/src/repositories.ts` with:

```ts
import type { TaoqibaoDb } from "./db.js";

export function createRepositories(db: TaoqibaoDb) {
  return {
    upsertSession(input: {
      sessionId: string;
      sessionKey: string;
      familyId: string;
      coreAgentId: string;
    }) {
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (session_id, session_key, family_id, core_agent_id, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET updated_at_ms = excluded.updated_at_ms
      `).run(input.sessionId, input.sessionKey, input.familyId, input.coreAgentId, now, now);
    },

    appendMessage(input: {
      messageId: string;
      sessionId: string;
      role: "user" | "assistant" | "tool" | "system";
      text: string;
      timestampMs: number;
    }) {
      db.prepare(`
        INSERT INTO session_messages (message_id, session_id, role, text, timestamp_ms)
        VALUES (?, ?, ?, ?, ?)
      `).run(input.messageId, input.sessionId, input.role, input.text, input.timestampMs);
      db.prepare(`
        INSERT INTO session_messages_fts (message_id, session_id, text)
        VALUES (?, ?, ?)
      `).run(input.messageId, input.sessionId, input.text);
    },

    searchMessages(query: string): Array<{ messageId: string; sessionId: string; text: string }> {
      return db.prepare(`
        SELECT message_id AS messageId, session_id AS sessionId, text
        FROM session_messages_fts
        WHERE session_messages_fts MATCH ?
        LIMIT 20
      `).all(query) as Array<{ messageId: string; sessionId: string; text: string }>;
    },
  };
}
```

- [ ] **Step 6: Export package API**

Create `packages/store-sqlite/src/index.ts`:

```ts
export * from "./db.js";
export * from "./migrations.js";
export * from "./repositories.js";
```

- [ ] **Step 7: Run store tests**

Run:

```bash
npx vitest run packages/store-sqlite/src/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/store-sqlite
git commit -m "feat: add sqlite state store"
```

## Task 5: Add Session Kernel and Search

**Files:**

- Create: `packages/session-kernel/src/index.ts`
- Create: `packages/session-kernel/src/session-key.ts`
- Create: `packages/session-kernel/src/session-service.ts`
- Create: `packages/session-kernel/src/session-search.ts`
- Create: `packages/session-kernel/src/session-kernel.test.ts`

- [ ] **Step 1: Write failing session tests**

Create tests that verify:

```ts
expect(
  buildSessionKey({
    familyId: "main",
    coreAgentId: "main",
    channel: "telegram",
    accountId: "bot-main",
    peerId: "456",
    scene: "default",
    threadId: "dm",
  }),
).toBe("family:main/agent:main/channel:telegram/account:bot-main/peer:456/scene:default/thread:dm");
```

Also test that `getOrCreateSession` returns the same `sessionId` for the same key.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/session-kernel/src/session-kernel.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `buildSessionKey`**

Create `packages/session-kernel/src/session-key.ts`:

```ts
export function buildSessionKey(input: {
  familyId: string;
  coreAgentId: string;
  channel: string;
  accountId: string;
  peerId: string;
  scene?: string;
  threadId?: string;
}): string {
  return [
    `family:${input.familyId}`,
    `agent:${input.coreAgentId}`,
    `channel:${input.channel}`,
    `account:${input.accountId}`,
    `peer:${input.peerId}`,
    `scene:${input.scene ?? "default"}`,
    `thread:${input.threadId ?? "dm"}`,
  ].join("/");
}
```

- [ ] **Step 4: Implement session service**

`session-service.ts` should create deterministic `sessionId` from a stable hash of `sessionKey`, upsert it through the store, and return:

```ts
export type SessionContext = {
  sessionId: string;
  sessionKey: string;
  familyId: string;
  coreAgentId: "main";
};
```

- [ ] **Step 5: Implement session search wrapper**

`session-search.ts` should call `repo.searchMessages(query)` and return a small summary object:

```ts
export type SessionSearchResult = {
  messageId: string;
  sessionId: string;
  snippet: string;
};
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run packages/session-kernel/src/session-kernel.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/session-kernel
git commit -m "feat: add logical session kernel"
```

## Task 6: Add Typed Event Bus and Outbox Contract

**Files:**

- Create: `packages/event-bus/src/index.ts`
- Create: `packages/event-bus/src/events.ts`
- Create: `packages/event-bus/src/event-bus.test.ts`
- Modify: `packages/store-sqlite/src/repositories.ts`

- [ ] **Step 1: Write failing event tests**

Test that a `task.created` event is persisted with a typed payload. Test that inserting the same outbox `idempotency_key` twice does not create duplicate outbound messages.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/event-bus/src/event-bus.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement event types**

Create `events.ts`:

```ts
export type TaoqibaoEvent =
  | { type: "message.received"; sessionId: string; payload: { envelopeId: string } }
  | { type: "task.created"; sessionId: string; taskId: string; payload: { objective: string } }
  | { type: "task.completed"; sessionId: string; taskId: string; payload: { status: "succeeded" } }
  | { type: "task.failed"; sessionId: string; taskId: string; payload: { reason: string } }
  | { type: "reply.queued"; sessionId: string; taskId: string; payload: { outboxId: string } };
```

- [ ] **Step 4: Implement persistence helpers**

Add repository methods:

```ts
insertEvent(input: {
  eventId: string;
  eventType: string;
  taskId?: string;
  sessionId?: string;
  payloadJson: string;
  createdAtMs: number;
}): void

insertOutboxOnce(input: {
  outboxId: string;
  idempotencyKey: string;
  channel: string;
  targetRef: string;
  payloadJson: string;
}): void
```

`insertOutboxOnce` must use `INSERT OR IGNORE` on `idempotency_key`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run packages/event-bus/src/event-bus.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/event-bus packages/store-sqlite
git commit -m "feat: add typed event bus and outbox"
```

## Task 7: Add TaskPacket, Admission Controller, and Task Registry

**Files:**

- Create: `packages/task-engine/src/index.ts`
- Create: `packages/task-engine/src/task-packet.ts`
- Create: `packages/task-engine/src/admission.ts`
- Create: `packages/task-engine/src/task-registry.ts`
- Create: `packages/task-engine/src/task-engine.test.ts`
- Modify: `packages/store-sqlite/src/repositories.ts`

- [ ] **Step 1: Write failing task engine tests**

Test:

```ts
expect(
  admitTask({
    text: "你好",
    sessionId: "session-1",
    requesterIdentity: { role: "owner" },
  }).executionMode,
).toBe("turn");
```

Also test status progression:

```ts
created -> admitted -> running -> succeeded
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/task-engine/src/task-engine.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement TaskPacket schema**

Create `task-packet.ts`:

```ts
import { z } from "zod";

export const TaskPacketSchema = z.object({
  taskId: z.string(),
  objective: z.string().min(1),
  scopeKind: z.enum(["conversation", "device", "project", "family", "custom"]),
  scopeRef: z.string(),
  sourceSessionId: z.string(),
  requesterIdentityId: z.string(),
  targetAgent: z.literal("main"),
  priority: z.literal("P0"),
  executionMode: z.enum(["turn", "microtask", "job", "flow"]),
  acceptanceContract: z.string(),
  reportingContract: z.string(),
  escalationPolicy: z.string(),
  resourceLocks: z.array(z.string()),
  budget: z.object({
    runtimeMs: z.number().int().positive(),
    toolCalls: z.number().int().nonnegative(),
    childTasks: z.number().int().nonnegative(),
  }),
  memoryPolicy: z.enum(["session_only", "candidate_memory", "promote_if_verified"]),
});

export type TaskPacket = z.infer<typeof TaskPacketSchema>;
```

- [ ] **Step 4: Implement admission controller**

Phase 0 admission rules:

- Allowed private Telegram text -> `turn`, `P0`, `targetAgent: "main"`.
- Unknown or denied identity -> no model task; return denied decision.
- No `microtask`, `job`, or `flow` fan-out in Phase 0 except internal type support.

- [ ] **Step 5: Implement task registry**

Add repository methods:

```ts
createTask(packet: TaskPacket, status: "created" | "admitted"): void
updateTaskStatus(taskId: string, status: "running" | "succeeded" | "failed"): void
getTask(taskId: string): { taskId: string; status: string } | undefined
```

- [ ] **Step 6: Run tests**

Run:

```bash
npx vitest run packages/task-engine/src/task-engine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/task-engine packages/store-sqlite
git commit -m "feat: add typed task execution core"
```

## Task 8: Add External NLP Model Adapter

**Files:**

- Create: `packages/model-adapters/src/index.ts`
- Create: `packages/model-adapters/src/external-chat.ts`
- Create: `packages/model-adapters/src/external-chat.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Use an injected fake `fetch`:

```ts
const client = new ExternalChatClient({
  baseUrl: "https://model.test/v1",
  apiKey: "test-key",
  model: "test-model",
  fetch: async () =>
    new Response(JSON.stringify({
      choices: [{ message: { content: "你好，我是淘气包" } }],
    })),
});

await expect(client.complete([{ role: "user", content: "你好" }]))
  .resolves.toBe("你好，我是淘气包");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/model-adapters/src/external-chat.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement OpenAI-compatible adapter**

`external-chat.ts` should call:

```text
POST {TAOQIBAO_MODEL_BASE_URL}/chat/completions
Authorization: Bearer {TAOQIBAO_MODEL_API_KEY}
```

Payload:

```json
{
  "model": "TAOQIBAO_MODEL_NAME",
  "messages": []
}
```

Rules:

- Do not log API keys.
- Throw a sanitized error if HTTP status is not 2xx.
- Respect `TAOQIBAO_MODEL_TIMEOUT_MS`.
- Return trimmed assistant content.

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run packages/model-adapters/src/external-chat.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/model-adapters
git commit -m "feat: add external nlp adapter"
```

## Task 9: Add Main Agent Runtime

**Files:**

- Create: `packages/runtime/src/index.ts`
- Create: `packages/runtime/src/main-agent.ts`
- Create: `packages/runtime/src/main-agent.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Test that `main`:

- Writes user message to session.
- Creates a task.
- Calls model adapter.
- Writes assistant message.
- Queues Telegram reply.
- Marks task as `succeeded`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/runtime/src/main-agent.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `MainAgentRuntime`**

Public interface:

```ts
export type MainAgentRuntimeDeps = {
  repositories: ReturnType<typeof createRepositories>;
  model: { complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> };
  emit: (event: TaoqibaoEvent) => void;
};

export class MainAgentRuntime {
  constructor(deps: MainAgentRuntimeDeps);
  handleTurn(input: {
    envelope: HumanEnvelope;
    session: SessionContext;
    task: TaskPacket;
  }): Promise<{ replyText: string; outboxId: string }>;
}
```

System prompt should be short and stable:

```text
你是淘气包的 main agent，负责温和、可靠地陪伴用户，并在 Phase 0 中只处理普通对话和显式历史检索。不要假装已经接入家庭设备、微信、摄像头或 AI 玩具。
```

- [ ] **Step 4: Add explicit session-search handling**

If user text contains phrases like `上次`, `之前`, `以前`, `历史`, call `sessionSearch` and include at most 5 snippets in the model context.

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npx vitest run packages/runtime/src/main-agent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime
git commit -m "feat: add main agent runtime"
```

## Task 10: Add Gateway Pipeline

**Files:**

- Create: `apps/gateway/src/config.ts`
- Create: `apps/gateway/src/pipeline.ts`
- Create: `apps/gateway/src/pipeline.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Test full in-memory path:

```text
HumanEnvelope
-> resolveIdentity
-> getOrCreateSession
-> admitTask
-> MainAgentRuntime.handleTurn
-> outbox reply
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run apps/gateway/src/pipeline.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config loader**

`config.ts` must:

- Load `.env` via `dotenv/config`.
- Parse required env vars.
- Split `TAOQIBAO_OWNER_TELEGRAM_USER_IDS` by comma.
- Default `TAOQIBAO_STATE_DB` to `$HOME/.taoqibao/state.db`.
- Never print secrets.

- [ ] **Step 4: Implement pipeline**

`pipeline.ts` should expose:

```ts
export async function handleHumanEnvelope(input: {
  envelope: HumanEnvelope;
  deps: GatewayDeps;
}): Promise<{ ok: true; replyText: string } | { ok: false; reason: string }>;
```

Denied identity returns a polite denial without calling the model.

- [ ] **Step 5: Run pipeline tests**

Run:

```bash
npx vitest run apps/gateway/src/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src/config.ts apps/gateway/src/pipeline.ts apps/gateway/src/pipeline.test.ts
git commit -m "feat: wire phase0 gateway pipeline"
```

## Task 11: Add Telegram Adapter

**Files:**

- Create: `packages/channel-telegram/src/index.ts`
- Create: `packages/channel-telegram/src/telegram-adapter.ts`
- Create: `packages/channel-telegram/src/telegram-adapter.test.ts`
- Modify: `apps/gateway/src/index.ts`

- [ ] **Step 1: Write failing Telegram adapter tests**

Test that:

- A private text update is normalized and passed to the pipeline.
- A group update is ignored in Phase 0.
- A send failure returns a sanitized error.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/channel-telegram/src/telegram-adapter.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement Telegram adapter**

Use `grammy` and expose:

```ts
export function createTelegramAdapter(input: {
  token: string;
  botAccountId: string;
  onEnvelope: (envelope: HumanEnvelope) => Promise<{ replyText?: string }>;
}): { start(): Promise<void>; stop(): Promise<void> };
```

Rules:

- Only handle `message:text`.
- Ignore non-private chats in Phase 0.
- Reply with `ctx.reply(replyText)` if provided.
- Log sanitized errors.

- [ ] **Step 4: Implement gateway entrypoint**

`apps/gateway/src/index.ts` should:

- Load config.
- Open and migrate SQLite.
- Build repositories.
- Build model client.
- Build pipeline dependencies.
- Start Telegram adapter.
- Handle `SIGINT`/`SIGTERM` gracefully.

- [ ] **Step 5: Run adapter tests**

Run:

```bash
npx vitest run packages/channel-telegram/src/telegram-adapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/channel-telegram apps/gateway/src/index.ts
git commit -m "feat: add telegram phase0 channel"
```

## Task 12: Add Doctor Command

**Files:**

- Create: `apps/gateway/src/doctor.ts`
- Create: `scripts/check-phase0.mjs`

- [ ] **Step 1: Write doctor behavior**

`doctor.ts` should check:

- Node version is >= 22.
- Required env vars are present.
- SQLite DB path is writable.
- FTS5 migration works in a temporary database.
- Telegram token is present but not printed.
- Model config is present but not printed.

- [ ] **Step 2: Add phase0 check script**

`scripts/check-phase0.mjs` should run:

```bash
npm run check
npm test
npm run doctor
```

- [ ] **Step 3: Run doctor**

Run:

```bash
npm run doctor
```

Expected: PASS when env is configured; otherwise FAIL with clear missing-env messages and no secrets.

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/doctor.ts scripts/check-phase0.mjs
git commit -m "chore: add phase0 doctor"
```

## Task 13: Add Linux npm Deployment Notes

**Files:**

- Create: `docs/phase0-runbook.md`
- Create: `deploy/systemd/taoqibao.service`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write `.env.example`**

Include only placeholders:

```bash
TAOQIBAO_STATE_DB="$HOME/.taoqibao/state.db"
TAOQIBAO_FAMILY_ID="main"
TAOQIBAO_CORE_AGENT_ID="main"
TAOQIBAO_OWNER_TELEGRAM_USER_IDS="123456789"
TELEGRAM_BOT_TOKEN="replace-me"
TAOQIBAO_MODEL_BASE_URL="https://api.example.com/v1"
TAOQIBAO_MODEL_API_KEY="replace-me"
TAOQIBAO_MODEL_NAME="replace-me"
TAOQIBAO_MODEL_TIMEOUT_MS="30000"
TAOQIBAO_LOG_LEVEL="info"
```

- [ ] **Step 2: Write systemd template**

`deploy/systemd/taoqibao.service`:

```ini
[Unit]
Description=Taoqibao Phase 0 Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/taoqibao
EnvironmentFile=/opt/taoqibao/.env
ExecStart=/usr/bin/npm run dev
Restart=on-failure
RestartSec=5
User=taoqibao

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Write runbook**

`docs/phase0-runbook.md` must include:

```bash
git clone <repo> /opt/taoqibao
cd /opt/taoqibao
npm install
cp .env.example .env
npm run doctor
npm run dev
```

Also include the systemd installation commands:

```bash
sudo useradd --system --home /opt/taoqibao --shell /usr/sbin/nologin taoqibao
sudo chown -R taoqibao:taoqibao /opt/taoqibao
sudo cp deploy/systemd/taoqibao.service /etc/systemd/system/taoqibao.service
sudo systemctl daemon-reload
sudo systemctl enable --now taoqibao
sudo journalctl -u taoqibao -f
```

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md docs/phase0-runbook.md deploy/systemd/taoqibao.service
git commit -m "docs: add linux npm phase0 runbook"
```

## Task 14: Final Phase 0 Acceptance

**Files:**

- Modify only if tests expose gaps.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
npm run phase0:check
```

Expected: PASS.

- [ ] **Step 2: Run local dry startup**

Run:

```bash
npm run doctor
npm run dev
```

Expected: Gateway starts and waits for Telegram updates. No secrets are printed.

- [ ] **Step 3: Manual Telegram smoke test**

From the allowlisted Telegram account, send:

```text
你好，淘气包
```

Expected:

- Bot replies in a warm `main` agent style.
- `sessions` has one session row.
- `session_messages` has the user and assistant messages.
- `tasks` has one succeeded task.
- `events` includes `message.received`, `task.created`, `task.completed`, `reply.queued`.

- [ ] **Step 4: Manual history search smoke test**

Send:

```text
你还记得我刚才说过什么吗？
```

Expected:

- Runtime uses session search snippets.
- Reply references the previous message without inventing unavailable capabilities.

- [ ] **Step 5: Manual denied-user test**

Send a message from a non-allowlisted Telegram user.

Expected:

- Bot does not call model adapter.
- Bot returns a short denial or silently ignores according to config.
- Event log records denied access without sensitive data.

- [ ] **Step 6: Commit final fixes**

```bash
git status --short
git add .
git commit -m "test: verify phase0 mvp"
```

## Phase 0 Done Definition

Phase 0 is done only when:

- `npm install` works on Linux.
- `npm run phase0:check` passes.
- Telegram private chat can round-trip through `main`.
- SQLite state persists sessions/messages/tasks/events/outbox.
- FTS5 search can retrieve prior conversation messages.
- Unknown Telegram users are denied by default.
- Real secrets are not committed or logged.
- README and runbook explain npm deployment.

## Handoff Notes For Phase 1

After Phase 0 is stable, the next plan should be separate and should not be mixed into this one. Phase 1 should add `home`, device adapters, approval, policy, and outbox delivery recovery. Phase 2 should add `lab`, skill registry, replay/shadow evaluation, multi-member identity binding, and memory/skill evolution promotion.

