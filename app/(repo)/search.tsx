import React, { useState, useRef } from "react";
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

export default function RepoSearchScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"reg" | "chassis">("reg");
  const [results, setResults] = useState<Allocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  async function handleSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    Keyboard.dismiss();
    setIsSearching(true);
    setHasSearched(true);
    try {
      const baseUrl = getApiUrl();
      const param = searchType === "chassis"
        ? `chassis=${encodeURIComponent(q)}`
        : `reg=${encodeURIComponent(q)}`;
      const url = new URL(`/api/repo-allocations/search?${param}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      Haptics.selectionAsync();
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    inputRef.current?.focus();
  }

  function switchType(type: "reg" | "chassis") {
    setSearchType(type);
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.welcomeText}>Welcome,</Text>
          <Text style={styles.userName}>{user?.fullName || user?.username}</Text>
        </View>
        <View style={styles.topBarRight}>
          <View style={styles.repoBadge}>
            <Text style={styles.repoBadgeText}>REPO</Text>
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
          <Ionicons name="search" size={20} color={Colors.primary} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={searchType === "chassis" ? "Enter chassis number..." : "Enter registration number..."}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.searchBtn,
            pressed && { opacity: 0.85 },
            (query.trim().length < 2 || isSearching) && { opacity: 0.5 },
          ]}
          onPress={handleSearch}
          disabled={query.trim().length < 2 || isSearching}
        >
          {isSearching ? (
            <ActivityIndicator color={Colors.background} size="small" />
          ) : (
            <Text style={styles.searchBtnText}>Search</Text>
          )}
        </Pressable>
      </View>

      {isSearching ? (
        <View style={styles.hintContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : hasSearched && results.length === 0 ? (
        <View style={styles.hintContainer}>
          <View style={styles.hintIcon}>
            <Ionicons name="search-outline" size={36} color={Colors.primary} />
          </View>
          <Text style={styles.hintTitle}>No Results</Text>
          <Text style={styles.hintSubtitle}>No repo allocations found for "{query}"</Text>
        </View>
      ) : !hasSearched ? (
        <View style={styles.hintContainer}>
          <View style={styles.hintIcon}>
            <Ionicons name="car-outline" size={36} color={Colors.primary} />
          </View>
          <Text style={styles.hintTitle}>Repo Search</Text>
          <Text style={styles.hintSubtitle}>
            {searchType === "chassis"
              ? "Enter a chassis number to find repo allocation details"
              : "Enter a vehicle registration number to find repo allocation details"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 20 }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.resultCard, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(`/repo-allocation/${item.id}`)}
            >
              <View style={styles.resultCardTop}>
                <View style={styles.regBadge}>
                  <Text style={styles.regNo}>{item.registration_no}</Text>
                </View>
                {item.bkt ? (
                  <View style={[styles.bktBadge, { backgroundColor: Colors.surface2 }]}>
                    <Text style={styles.bktText}>BKT: {item.bkt}</Text>
                  </View>
                ) : null}
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
    paddingBottom: 16,
  },
  welcomeText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted },
  userName: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary, marginTop: 2 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  repoBadge: {
    backgroundColor: "#2A0A00",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#FF6B35",
  },
  repoBadgeText: { fontFamily: "Inter_700Bold", fontSize: 11, color: "#FF6B35" },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  searchSection: { paddingHorizontal: 20, gap: 12 },
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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    height: 52,
    gap: 10,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    color: Colors.textPrimary,
    height: "100%",
  },
  clearBtn: { padding: 4 },
  searchBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.background },
  listContent: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  regBadge: {
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
