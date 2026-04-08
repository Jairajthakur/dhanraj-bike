import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Network from "expo-network";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import { loadAllocationsFromCache, findById, CachedAllocation } from "@/lib/offlineCache";

function formatDate(value: string | number | null | undefined): string {
  if (!value || value === "" || value === "0") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!isNaN(num) && num > 1000) {
    const date = new Date((num - 25569) * 86400 * 1000);
    const d = date.getUTCDate().toString().padStart(2, "0");
    const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  const d = new Date(value as string);
  if (!isNaN(d.getTime())) {
    const day = d.getDate().toString().padStart(2, "0");
    const mon = (d.getMonth() + 1).toString().padStart(2, "0");
    return `${day}/${mon}/${d.getFullYear()}`;
  }
  return String(value);
}

type Allocation = CachedAllocation;

function DetailRow({
  label,
  value,
  highlight = false,
  isPhone = false,
}: {
  label: string;
  value: string | number | null | undefined;
  highlight?: boolean;
  isPhone?: boolean;
}) {
  const displayValue = value != null && value !== "" && value !== "0" ? String(value) : "—";

  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {isPhone && displayValue !== "—" ? (
        <Pressable onPress={() => Linking.openURL(`tel:${displayValue}`)}>
          <Text style={[styles.detailValue, styles.phoneValue]}>{displayValue}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.detailValue, highlight && styles.highlightValue]}>
          {displayValue}
        </Text>
      )}
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function AllocationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notifSent, setNotifSent] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    loadAllocation();
  }, [id]);

