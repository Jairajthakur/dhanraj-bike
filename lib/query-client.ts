import { fetch } from "expo/fetch";
import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server.
 * - On web (production or dev): uses window.location.origin so the web app
 *   always talks to the same server that served the HTML (no hardcoded port).
 * - On native (Expo Go / APK): uses the EXPO_PUBLIC_DOMAIN env var which is
 *   injected by the dev workflow or baked in at EAS build time.
 */
export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  const host = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${host || "dhanraj-bike-production.up.railway.app"}`;
}

// ── Subscription paywall hook ────────────────────────────────────────────────
// The server answers HTTP 402 on every data route once an agency's trial or
// subscription has ended. AuthContext registers a handler here that re-checks
// the subscription and lets the root layout move the user to the paywall.
let onSubscriptionRequired: (() => void) | null = null;

export function setSubscriptionRequiredHandler(fn: (() => void) | null) {
  onSubscriptionRequired = fn;
}

// Call with any response from our API (including ones made with raw fetch).
export function notifyIfSubscriptionRequired(res: { status: number }) {
  if (res.status === 402) onSubscriptionRequired?.();
}

async function throwIfResNotOk(res: Response) {
  notifyIfSubscriptionRequired(res);
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const res = await fetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);
    const res = await fetch(url.toString(), {
      credentials: "include",
    });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    await throwIfResNotOk(res); // also handles 402 via notifyIfSubscriptionRequired
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
