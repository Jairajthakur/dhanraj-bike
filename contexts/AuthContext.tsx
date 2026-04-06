import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, getApiUrl, queryClient } from "@/lib/query-client";
import { fetch } from "expo/fetch";

const USER_STORAGE_KEY = "auth_user";

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "fos";
  fullName: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkMe();
  }, []);

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
      }
      // Any other error (network, 500, etc.) — keep cached user as-is
    } catch {
      // Network error — stay logged in with cached user
    } finally {
      setIsLoading(false);
    }
  }

  async function login(username: string, password: string) {
    const res = await apiRequest("POST", "/api/auth/login", { username, password });
    const data = await res.json();
    queryClient.clear();
    setUser(data);
    await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
  }

  async function logout() {
    await apiRequest("POST", "/api/auth/logout");
    queryClient.clear();
    setUser(null);
    await AsyncStorage.removeItem(USER_STORAGE_KEY);
  }

  const value = useMemo(() => ({ user, isLoading, login, logout }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