async function loadAllocation() {
  const numId = parseInt(id ?? "0", 10);

  const net = await Network.getNetworkStateAsync();
  const online = net.isConnected === true;

  if (online) {
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/allocations/${numId}`, baseUrl);

      const fetchPromise = fetch(url.toString(), { credentials: "include" });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 5000)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);
      if (!res.ok) throw new Error("Not found");
      const data: Allocation = await res.json();
      setAllocation(data);
      setIsOffline(false);
      setIsLoading(false);
      if (user?.role === "fos") sendNotification(data);
      return;
    } catch {
      // Fall through to cache
    }
  }

  // Offline or fetch failed → load from cache
  setIsOffline(true);
  try {
    const cached = await loadAllocationsFromCache();
    const found = findById(cached, numId);
    if (found) {
      setAllocation(found);
    } else {
      Alert.alert(
        "Not Found",
        "This record is not in your offline cache. Connect to the internet to load it.",
        [{ text: "Go Back", onPress: () => router.back() }]
      );
    }
  } catch {
    Alert.alert("Error", "Failed to load allocation data");
    router.back();
  } finally {
    setIsLoading(false);
  }
}

  async function sendNotification(data: Allocation) {
    if (notifSent) return;
    try {
      await apiRequest("POST", "/api/notifications", {
        customer_name: data.customer_name,
        registration_no: data.registration_no,
        allocation_id: data.id,
      });
      setNotifSent(true);
    } catch {}
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!allocation) return null;

  const fmt = (n: number | null | undefined) =>
    n != null && n !== 0 ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={Colors.red} />
          <Text style={styles.offlineBannerText}>Viewing cached data (offline)</Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroLeft}>
            <View style={styles.regNoBox}>
              <Text style={styles.regNoText}>{allocation.registration_no}</Text>
            </View>
            <Text style={styles.customerNameHero}>{allocation.customer_name}</Text>
            <Text style={styles.assetMakeHero}>{allocation.asset_make}</Text>
          </View>
          <View style={styles.bktCircle}>
            <Text style={styles.bktLabel}>BKT</Text>
            <Text style={styles.bktValue}>{allocation.bkt || "—"}</Text>
          </View>
        </View>

        <SectionHeader title="Latest Feedback" />
        <View style={styles.card}>
          <DetailRow label="Latest Feedback" value={allocation.detail_fb} highlight />
          <View style={styles.rowDivider} />
          <DetailRow label="Status" value={allocation.status} />
        </View>

        <SectionHeader title="Customer Information" />
        <View style={styles.card}>
          <DetailRow label="Customer Name" value={allocation.customer_name} />
          <View style={styles.rowDivider} />
          <DetailRow label="Loan No" value={allocation.loan_no} />
          <View style={styles.rowDivider} />
          <DetailRow label="BKT" value={allocation.bkt} />
          <View style={styles.rowDivider} />
          <DetailRow label="APP ID" value={allocation.app_id} />
          <View style={styles.rowDivider} />
          <DetailRow label="ADDRESS" value={allocation.customer_address} />
          <View style={styles.rowDivider} />
          <DetailRow label="MOBILE NO" value={allocation.number} isPhone />
          <View style={styles.rowDivider} />
          <DetailRow label="Ten" value={allocation.ten} />
        </View>

        <SectionHeader title="Financial Details" />
        <View style={styles.card}>
          <DetailRow label="POS" value={fmt(allocation.pos)} />
          <View style={styles.rowDivider} />
          <DetailRow label="EMI" value={fmt(allocation.emi)} />
          <View style={styles.rowDivider} />
          <DetailRow label="EMI DUE" value={fmt(allocation.emi_due)} />
          <View style={styles.rowDivider} />
          <DetailRow label="CBC" value={fmt(allocation.cbc)} />
          <View style={styles.rowDivider} />
          <DetailRow label="LPP" value={fmt(allocation.lpp)} />
          <View style={styles.rowDivider} />
          <DetailRow label="CBC+LPP" value={fmt(allocation.cbc_lpp)} />
        </View>

        <SectionHeader title="Loan Dates" />
        <View style={styles.card}>
          <DetailRow label="First EMI Due" value={formatDate(allocation.first_emi_due_date)} />
          <View style={styles.rowDivider} />
          <DetailRow label="Loan Maturity" value={formatDate(allocation.loan_maturity_date)} />
        </View>

        <SectionHeader title="Asset Details" />
        <View style={styles.card}>
          <DetailRow label="ASSET NAME" value={allocation.asset_make} />
          <View style={styles.rowDivider} />
          <DetailRow label="REG NO" value={allocation.registration_no} />
          <View style={styles.rowDivider} />
          <DetailRow label="Engine No" value={allocation.engine_no} />
          <View style={styles.rowDivider} />
          <DetailRow label="Chassis No" value={allocation.chassis_no} />
        </View>

        {notifSent && (
          <View style={styles.notifSentBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.green} />
            <Text style={styles.notifSentText}>Admin has been notified</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.redBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.red,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  offlineBannerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.red,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 0 },
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  heroLeft: { flex: 1, gap: 8, paddingRight: 12 },
  regNoBox: {
    backgroundColor: "#1A1400",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Colors.primaryDark,
  },
  regNoText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.primary,
    letterSpacing: 1.5,
  },
  customerNameHero: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.textPrimary,
  },
  assetMakeHero: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  bktCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.redBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.red,
  },
  bktLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.red },
  bktValue: { fontFamily: "Inter_700Bold", fontSize: 22, color: Colors.red },
  sectionHeader: { paddingVertical: 10, paddingHorizontal: 4 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: "flex-start",
    backgroundColor: Colors.surface,
  },
  detailLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: Colors.textSecondary,
    width: "40%",
    paddingRight: 8,
  },
  detailValue: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textPrimary,
    flex: 1,
    lineHeight: 20,
  },
  highlightValue: { fontFamily: "Inter_600SemiBold", color: Colors.primary },
  phoneValue: { color: Colors.blue, textDecorationLine: "underline" },
  rowDivider: { height: 1, backgroundColor: Colors.border },
  notifSentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.greenBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.green,
    justifyContent: "center",
    marginTop: 8,
  },
  notifSentText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.green },
});
