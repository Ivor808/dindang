import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  unique,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.orgId, t.userId)],
);

export const machines = pgTable("machines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["server", "terminal", "local"] }).notNull(),
  host: text("host").notNull(),
  port: integer("port").default(22).notNull(),
  username: text("username"),
  authMethod: text("auth_method", { enum: ["key", "password"] }),
  encryptedCredential: text("encrypted_credential"),
  hostKeyFingerprint: text("host_key_fingerprint"),
  enabled: boolean("enabled").default(true).notNull(),
  status: text("status", { enum: ["connected", "unreachable", "unknown"] })
    .default("unknown")
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  setupCommand: text("setup_command"),
  aiCli: text("ai_cli", { enum: ["claude", "codex", "none"] }).default("claude").notNull(),
  devPort: integer("dev_port"),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id),
  machineId: uuid("machine_id").references(() => machines.id),
  createdBy: uuid("created_by"),
  name: text("name").notNull(),
  remoteId: text("remote_id"),
  workDir: text("work_dir"),
  status: text("status", { enum: ["provisioning", "ready", "busy", "error"] })
    .default("provisioning")
    .notNull(),
  errorMessage: text("error_message"),
  hostPort: integer("host_port"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    provider: text("provider", { enum: ["github", "anthropic"] }).notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.provider)],
);
