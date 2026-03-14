import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("fos"),
  full_name: text("full_name").notNull().default(""),
  push_token: text("push_token"),
  created_at: timestamp("created_at").defaultNow(),
});

export const allocations = pgTable("allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  loan_no: text("loan_no"),
  app_id: text("app_id"),
  customer_name: text("customer_name"),
  emi: text("emi"),
  emi_due: text("emi_due"),
  cbc: text("cbc"),
  lpp: text("lpp"),
  cbc_lpp: text("cbc_lpp"),
  pos: text("pos"),
  bkt: text("bkt"),
  customer_address: text("customer_address"),
  first_emi_due_date: text("first_emi_due_date"),
  loan_maturity_date: text("loan_maturity_date"),
  asset_make: text("asset_make"),
  registration_no: text("registration_no"),
  engine_no: text("engine_no"),
  chassis_no: text("chassis_no"),
  ten: text("ten"),
  number: text("number"),
  status: text("status"),
  detail_fb: text("detail_fb"),
});

export const repoAllocations = pgTable("repo_allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  loan_no: text("loan_no"),
  app_id: text("app_id"),
  customer_name: text("customer_name"),
  emi: text("emi"),
  emi_due: text("emi_due"),
  cbc: text("cbc"),
  lpp: text("lpp"),
  cbc_lpp: text("cbc_lpp"),
  pos: text("pos"),
  bkt: text("bkt"),
  customer_address: text("customer_address"),
  first_emi_due_date: text("first_emi_due_date"),
  loan_maturity_date: text("loan_maturity_date"),
  asset_make: text("asset_make"),
  registration_no: text("registration_no"),
  engine_no: text("engine_no"),
  chassis_no: text("chassis_no"),
  ten: text("ten"),
  number: text("number"),
  status: text("status"),
  detail_fb: text("detail_fb"),
});

export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fos_user_id: integer("fos_user_id"),
  fos_name: text("fos_name"),
  customer_name: text("customer_name"),
  registration_no: text("registration_no"),
  allocation_id: integer("allocation_id"),
  source_role: text("source_role"),
  is_read: boolean("is_read").default(false),
  created_at: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
