import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

interface SubscriptionInfo {
  status: "exempt" | "trial" | "active" | "expired";
  hasAccess: boolean;
  daysLeft: number | null;
}

interface AgencyRow {
  id: number;
  name: string;
  code: string;
  owner_name: string;
  phone: string;
  is_active: boolean;
  billing_exempt: boolean;
  created_at: string;
  user_count: number;
  allocation_count: number;
  repo_allocation_count: number;
  subscription: SubscriptionInfo;
}

const STATUS_CONFIG = {
  exempt: { label: "Exempt", color: Colors.blue, bg: Colors.blueBg },
  trial: { label: "Trial", color: Colors.orange, bg: Colors.orangeBg },
  active: { label: "Active", color: Colors.green, bg: Colors.greenBg },
  expired: { label: "Expired", color: Colors.red, bg: Colors.redBg },
};

function haptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function AgencyCard({ agency }: { agency: AgencyRow }) {
  const qc = useQueryClient();
  const status = STATUS_CONFIG[agency.subscription.status];

  const toggleActive = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/super-admin/agencies/${agency.id}/active`, { is_active: !agency.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] }),
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to update"),
  });

  const toggleExempt = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/super-admin/agencies/${agency.id}/billing-exempt`, { billing_exempt: !agency.billing_exempt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] }),
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to update"),
  });

  const extend = useMutation({
    mutationFn: () => apiRequest("POST", `/api/super-admin/agencies/${agency.id}/extend`, { months: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] }),
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to extend"),
  });

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{agency.name}</Text>
          <Text style={styles.code}>{agency.code} · {agency.owner_name || "—"}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat icon="people" value={agency.user_count} label="Users" />
        <Stat icon="document-text" value={agency.allocation_count} label="Allocations" />
        <Stat icon="car" value={agency.repo_allocation_count} label="Repo" />
        {agency.subscription.daysLeft !== null && (
          <Stat icon="time" value={agency.subscription.daysLeft} label="Days left" />
        )}
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, !agency.is_active && styles.actionBtnDanger]}
          onPress={() => { haptic(); toggleActive.mutate(); }}
          disabled={toggleActive.isPending}
        >
          <Ionicons name={agency.is_active ? "pause" : "play"} size={14} color={agency.is_active ? Colors.textSecondary : Colors.green} />
          <Text style={[styles.actionText, !agency.is_active && { color: Colors.green }]}>
            {agency.is_active ? "Suspend" : "Reactivate"}
          </Text>
        </Pressable>

        <Pressable
          style={styles.actionBtn}
          onPress={() => { haptic(); toggleExempt.mutate(); }}
          disabled={toggleExempt.isPending}
        >
          <Ionicons name={agency.billing_exempt ? "card" : "card-outline"} size={14} color={Colors.textSecondary} />
          <Text style={styles.actionText}>{agency.billing_exempt ? "Un-exempt" : "Make Exempt"}</Text>
        </Pressable>

        {!agency.billing_exempt && (
          <Pressable
            style={styles.actionBtn}
            onPress={() => { haptic(); extend.mutate(); }}
            disabled={extend.isPending}
          >
            <Ionicons name="add-circle-outline" size={14} color={Colors.primary} />
            <Text style={[styles.actionText, { color: Colors.primary }]}>+1 Month</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Stat({ icon, value, label }: { icon: any; value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={Colors.textMuted} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function SuperAdminAgenciesScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 16 : insets.top;

  const { data: agencies, isLoading, refetch, isRefetching } = useQuery<AgencyRow[]>({
    queryKey: ["/api/super-admin/agencies"],
  });

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const totalAgencies = agencies?.length || 0;
  const activeCount = agencies?.filter((a) => a.subscription.hasAccess).length || 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>{totalAgencies} agencies · {activeCount} with active access</Text>
      </View>
      <FlatList
        data={agencies}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <AgencyCard agency={item} />}
        onRefresh={refetch}
        refreshing={isRefetching}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={styles.emptyText}>No agencies yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { justifyContent: "center", alignItems: "center", paddingVertical: 60 },
  summary: { paddingHorizontal: 16, paddingBottom: 8 },
  summaryText: { color: Colors.textSecondary, fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { padding: 16, paddingTop: 4, gap: 12 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: Colors.textPrimary, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  code: { color: Colors.textMuted, fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statValue: { color: Colors.textPrimary, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statLabel: { color: Colors.textMuted, fontSize: 12, fontFamily: "Inter_500Medium" },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnDanger: { borderColor: Colors.redBg },
  actionText: { color: Colors.textSecondary, fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyText: { color: Colors.textMuted, fontSize: 14, fontFamily: "Inter_500Medium" },
});
