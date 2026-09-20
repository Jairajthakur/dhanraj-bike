import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const agencies = pgTable("agencies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  owner_name: text("owner_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  is_active: boolean("is_active").default(true),
  created_at: timestamp("created_at").defaultNow(),
  // ── Billing ──
  // Exempt agencies (Dhanraj Enterprises) never pay. Everyone else gets a
  // 7-day trial (trial_ends_at) and then pays Rs 2,000/month via Cashfree
  // (each successful payment pushes subscription_ends_at out by one month).
  billing_exempt: boolean("billing_exempt").notNull().default(false),
  trial_ends_at: timestamp("trial_ends_at", { withTimezone: true }),
  subscription_ends_at: timestamp("subscription_ends_at", { withTimezone: true }),
});

// One row per Cashfree order we create. status: PENDING -> PAID.
export const subscriptionPayments = pgTable("subscription_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agency_id: integer("agency_id").notNull(),
  order_id: text("order_id").notNull().unique("subscription_payments_order_id_unique"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("PENDING"),
  payment_session_id: text("payment_session_id"),
  cf_order_id: text("cf_order_id"),
  cf_payment_id: text("cf_payment_id"),
  period_start: timestamp("period_start", { withTimezone: true }),
  period_end: timestamp("period_end", { withTimezone: true }),
  paid_at: timestamp("paid_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agency_id: integer("agency_id").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  role: text("role").notNull().default("fos"),
  full_name: text("full_name").notNull().default(""),
  push_token: text("push_token"),
  created_at: timestamp("created_at").defaultNow(),
});

export const allocations = pgTable("allocations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  agency_id: integer("agency_id").notNull(),
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
  agency_id: integer("agency_id").notNull(),
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
  agency_id: integer("agency_id").notNull(),
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
