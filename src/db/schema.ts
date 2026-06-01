/**
 * Wend app — Drizzle schema (Neon Postgres, SHARED instance with the landing).
 *
 * IMPORTANT: This is the SAME Neon database the landing uses. The landing owns
 * `waitlist_signups` — it is intentionally NOT redefined here and must not be
 * touched. Everything below is new app-side tables.
 *
 * Two groups:
 *   1. Better Auth tables (`user`, `session`, `account`, `verification`) — these
 *      follow Better Auth's required core schema (singular table names, camelCase
 *      columns mapped to snake_case). Better Auth's Drizzle adapter reads/writes
 *      these. Generated/maintained to match Better Auth 1.6.x core schema.
 *   2. Wend domain tables (`notes`, `note_blocks`, `agent_runs`, `projects`,
 *      `devices`, `permissions_log`) — Design Doc / App Tasklist Phase 1.
 *
 * pgvector: the `projects.embedding` column is declared as a vector but left
 * nullable and unused in Phase 1 (routing intelligence is Phase 7). The migration
 * needs the `vector` extension; the founder enables it on Neon before applying
 * (see the migration notes in the build report).
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ===========================================================================
   1. BETTER AUTH CORE TABLES
   Names + columns follow Better Auth's required schema. Do not rename.
   =========================================================================== */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ===========================================================================
   2. WEND DOMAIN TABLES
   =========================================================================== */

export const noteBlockKind = pgEnum("note_block_kind", [
  "user_text",
  "agent_run",
  "code",
  "diff",
  "file_list",
]);

export const agentRunStatus = pgEnum("agent_run_status", [
  "queued",
  "running",
  "done",
  "failed",
  "stopped",
  "awaiting_permission",
]);

export const agentBackend = pgEnum("agent_backend", ["mac", "cloud"]);

export const deviceKind = pgEnum("device_kind", ["mac"]);

export const devicePairingStatus = pgEnum("device_pairing_status", [
  "pending",
  "paired",
  "revoked",
]);

export const permissionDecision = pgEnum("permission_decision", [
  "approved",
  "denied",
  "timed_out",
]);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("notes_user_id_idx").on(t.userId),
    index("notes_updated_at_idx").on(t.updatedAt),
  ],
);

export const noteBlocks = pgTable(
  "note_blocks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    kind: noteBlockKind("kind").notNull(),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("note_blocks_note_id_position_idx").on(t.noteId, t.position)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    repoUrl: text("repo_url"),
    // pgvector — nullable, unused until Phase 7 routing. 1536 dims (OpenAI-style;
    // adjust when the embedding model is chosen). Requires the `vector` extension.
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("projects_user_id_idx").on(t.userId)],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: deviceKind("kind").notNull().default("mac"),
    pairingStatus: devicePairingStatus("pairing_status")
      .notNull()
      .default("pending"),
    tailnetId: text("tailnet_id"),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("devices_user_id_idx").on(t.userId)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    // The Claude session id (`--resume <sessionId>`). Nullable until first emit.
    sessionId: text("session_id"),
    status: agentRunStatus("status").notNull().default("queued"),
    backend: agentBackend("backend").notNull().default("mac"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("agent_runs_note_id_idx").on(t.noteId),
    index("agent_runs_status_idx").on(t.status),
  ],
);

export const permissionsLog = pgTable(
  "permissions_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    decision: permissionDecision("decision").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("permissions_log_agent_run_id_idx").on(t.agentRunId)],
);

/* ===========================================================================
   Inferred types — import these in app + server code.
   =========================================================================== */

export type User = typeof user.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type NoteBlock = typeof noteBlocks.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type PermissionLog = typeof permissionsLog.$inferSelect;
