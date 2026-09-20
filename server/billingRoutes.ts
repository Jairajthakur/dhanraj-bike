import type { Express, Request, Response, RequestHandler } from "express";
import crypto from "crypto";
import {
  MONTHLY_PRICE_INR,
  cashfreeMode,
  cashfreePhone,
  createCashfreeOrder,
  fetchCashfreeOrder,
  fetchSuccessfulPaymentId,
  getSubscriptionInfo,
  isCashfreeConfigured,
  verifyWebhookSignature,
} from "./billing";
import {
  activatePaidOrder,
  createSubscriptionPayment,
  getAgencyById,
  getRecentPendingPayment,
  getSubscriptionPayment,
} from "./storage";
import { renderCheckoutPage, renderMessagePage, renderReturnPage, type ReturnState } from "./billingPages";

// Base URL Cashfree redirects/notifies back to. Set PUBLIC_BASE_URL in production
// (e.g. https://app.dhanraj.co.in); otherwise it is derived from the request.
function publicBaseUrl(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const proto = req.header("x-forwarded-proto") || req.protocol || "https";
  const host = req.header("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

// Asks Cashfree (the source of truth) whether the order is paid and, if so,
// grants the month exactly once. Safe to call from the webhook, the return page
// and status polling at the same time. Never trusts the caller's claim of payment.
export async function confirmAndActivate(orderId: string): Promise<ReturnState> {
  const payment = await getSubscriptionPayment(orderId);
  if (!payment) return "NOT_FOUND";
  if (payment.status === "PAID") return "PAID";

  const order = await fetchCashfreeOrder(orderId);

  if (order.order_status === "PAID") {
    if (Number(order.order_amount) !== Number(payment.amount) || order.order_currency !== payment.currency) {
      console.error(
        `[billing] AMOUNT MISMATCH on ${orderId}: expected ${payment.amount} ${payment.currency}, ` +
          `Cashfree says ${order.order_amount} ${order.order_currency} — NOT activating`
      );
      return "FAILED";
    }
    const cfPaymentId = await fetchSuccessfulPaymentId(orderId);
    const { activated, agencyId } = await activatePaidOrder(orderId, cfPaymentId);
    if (activated) console.log(`[billing] Activated +1 month for agency ${agencyId} (order ${orderId})`);
    return "PAID";
  }

  if (["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"].includes(order.order_status)) return "FAILED";
  return "PENDING";
}

export function registerBillingRoutes(
  app: Express,
  guards: { requireSession: RequestHandler; requireAdminNoBilling: RequestHandler }
) {
  // Current subscription state. Any logged-in user of the agency may read it
  // (staff need it to see *why* they're locked out). Also reconciles a recent
  // unpaid order with Cashfree, so access unlocks even if the webhook is late.
  app.get("/api/billing/status", guards.requireSession, async (req: Request, res: Response) => {
    try {
      const agencyId = req.session.agencyId!;
      let agency = await getAgencyById(agencyId);
      if (!agency) return res.status(404).json({ message: "Agency not found" });

      if (!agency.billing_exempt && isCashfreeConfigured()) {
        const pending = await getRecentPendingPayment(agencyId);
        if (pending) {
          try {
            const state = await confirmAndActivate(pending.order_id);
            if (state === "PAID") agency = (await getAgencyById(agencyId)) || agency;
          } catch (e: any) {
            console.error("[billing] reconcile failed:", e.message);
          }
        }
      }

      res.json({
        subscription: getSubscriptionInfo(agency),
        paymentsAvailable: isCashfreeConfigured(),
        isAdmin: req.session.role === "admin",
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Admin starts a payment: creates a Cashfree order and returns the URL of our
  // checkout launcher page (opened in the phone's browser).
  app.post("/api/billing/checkout", guards.requireAdminNoBilling, async (req: Request, res: Response) => {
    try {
      if (!isCashfreeConfigured()) {
        return res.status(503).json({
          code: "PAYMENTS_NOT_CONFIGURED",
          message: "Online payments aren't available yet. Please contact support.",
        });
      }
      const agency = await getAgencyById(req.session.agencyId!);
      if (!agency) return res.status(404).json({ message: "Agency not found" });
      if (agency.billing_exempt) {
        return res.status(400).json({ message: "Your agency doesn't need a subscription." });
      }

      const orderId = `sub_${agency.id}_${crypto.randomBytes(10).toString("hex")}`;
      const base = publicBaseUrl(req);

      let order;
      try {
        order = await createCashfreeOrder({
          orderId,
          amount: MONTHLY_PRICE_INR,
          customerId: `agency_${agency.id}`,
          customerName: agency.owner_name || agency.name,
          customerPhone: cashfreePhone(agency.phone),
          returnUrl: `${base}/billing/return?order_id={order_id}`,
          notifyUrl: `${base}/api/billing/webhook`,
          note: `Monthly subscription - agency ${agency.code}`,
        });
      } catch (e: any) {
        console.error("[billing] create order failed:", e.message);
        return res.status(502).json({ message: "Could not start the payment. Please try again in a moment." });
      }
      if (!order.payment_session_id) {
        console.error("[billing] Cashfree returned no payment_session_id:", JSON.stringify(order));
        return res.status(502).json({ message: "Could not start the payment. Please try again in a moment." });
      }

      await createSubscriptionPayment({
        agency_id: agency.id,
        order_id: orderId,
        amount: MONTHLY_PRICE_INR,
        payment_session_id: order.payment_session_id,
        cf_order_id: String(order.cf_order_id),
      });

      res.json({ orderId, checkoutUrl: `${base}/billing/checkout?o=${encodeURIComponent(orderId)}` });
    } catch (e: any) {
      console.error("[billing] checkout error:", e);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  // Public page (opened in the browser, no app cookies): launches Cashfree checkout.
  // The order id is an unguessable random token that we look the session up by.
  app.get("/billing/checkout", async (req: Request, res: Response) => {
    try {
      const orderId = typeof req.query.o === "string" ? req.query.o : "";
      const payment = orderId ? await getSubscriptionPayment(orderId) : null;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      if (!payment || !payment.payment_session_id) {
        return res.status(404).send(renderMessagePage("Payment link not found", "Please go back to the app and start again."));
      }
      if (payment.status === "PAID") {
        return res.send(renderReturnPage("PAID", orderId));
      }
      res.send(
        renderCheckoutPage({
          paymentSessionId: payment.payment_session_id,
          mode: cashfreeMode(),
          amount: payment.amount,
        })
      );
    } catch (e: any) {
      console.error("[billing] checkout page error:", e.message);
      res.status(500).send(renderMessagePage("Something went wrong", "Please go back to the app and try again."));
    }
  });

  // Cashfree redirects the customer here after the payment attempt.
  app.get("/billing/return", async (req: Request, res: Response) => {
    const orderId = typeof req.query.order_id === "string" ? req.query.order_id.slice(0, 100) : "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    let state: ReturnState = "PENDING";
    try {
      state = orderId ? await confirmAndActivate(orderId) : "NOT_FOUND";
    } catch (e: any) {
      console.error("[billing] return confirm failed:", e.message);
    }
    res.send(renderReturnPage(state, orderId));
  });

  // Cashfree server-to-server notification. The signature proves it came from
  // Cashfree; we still confirm the order with Cashfree's API before granting
  // anything, so the payload itself is never trusted.
  app.post("/api/billing/webhook", async (req: Request, res: Response) => {
    try {
      const raw = (req as any).rawBody as Buffer | string | undefined;
      const rawBody = Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof raw === "string" ? raw : "";
      const signature = String(req.header("x-webhook-signature") || "");
      const timestamp = String(req.header("x-webhook-timestamp") || "");

      if (!rawBody || !verifyWebhookSignature(rawBody, signature, timestamp)) {
        console.warn("[billing] webhook rejected: bad or missing signature");
        return res.status(401).json({ message: "Invalid signature" });
      }

      const orderId: string | undefined = req.body?.data?.order?.order_id;
      if (orderId && orderId.startsWith("sub_")) {
        await confirmAndActivate(orderId); // throws on Cashfree outage -> 500 -> Cashfree retries
      }
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[billing] webhook error:", e.message);
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}
