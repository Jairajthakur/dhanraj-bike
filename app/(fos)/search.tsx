import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Network from "expo-network";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import {
  CachedAllocation,
  saveAllocationsToCache,
  loadAllocationsFromCache,
  getCacheMeta,
  isCacheFresh,
  searchByReg,
  searchByChassis,
  clearCache,
} from "@/lib/offlineCache";

export default function FosSearchScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"reg" | "chassis">("reg");
  const [results, setResults] = useState<CachedAllocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState<"none" | "found" | "notfound">("none");

  // Offline / cache state
  const [allAllocations, setAllAllocations] = useState<CachedAllocation[]>([]);
  const allAllocationsRef = useRef<CachedAllocation[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [cacheCount, setCacheCount] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ─── Init: load cache then try to sync ───────────────────────────────────
  useEffect(() => {
    initCache();
  }, []);

  async function initCache() {
    // Load whatever is already cached
    const cached = await loadAllocationsFromCache();
    allAllocationsRef.current = cached;
    setAllAllocations(cached);

    const meta = await getCacheMeta();
    if (meta) {
      setCacheCount(meta.count);
      setLastSynced(formatSyncTime(meta.lastSynced));
    }

    // Check network
    const net = await Network.getNetworkStateAsync();
    const online = net.isConnected === true;
    setIsOnline(online);

    if (online) {
      const fresh = await isCacheFresh();
      if (!fresh) {
        // Auto-sync if cache is stale or empty
        await syncAllocations(true);
      }
    }
  }

  // ─── Sync from server ─────────────────────────────────────────────────────
  async function syncAllocations(silent = false) {
    if (!silent) setIsSyncing(true);
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/allocations/all", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Sync failed");
      const data: CachedAllocation[] = await res.json();
      await saveAllocationsToCache(data);
      allAllocationsRef.current = data;
      setAllAllocations(data);
      setCacheCount(data.length);
      setLastSynced(formatSyncTime(Date.now()));
      setIsOnline(true);
    } catch {
      // don't set offline here, sync may fail for other reasons
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }

  function formatSyncTime(ts: number): string {
    const d = new Date(ts);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const mon = (d.getMonth() + 1).toString().padStart(2, "0");
    return `${day}/${mon} ${hh}:${mm}`;
  }

  // ─── Debounced search from local cache ───────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();

    if (trimmed.length >= 3) {
      debounceRef.current = setTimeout(() => doSearch(trimmed), 600);
    } else if (trimmed.length === 0 && showResults !== "found") {
      setResults([]);
      setShowResults("none");
      setIsSearching(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchType]);

  function doSearch(q: string) {
    if (q.length < 3) return;
    setIsSearching(true);

    const found =
      searchType === "chassis"
        ? searchByChassis(allAllocationsRef.current, q)
        : searchByReg(allAllocationsRef.current, q);

      if (found.length >= 1) {
        setResults(found);
        setShowResults("found");
        setQuery("");
        Keyboard.dismiss();        // ← ADD THIS
        inputRef.current?.blur();  // ← ADD THIS
        Haptics.selectionAsync();
     } else {
  setResults([]);
  setShowResults("notfound");
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  setQuery("");
  Keyboard.dismiss();
  inputRef.current?.blur();
  setShowResults("none");      // ← directly set, no setTimeout
}

    setIsSearching(false);
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setShowResults("none");
    setIsSearching(false);
    inputRef.current?.focus();
  }

  function switchType(type: "reg" | "chassis") {
    setSearchType(type);
    setQuery("");
    setResults([]);
    setShowResults("none");
    setIsSearching(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.welcomeText}>Welcome,</Text>
          <Text style={styles.userName}>{user?.fullName || user?.username}</Text>
        </View>
        <Pressable
          onPress={async () => {
            await clearCache();
            await logout();
            router.replace("/login");
          }}
          style={styles.logoutBtn}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.textMuted} />
        </Pressable>
      </View>

      {/* Search section */}
      <View style={styles.searchSection}>
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggleBtn, searchType === "reg" && styles.toggleBtnActive]}
            onPress={() => switchType("reg")}
          >
            <Text style={[styles.toggleBtnText, searchType === "reg" && styles.toggleBtnTextActive]}>
              Reg No.
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, searchType === "chassis" && styles.toggleBtnActive]}
            onPress={() => switchType("chassis")}
          >
            <Text style={[styles.toggleBtnText, searchType === "chassis" && styles.toggleBtnTextActive]}>
              Chassis No.
            </Text>
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Ionicons
            name={isSearching ? "hourglass-outline" : "search"}
            size={20}
            color={Colors.primary}
            style={styles.searchIcon}
          />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={(text) => {
              setQuery(text.toUpperCase());
            }}
            placeholder={
              searchType === "chassis"
                ? "Enter chassis number..."
                : "Enter registration number..."
            }
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              doSearch(query.trim());
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
          />
          {(query.length > 0 || showResults !== "none") && (
            <Pressable onPress={clearSearch} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* No cache warning */}
      {!isOnline && cacheCount === 0 && (
        <View style={styles.noCacheWarning}>
          <Ionicons name="cloud-offline-outline" size={18} color={Colors.red} />
          <Text style={styles.noCacheText}>
            Offline — no cached data. Connect to internet to sync.
          </Text>
        </View>
      )}

      {/* Results */}
      {isSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : showResults === "found" ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.resultsList, { paddingBottom: bottomPad + 80 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.resultsCount}>
              {results.length} result{results.length !== 1 ? "s" : ""} found
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.resultCard, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.selectionAsync();
                setResults([]);
                setShowResults("none");
                router.push({ pathname: "/allocation/[id]", params: { id: item.id.toString() } });
              }}
            >
              <View style={styles.resultCardTop}>
                <View style={styles.regNoContainer}>
                  <Text style={styles.regNo}>{item.registration_no}</Text>
                </View>
                <View style={[styles.bktBadge, { backgroundColor: Colors.surface2 }]}>
                  <Text style={styles.bktText}>BKT {item.bkt}</Text>
                </View>
              </View>
              <Text style={styles.customerName}>{item.customer_name}</Text>
              <Text style={styles.assetMake}>{item.asset_make}</Text>
              <View style={styles.resultCardBottom}>
                <View style={styles.posRow}>
                  <Ionicons name="cash-outline" size={14} color={Colors.textMuted} />
                  <Text style={styles.posText}>
                    POS: ₹{Number(item.pos).toLocaleString("en-IN")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
              </View>
            </Pressable>
          )}
        />
      ) : showResults === "notfound" ? (
        <View style={styles.notFoundContainer}>
          <View style={styles.notFoundIcon}>
            <Ionicons name="search-outline" size={40} color={Colors.textMuted} />
          </View>
          <Text style={styles.notFoundTitle}>No Data Found</Text>
          <Text style={styles.notFoundSubtitle}>No allocation found</Text>
        </View>
      ) : (
        <View style={styles.hintContainer}>
          <View style={styles.hintIcon}>
            <Ionicons name="bicycle-outline" size={40} color={Colors.primary} />
          </View>
          <Text style={styles.hintTitle}>Search Allocations</Text>
          <Text style={styles.hintSubtitle}>
            {searchType === "chassis"
              ? "Enter a chassis number to find customer details"
              : "Enter a vehicle registration number to find customer details"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  welcomeText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  userName: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  logoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  
  statusLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotOnline: { backgroundColor: Colors.green },
  dotOffline: { backgroundColor: Colors.red },
  statusText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  statusMuted: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  syncBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  noCacheWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: Colors.redBg,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.red,
  },
  noCacheText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.red,
    flex: 1,
  },
  // Search section
  searchSection: { paddingHorizontal: 20, gap: 12, marginBottom: 16 },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
  },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 9 },
  toggleBtnActive: { backgroundColor: Colors.primary },
  toggleBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textMuted },
  toggleBtnTextActive: { color: Colors.background },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    gap: 10,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 17,
    color: Colors.textPrimary,
    paddingVertical: 16,
    letterSpacing: 0.5,
  },
  clearBtn: { padding: 4 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 15, color: Colors.textSecondary },
  notFoundContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  notFoundIcon: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  notFoundTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.textPrimary },
  notFoundSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  resultsList: { paddingHorizontal: 20, gap: 12 },
  resultsCount: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  regNoContainer: {
    backgroundColor: "#1A1400",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primaryDark,
  },
  regNo: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.primary, letterSpacing: 1 },
  bktBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  bktText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary },
  customerName: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.textPrimary },
  assetMake: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  resultCardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  posRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  posText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textMuted },
  hintContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  hintIcon: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: "#1A1400",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.primaryDark,
  },
  hintTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.textPrimary },
  hintSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
