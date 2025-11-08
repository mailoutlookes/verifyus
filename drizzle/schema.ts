import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Tabela para armazenar os logs de geração de e-mail
export const logs = mysqlTable("logs", {
  id: int("id").autoincrement().primaryKey(),
  apiToken: varchar("apiToken", { length: 255 }).notNull(), // Token usado
  email: varchar("email", { length: 320 }).notNull(), // E-mail gerado
  password: varchar("password", { length: 255 }).notNull(), // Senha gerada
  createdAt: timestamp("createdAt").defaultNow().notNull(), // Data de criação
});

export type Log = typeof logs.$inferSelect;
export type InsertLog = typeof logs. $inferInsert;
