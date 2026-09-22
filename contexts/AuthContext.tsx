import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, getApiUrl, queryClient, setSubscriptionRequiredHandler } from "@/lib/query-client";
import { clearCache } from "@/lib/offlineCache";
import { fetch } from "expo/fetch";

const USER_STORAGE_KEY = "auth_user";

export interface SubscriptionInfo {
  // exempt = never pays (a legacy/internal agency); trial = 7-day free trial;
  // active = paid up; expired = locked until the admin pays.
  status: "exempt" | "trial" | "active" | "expired";
  hasAccess: boolean;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  accessEndsAt: string | null;
  daysLeft: number | null;
  amount: number;
  currency: string;
  trialDays: number;
}

export interface AuthUser {
  id: number;
  username: string;
  role: "super_admin" | "admin" | "fos" | "repo";
  fullName: string;
  agencyId: number;
  agencyName: string;
  agencyCode: string;
  // Absent on responses from a server that predates billing — treated as no restriction.
  subscription?: SubscriptionInfo;
}

// True when the agency must pay before using the app. Also checks the local clock
// against accessEndsAt so a device locks at the moment of expiry even when it is
// offline or hasn't re-contacted the server yet. (The server enforces it too.)
export function isSubscriptionLocked(sub: SubscriptionInfo | undefined, now: number = Date.now()): boolean {
  if (!sub || sub.status === "exempt") return false;
  if (sub.status === "expired") return true;
  if (sub.accessEndsAt && new Date(sub.accessEndsAt).getTime() <= now) return true;
  return false;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (agencyCode: string, username: string, password: string) => Promise<void>;
  registerAgency: (data: {
    agencyName: string;
    ownerName: string;
    phone: string;
    username: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  // Re-reads the user + subscription from the server (e.g. after paying).
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkMe();
  }, []);

  const userRef = useRef<AuthUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Any 402 from the API means the subscription ended: re-check it so the root
  // layout can show the paywall. Throttled so a burst of failing requests
  // triggers a single refresh.
  const refreshBusy = useRef(false);
  useEffect(() => {
    setSubscriptionRequiredHandler(() => {
      if (refreshBusy.current) return;
      refreshBusy.current = true;
      refreshUser().finally(() => setTimeout(() => (refreshBusy.current = false), 3000));
    });
    return () => setSubscriptionRequiredHandler(null);
  }, []);

  // Coming back to the app (e.g. from the payment page, or after days in the
  // background) picks up the latest subscription state.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && userRef.current) refreshUser();
    });
    return () => sub.remove();
  }, []);

  async function refreshUser() {
    try {
      const res = await fetch(new URL("/api/auth/me", getApiUrl()).toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
      } else if (res.status === 401) {
        setUser(null);
        await AsyncStorage.removeItem(USER_STORAGE_KEY);
        await clearCache();
      }
    } catch {
      // offline — keep whatever we have
    }
  }

  async function checkMe() {
    // 1. Load cached user first — app works immediately, even offline
    try {
      const stored = await AsyncStorage.getItem(USER_STORAGE_KEY);
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch {}

    // 2. Try to verify session with server in background
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/me", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
      }
      // If 401, server said session expired — only then clear user
      if (res.status === 401) {
        setUser(null);
        await AsyncStorage.removeItem(USER_STORAGE_KEY);
        // Session gone — drop cached allocations so another agency's device
        // can never read leftover rows from the previous tenant.
        await clearCache();
      }
      // Any other error (network, 500, etc.) — keep cached user as-is
    } catch {
      // Network error — stay logged in with cached user
    } finally {
      setIsLoading(false);
    }
  }

  async function login(agencyCode: string, username: string, password: string) {
    const res = await apiRequest("POST", "/api/auth/login", { agencyCode, username, password });
    const data = await res.json();
    queryClient.clear();
    // Wipe any allocations cached under a previous agency/user on this device.
    await clearCache();
    setUser(data);
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
  }

  async function registerAgency(data: {
    agencyName: string;
    ownerName: string;
    phone: string;
    username: string;
    password: string;
  }) {
    const res = await apiRequest("POST", "/api/agencies/register", data);
    const user = await res.json();
    queryClient.clear();
    await clearCache();
    setUser(user);
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  }

  async function logout() {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
    queryClient.clear();
    await clearCache();
    setUser(null);
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  }

  const value = useMemo(
    () => ({ user, isLoading, login, registerAgency, logout, refreshUser }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
