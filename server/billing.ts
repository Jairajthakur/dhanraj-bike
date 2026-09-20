import crypto from "crypto";

// ── Pricing & trial ──────────────────────────────────────────────────────────
export const TRIAL_DAYS = 7;
export const CURRENCY = "INR";

// ₹2,000 per month. Can be overridden with SUBSCRIPTION_PRICE_INR (whole rupees)
// — handy for testing a real payment with ₹1 before going live.
function readPrice(): number {
  const n = parseInt(process.env.SUBSCRIPTION_PRICE_INR || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}
export const MONTHLY_PRICE_INR = readPrice();

// Agencies that never pay. Matched on the agency *code* (server-generated and
// random for self-registered agencies, so it cannot be claimed by registering).
// "DHANRAJ1" is the code the multi-tenant migration gives Dhanraj Enterprises.
// Add more with BILLING_EXEMPT_AGENCY_CODES="CODE1,CODE2".
export function billingExemptCodes(): string[] {
  const extra = (process.env.BILLING_EXEMPT_AGENCY_CODES || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(["DHANRAJ1", ...extra]));
}

// ── Subscription state ───────────────────────────────────────────────────────
export type SubscriptionStatus = "exempt" | "trial" | "active" | "expired";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  hasAccess: boolean;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  // The moment access stops (latest of trial end / paid-through). null for exempt.
  accessEndsAt: string | null;
  daysLeft: number | null;
  amount: number;
  currency: string;
  trialDays: number;
}

interface BillingFields {
  billing_exempt?: boolean | null;
  trial_ends_at?: Date | string | null;
  subscription_ends_at?: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function getSubscriptionInfo(agency: BillingFields, now: Date = new Date()): SubscriptionInfo {
  const base = { amount: MONTHLY_PRICE_INR, currency: CURRENCY, trialDays: TRIAL_DAYS };
  const trialEnd = toDate(agency.trial_ends_at);
  const paidEnd = toDate(agency.subscription_ends_at);

  if (agency.billing_exempt) {
    return {
      ...base,
      status: "exempt",
      hasAccess: true,
      trialEndsAt: null,
      subscriptionEndsAt: null,
      accessEndsAt: null,
      daysLeft: null,
    };
  }

  const accessEnd =
    trialEnd && paidEnd ? (trialEnd > paidEnd ? trialEnd : paidEnd) : trialEnd || paidEnd;

  let status: SubscriptionStatus = "expired";
  if (paidEnd && paidEnd > now) status = "active";
  else if (trialEnd && trialEnd > now) status = "trial";

  const hasAccess = status === "active" || status === "trial";
  const daysLeft =
    hasAccess && accessEnd ? Math.max(0, Math.ceil((accessEnd.getTime() - now.getTime()) / 86_400_000)) : 0;

  return {
    ...base,
    status,
    hasAccess,
    trialEndsAt: trialEnd ? trialEnd.toISOString() : null,
    subscriptionEndsAt: paidEnd ? paidEnd.toISOString() : null,
    accessEndsAt: accessEnd ? accessEnd.toISOString() : null,
    daysLeft,
  };
}

// Calendar-month addition that clamps to the end of shorter months
// (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const daysInMonth = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, daysInMonth));
  return r;
}

// ── Cashfree Payment Gateway client ──────────────────────────────────────────
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
const API_VERSION = "2023-08-01";

export type CashfreeMode = "production" | "sandbox";

export function cashfreeMode(): CashfreeMode {
  return (process.env.CASHFREE_ENV || "").toLowerCase() === "production" ? "production" : "sandbox";
}

export function isCashfreeConfigured(): boolean {
  return !!(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
}

function cfBase(): string {
  return cashfreeMode() === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

async function cfRequest<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!isCashfreeConfigured()) throw new Error("Cashfree is not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${cfBase()}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-version": API_VERSION,
        "x-client-id": process.env.CASHFREE_CLIENT_ID as string,
        "x-client-secret": process.env.CASHFREE_CLIENT_SECRET as string,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = json?.message || text || res.statusText;
      throw new Error(`Cashfree ${res.status}: ${msg}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface CashfreeOrder {
  cf_order_id: string | number;
  order_id: string;
  order_amount: number;
  order_currency: string;
  order_status: string; // ACTIVE | PAID | EXPIRED | TERMINATED | ...
  payment_session_id?: string;
}

export function createCashfreeOrder(input: {
  orderId: string;
  amount: number;
  customerId: string;
  customerName: string;
  customerPhone: string;
  returnUrl: string;
  notifyUrl: string;
  note: string;
}): Promise<CashfreeOrder> {
  return cfRequest<CashfreeOrder>("POST", "/orders", {
    order_id: input.orderId,
    order_amount: input.amount,
    order_currency: CURRENCY,
    order_note: input.note,
    customer_details: {
      customer_id: input.customerId,
      customer_name: input.customerName,
      customer_phone: input.customerPhone,
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
  });
}

export function fetchCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  return cfRequest<CashfreeOrder>("GET", `/orders/${encodeURIComponent(orderId)}`);
}

// Best-effort: returns the Cashfree payment id of the successful attempt, if any.
export async function fetchSuccessfulPaymentId(orderId: string): Promise<string | null> {
  try {
    const payments = await cfRequest<any[]>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
    const ok = Array.isArray(payments) ? payments.find((p) => p?.payment_status === "SUCCESS") : null;
    return ok?.cf_payment_id != null ? String(ok.cf_payment_id) : null;
  } catch {
    return null;
  }
}

// Cashfree signs webhooks as base64(HMAC-SHA256(timestamp + rawBody, clientSecret)).
export function verifyWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
  const secret = process.env.CASHFREE_CLIENT_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Cashfree needs a 10-digit phone; agencies may have left theirs blank.
export function cashfreePhone(raw: string | null | undefined): string {
  const digits = (raw || "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : "9999999999";
}
