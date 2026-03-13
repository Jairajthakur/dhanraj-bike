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
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { fetch } from "expo/fetch";

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

interface Allocation {
  id: number;
  loan_no: string;
  app_id: string;
  customer_name: string;
  emi: number;
  emi_due: number;
  cbc: number;
  lpp: number;
  cbc_lpp: number;
  pos: number;
  bkt: string;
  customer_address: string;
  first_emi_due_date: string;
  loan_maturity_date: string;
  asset_make: string;
  registration_no: string;
  engine_no: string;
  chassis_no: string;
  ten: string;
  number: string;
  status: string;
  detail_fb: string;
}

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
        <Text style={[styles.detailValue, highlight && styles.highlightValue]}>{displayValue}</Text>
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

export default function RepoAllocationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notifSent, setNotifSent] = useState(false);

  useEffect(() => {
    loadAllocation();
  }, [id]);

  async function loadAllocation() {
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/repo-allocations/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      const data = await res.json();
      setAllocation(data);
      if (user?.role === "repo") {
        sendNotification(data);
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
        source_role: "repo",
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroLeft}>
            <View style={styles.repoTag}>
              <Ionicons name="car-outline" size={12} color="#FF6B35" />
              <Text style={styles.repoTagText}>REPO</Text>
            </View>
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
            <Ionicons name="checkmark-circle" size={16} color="#FF6B35" />
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
    gap: 8,
  },
  heroLeft: { flex: 1, gap: 8, paddingRight: 12 },
  repoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#2A0A00",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#FF6B35",
  },
  repoTagText: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#FF6B35" },
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
  customerNameHero: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  assetMakeHero: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary },
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
    backgroundColor: "#2A0A00",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FF6B35",
    justifyContent: "center",
    marginTop: 8,
  },
  notifSentText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#FF6B35",
  },
});
