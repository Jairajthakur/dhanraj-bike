import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

interface Notification {
  id: number;
  fos_user_id: number;
  fos_name: string;
  customer_name: string;
  registration_no: string;
  allocation_id: number;
  is_read: boolean;
  created_at: string;
  source_role: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RoleBadge({ role }: { role: string }) {
  const isRepo = role === "repo";
  return (
    <View style={[styles.roleBadge, isRepo ? styles.roleBadgeRepo : styles.roleBadgeFos]}>
      <Ionicons
        name={isRepo ? "car-outline" : "bicycle-outline"}
        size={10}
        color={isRepo ? "#FF6B35" : Colors.primary}
      />
      <Text style={[styles.roleBadgeText, isRepo ? styles.roleBadgeTextRepo : styles.roleBadgeTextFos]}>
        {isRepo ? "REPO" : "FOS"}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: notificationsData, isLoading, refetch } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 10000,
  });
  const notifications = notificationsData ?? [];

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PUT", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  function handleMarkRead(n: Notification) {
    if (n.is_read) return;
    Haptics.selectionAsync();
    markReadMutation.mutate(n.id);
  }

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Alerts</Text>
          <Text style={styles.subheading}>
            {unread > 0 ? `${unread} unread notification${unread !== 1 ? "s" : ""}` : "All caught up"}
          </Text>
        </View>
        {unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unread}</Text>
          </View>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id.toString()}
        refreshing={isLoading}
        onRefresh={refetch}
        contentContainerStyle={[styles.listContent, notifications.length === 0 && styles.emptyList]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="notifications-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptySubtitle}>FOS & Repo activity will appear here</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const isRepo = item.source_role === "repo";
          const iconColor = item.is_read ? Colors.textMuted : (isRepo ? "#FF6B35" : Colors.primary);
          const iconBg = item.is_read ? Colors.surface2 : (isRepo ? "#2A0A00" : "#2A2000");
          const borderColor = item.is_read ? Colors.border : (isRepo ? "#FF6B3555" : Colors.primaryDark);
          const cardBg = item.is_read ? Colors.surface : (isRepo ? "#120500" : "#141200");
          return (
            <Pressable
              style={[styles.notifCard, !item.is_read && styles.notifCardUnread, { borderColor, backgroundColor: cardBg }]}
              onPress={() => handleMarkRead(item)}
            >
              <View style={[styles.notifIcon, { backgroundColor: iconBg }]}>
                <Ionicons
                  name={isRepo ? "car" : "bicycle"}
                  size={20}
                  color={iconColor}
                />
              </View>
              <View style={styles.notifContent}>
                <View style={styles.notifRow}>
                  <Text style={styles.notifTitle} numberOfLines={1}>{item.customer_name}</Text>
                  <Text style={styles.notifTime}>{timeAgo(item.created_at)}</Text>
                </View>
                <Text style={[styles.notifReg, isRepo && styles.notifRegRepo]}>
                  Reg: {item.registration_no}
                </Text>
                <View style={styles.notifFooter}>
                  <RoleBadge role={item.source_role || "fos"} />
                  <Text style={styles.notifFos}>Viewed by {item.fos_name}</Text>
                </View>
              </View>
              {!item.is_read && (
                <View style={[styles.unreadDot, isRepo && styles.unreadDotRepo]} />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  heading: { fontFamily: "Inter_700Bold", fontSize: 32, color: Colors.textPrimary },
  subheading: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  unreadBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    marginTop: 8,
  },
  unreadBadgeText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.background },
  listContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 10 },
  emptyList: { flex: 1, justifyContent: "center" },
  emptyContainer: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textSecondary },
  emptySubtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textMuted },
  notifCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  notifCardUnread: {
    borderColor: Colors.primaryDark,
    backgroundColor: "#141200",
  },
  notifIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  notifContent: { flex: 1, gap: 4 },
  notifRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  notifTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary, flex: 1 },
  notifTime: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginLeft: 8 },
  notifReg: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.primary },
  notifRegRepo: { color: "#FF6B35" },
  notifFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  notifFos: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  roleBadgeFos: {
    backgroundColor: "#2A2000",
    borderColor: Colors.primaryDark,
  },
  roleBadgeRepo: {
    backgroundColor: "#2A0A00",
    borderColor: "#FF6B3566",
  },
  roleBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  roleBadgeTextFos: { color: Colors.primary },
  roleBadgeTextRepo: { color: "#FF6B35" },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  unreadDotRepo: {
    backgroundColor: "#FF6B35",
  },
});
