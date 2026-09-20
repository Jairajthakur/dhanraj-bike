import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { apiRequest } from "@/lib/query-client";
import { useAuth, type SubscriptionInfo } from "@/contexts/AuthContext";

interface BillingStatus {
  subscription: SubscriptionInfo;
  paymentsAvailable: boolean;
  isAdmin: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatRupees(amount: number): string {
  return "₹" + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// apiRequest throws "<status>: <body>" — pull the server's message out of it.
function messageFrom(e: any, fallback: string): string {
  const raw: string = e?.message || "";
  const m = raw.match(/^\d+:\s*(.*)$/s);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.message) return j.message;
    } catch {
      /* not JSON */
    }
  }
  return fallback;
}

const POLL_MS = 4000;
const POLL_MAX_MS = 3 * 60 * 1000;

export function useBilling() {
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false); // creating the order / opening the browser
  const [awaiting, setAwaiting] = useState(false); // browser opened, waiting for the result
  const [error, setError] = useState<string | null>(null);
  const awaitingRef = useRef(false);
  const lastAccessEnd = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/billing/status");
      const data: BillingStatus = await res.json();
      setStatus(data);

      // A renewal (or first payment) moved the access date forward: sync the
      // auth user so the rest of the app / paywall gate sees it immediately.
      const end = data.subscription.accessEndsAt;
      if (lastAccessEnd.current !== undefined && end !== lastAccessEnd.current) {
        await refreshUser();
        if (awaitingRef.current) {
          awaitingRef.current = false;
          setAwaiting(false);
        }
      }
      lastAccessEnd.current = end;
    } catch (e: any) {
      // Keep the last known status; surface nothing for transient network errors.
    } finally {
      setLoading(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    load();
  }, [load]);

  // Returning from the payment page → check right away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => sub.remove();
  }, [load]);

  // While a payment is in flight, poll (the server confirms with Cashfree on each call).
  useEffect(() => {
    if (!awaiting) return;
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > POLL_MAX_MS) {
        clearInterval(id);
        return;
      }
      load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [awaiting, load]);

  const startPayment = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await apiRequest("POST", "/api/billing/checkout", {});
      const { checkoutUrl } = await res.json();
      awaitingRef.current = true;
      setAwaiting(true);
      await WebBrowser.openBrowserAsync(checkoutUrl);
      // Some platforms resolve when the tab closes, others immediately — either
      // way we keep polling / re-check on foreground rather than trusting this.
      load();
    } catch (e: any) {
      awaitingRef.current = false;
      setAwaiting(false);
      setError(messageFrom(e, "Could not start the payment. Please try again."));
    } finally {
      setStarting(false);
    }
  }, [load]);

  const cancelWaiting = useCallback(() => {
    awaitingRef.current = false;
    setAwaiting(false);
  }, []);

  return { status, loading, starting, awaiting, error, startPayment, refresh: load, cancelWaiting };
}
