import React, { useState, useRef, useEffect } from "react";
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
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface Allocation {
  id: number;
  loan_no: string;
  app_id: string;
  customer_name: string;
  registration_no: string;
  asset_make: string;
  bkt: string;
  pos: number;
  status: string;
}

export default function FosSearchScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"reg" | "chassis">("reg");
  const [results, setResults] = useState<Allocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length >= 3) {
      debounceRef.current = setTimeout(() => {
        handleSearch(query.trim());
      }, 150);
    } else {
      // Cancel any in-flight request
      abortRef.current?.abort();
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchType]);

async function handleSearch(q: string) {
  if (q.length < 3) return;

  abortRef.current?.abort();
  abortRef.current = new AbortController();

  setIsSearching(true);
  setHasSearched(true);

  try {
    const baseUrl = getApiUrl();
    const param = searchType === "chassis"
      ? `chassis=${encodeURIComponent(q)}`
      : `reg=${encodeURIComponent(q)}`;
    const url = new URL(`/api/allocations/search?${param}`, baseUrl);
    const res = await fetch(url.toString(), {
      credentials: "include",
      signal: abortRef.current.signal,
    });
    const data = await res.json();
    const found = Array.isArray(data) ? data : [];
    setResults(found);

    if (found.length > 0) {
      Haptics.selectionAsync();
      Keyboard.dismiss();
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      setResults([]);
      setHasSearched(false);
    }
  } finally {
    setIsSearching(false);
  }
}
  function clearSearch() {
    abortRef.current?.abort();
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setIsSearching(false);
    inputRef.current?.focus();
  }

  function switchType(type: "reg" | "chassis") {
    abortRef.current?.abort();
    setSearchType(type);
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setIsSearching(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.welcomeText}>Welcome,</Text>
          <Text style={styles.userName}>{user?.fullName || user?.username}</Text>
        </View>
        <Pressable
          onPress={async () => {
            await logout();
            router.replace("/login");
          }}
          style={styles.logoutBtn}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.textMuted} />
        </Pressable>
      </View>

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
            onChangeText={(text) => setQuery(text.toUpperCase())}
            placeholder={searchType === "chassis" ? "Enter chassis number..." : "Enter registration number..."}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              handleSearch(query.trim());
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {isSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : hasSearched ? (
        results.length === 0 ? (
          <View style={styles.notFoundContainer}>
            <View style={styles.notFoundIcon}>
              <Ionicons name="search-outline" size={40} color={Colors.textMuted} />
            </View>
            <Text style={styles.notFoundTitle}>No Data Found</Text>
            <Text style={styles.notFoundSubtitle}>
              No allocation found for "{query}"
            </Text>
          </View>
        ) : (
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
                    <Text style={styles.posText}>POS: ₹{Number(item.pos).toLocaleString("en-IN")}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </View>
              </Pressable>
            )}
          />
        )
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
    paddingBottom: 20,
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
  searchSection: {
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary,
  },
  toggleBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.textMuted,
  },
  toggleBtnTextActive: {
    color: Colors.background,
  },
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
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
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
  bktBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
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
