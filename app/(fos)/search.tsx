import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Platform,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Ellipse, RadialGradient, Stop, Defs, Text as SvgText } from "react-native-svg";
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
  saveRepoAllocationsToCache,
  loadAllocationsFromCache,
  loadRepoAllocationsFromCache,
  getCacheMeta,
  getRepoCacheMeta,
  isCacheFresh,
  isRepoCacheFresh,
  searchByReg,
  searchByChassis,
  clearCache,
} from "@/lib/offlineCache";

// ─── Max digit limits ─────────────────────────────────────────────────────────
const MAX_DIGITS = { reg: 4, chassis: 5 } as const;

// ─── Custom golden search icon (matches uploaded image) ───────────────────────
function SearchIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        stroke="#D4950F"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1="15.5"
        y1="15.5"
        x2="21"
        y2="21"
        stroke="#D4950F"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// ─── Custom Numeric Keyboard ──────────────────────────────────────────────────
function NumericKeyboard({
  onKey,
  locked,
}: {
  onKey: (k: string) => void;
  locked: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  return (
    <View style={kbStyles.grid}>
      {keys.map((k) => (
        <Pressable
          key={k}
          style={({ pressed }) => [
            kbStyles.key,
            locked && kbStyles.keyDisabled,
            pressed && !locked && kbStyles.keyPressed,
          ]}
          onPress={() => !locked && onKey(k)}
          disabled={locked}
        >
          {k === "back" ? (
            <Ionicons
              name="backspace-outline"
              size={20}
              color={locked ? Colors.textMuted + "55" : Colors.textPrimary}
            />
          ) : (
            <Text style={[kbStyles.keyText, locked && kbStyles.keyTextDisabled]}>
              {k}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const kbStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  key: {
    width: "30%",
    flexGrow: 1,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  keyPressed: {
    backgroundColor: "#2a2200",
    borderColor: Colors.primary,
  },
  keyDisabled: {
    opacity: 0.35,
  },
  keyText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: Colors.textPrimary,
  },
  keyTextDisabled: {
    color: Colors.textMuted,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function FosSearchScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"reg" | "chassis">("reg");
  const [results, setResults] = useState<CachedAllocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState<"none" | "found" | "notfound">("none");
  const [keyboardLocked, setKeyboardLocked] = useState(false);

  const [allAllocations, setAllAllocations] = useState<CachedAllocation[]>([]);
  const allAllocationsRef = useRef<CachedAllocation[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [cacheCount, setCacheCount] = useState(0);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const maxDigits = MAX_DIGITS[searchType];

  useEffect(() => { initCache(); }, []);

  async function initCache() {
    const isRepo = user?.role === "repo";
    const cached = isRepo
      ? await loadRepoAllocationsFromCache()
      : await loadAllocationsFromCache();
    allAllocationsRef.current = cached;
    setAllAllocations(cached);

    const meta = isRepo ? await getRepoCacheMeta() : await getCacheMeta();
    if (meta) {
      setCacheCount(meta.count);
      setLastSynced(formatSyncTime(meta.lastSynced));
    }

    const net = await Network.getNetworkStateAsync();
    const online = net.isConnected === true;
    setIsOnline(online);

    if (online) {
      const fresh = isRepo ? await isRepoCacheFresh() : await isCacheFresh();
      if (!fresh) await syncAllocations(true);
    }
  }

  async function syncAllocations(silent = false) {
    const isRepo = user?.role === "repo";
    try {
      const baseUrl = getApiUrl();
      const endpoint = isRepo ? "/api/allocations/repo/all" : "/api/allocations/all";
      const url = new URL(endpoint, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Sync failed");
      const data: CachedAllocation[] = await res.json();
      isRepo
        ? await saveRepoAllocationsToCache(data)
        : await saveAllocationsToCache(data);
      allAllocationsRef.current = data;
      setAllAllocations(data);
      setCacheCount(data.length);
      setLastSynced(formatSyncTime(Date.now()));
      setIsOnline(true);
    } catch { /* silent fail */ }
  }

  function formatSyncTime(ts: number): string {
    const d = new Date(ts);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    const mon = (d.getMonth() + 1).toString().padStart(2, "0");
    return `${day}/${mon} ${hh}:${mm}`;
  }

  // ─── Key press: lock at max digits, auto-search, auto-wipe ───────────────
  const handleKey = useCallback(
    (k: string) => {
      if (keyboardLocked) return;

      if (k === "back") {
        setQuery((prev) => prev.slice(0, -1));
        return;
      }

      setQuery((prev) => {
        const next = prev + k;
        if (next.length >= maxDigits) {
          setKeyboardLocked(true);
          Keyboard.dismiss();
          setTimeout(() => doSearch(next), 50);
          return next;
        }
        return next;
      });
    },
    [keyboardLocked, maxDigits, searchType]
  );

  function doSearch(q: string) {
    if (q.length < 1) return;
    setIsSearching(true);

    const found =
      searchType === "chassis"
        ? searchByChassis(allAllocationsRef.current, q)
        : searchByReg(allAllocationsRef.current, q);

    // Wipe input and unlock keyboard immediately after search
    setQuery("");
    setKeyboardLocked(false);
    setIsSearching(false);

    if (found.length >= 1) {
      setResults(found);
      setShowResults("found");
      Haptics.selectionAsync();
    } else {
      setResults([]);
      setShowResults("notfound");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setShowResults("none");
    setIsSearching(false);
    setKeyboardLocked(false);
  }

  function switchType(type: "reg" | "chassis") {
    setSearchType(type);
    setQuery("");
    setResults([]);
    setShowResults("none");
    setIsSearching(false);
    setKeyboardLocked(false);
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

      {/* Toggle */}
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

        {/* Search display — read-only, shows typed digits */}
        <Pressable style={styles.searchBox} onPress={clearSearch}>
          <SearchIcon size={22} />
          <Text
            style={[
              styles.searchDisplay,
              query.length === 0 && styles.searchPlaceholder,
            ]}
            numberOfLines={1}
          >
            {query.length > 0
              ? query
              : searchType === "chassis"
              ? "Enter chassis number..."
              : "Enter registration number..."}
          </Text>
          {(query.length > 0 || showResults !== "none") && (
            <Pressable onPress={clearSearch} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </Pressable>
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

      {/* Results / hint area */}
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
          <Svg width={110} height={114} viewBox="0 0 110 114">
            <Defs>
              <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#D4950F" stopOpacity="0.25" />
                <Stop offset="100%" stopColor="#D4950F" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Ellipse cx="55" cy="57" rx="50" ry="50" fill="url(#glow)" />
            <Path
              d="M55 8 L92 24 L92 58 Q92 86 55 106 Q18 86 18 58 L18 24 Z"
              fill="#1A1200"
              stroke="#D4950F"
              strokeWidth="2.5"
            />
            <Path
              d="M55 18 L84 32 L84 58 Q84 78 55 94 Q26 78 26 58 L26 32 Z"
              fill="none"
              stroke="#D4950F"
              strokeWidth="0.8"
              opacity="0.35"
            />
            <SvgText
              x="55"
              y="70"
              textAnchor="middle"
              fontSize="32"
              fontWeight="900"
              fill="#D4950F"
              fontFamily="Arial"
            >
              D
            </SvgText>
          </Svg>
          <Text style={styles.hintBrand}>DHANRAJ ENTERPRISES</Text>
          <View style={styles.hintDivider}>
            <View style={styles.hintLine} />
            <View style={styles.hintDot} />
            <View style={styles.hintLine} />
          </View>
          <Text style={styles.hintSubtitle}>
            Enter a number above to find customer details
          </Text>
        </View>
      )}

      {/* Custom Numeric Keyboard — always locked to bottom */}
      <NumericKeyboard onKey={handleKey} locked={keyboardLocked} />
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
  noCacheText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.red, flex: 1 },
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
    paddingVertical: 14,
  },
  searchDisplay: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 17,
    color: Colors.textPrimary,
    letterSpacing: 2,
  },
  searchPlaceholder: {
    color: Colors.textMuted,
    letterSpacing: 0.5,
    fontSize: 15,
  },
  clearBtn: { padding: 4 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 15, color: Colors.textSecondary },
  notFoundContainer: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14,
  },
  notFoundIcon: {
    width: 80, height: 80, borderRadius: 22, backgroundColor: Colors.surface,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.border,
  },
  notFoundTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.textPrimary },
  notFoundSubtitle: {
    fontFamily: "Inter_400Regular", fontSize: 15, color: Colors.textSecondary,
    textAlign: "center", lineHeight: 22,
  },
  resultsList: { paddingHorizontal: 20, gap: 12 },
  resultsCount: {
    fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary, marginBottom: 4,
  },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16,
    gap: 8, borderWidth: 1, borderColor: Colors.border,
  },
  resultCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regNoContainer: {
    backgroundColor: "#1A1400", paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: Colors.primaryDark,
  },
  regNo: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.primary, letterSpacing: 1 },
  bktBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  bktText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.textSecondary },
  customerName: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.textPrimary },
  assetMake: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  resultCardBottom: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4,
  },
  posRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  posText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textMuted },
  hintContainer: {
    flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10,
  },
  hintBrand: {
    fontFamily: "Inter_700Bold", fontSize: 13, color: Colors.primary,
    letterSpacing: 4, marginTop: 6,
  },
  hintDivider: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintLine: { width: 22, height: 1, backgroundColor: Colors.border },
  hintDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  hintSubtitle: {
    fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary,
    textAlign: "center", lineHeight: 20,
  },
});
