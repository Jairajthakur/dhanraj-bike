import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, router } from "expo-router";
import { NativeTabs, Icon, Label, Badge } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View, Pressable, Text, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface LatestNotif {
  customer_name: string;
  registration_no: string;
  source_role: string;
  fos_name: string;
}

function AlertPopup({ notif, onDismiss }: { notif: LatestNotif; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(-120)).current;
  const isRepo = notif.source_role === "repo";

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(slideY, {
        toValue: -120,
        duration: 300,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, 4500);

    return () => clearTimeout(timer);
  }, []);

  const topOffset = Platform.OS === "web" ? 67 : insets.top + 8;

  return (
    <Animated.View
      style={[
        styles.popup,
        {
          top: topOffset,
          transform: [{ translateY: slideY }],
          borderColor: isRepo ? "#FF6B35" : Colors.primary,
        },
      ]}
    >
      <Pressable style={styles.popupInner} onPress={() => { onDismiss(); router.push("/(admin)/notifications"); }}>
        <View style={[styles.popupIcon, { backgroundColor: isRepo ? "#2A0A00" : "#2A2000" }]}>
          <Ionicons name={isRepo ? "car" : "bicycle"} size={20} color={isRepo ? "#FF6B35" : Colors.primary} />
        </View>
        <View style={styles.popupBody}>
          <View style={styles.popupRow}>
            <View style={[styles.popupBadge, { borderColor: isRepo ? "#FF6B3566" : Colors.primaryDark, backgroundColor: isRepo ? "#2A0A00" : "#2A2000" }]}>
              <Text style={[styles.popupBadgeText, { color: isRepo ? "#FF6B35" : Colors.primary }]}>
                {isRepo ? "REPO" : "FOS"}
              </Text>
            </View>
            <Text style={styles.popupAgent} numberOfLines={1}>{notif.fos_name}</Text>
          </View>
          <Text style={styles.popupCustomer} numberOfLines={1}>{notif.customer_name}</Text>
          <Text style={[styles.popupReg, isRepo && { color: "#FF6B35" }]}>{notif.registration_no}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <Pressable
      onPress={async () => {
        await logout();
        router.replace("/login");
      }}
      style={{ marginRight: 16 }}
    >
      <Ionicons name="log-out-outline" size={22} color={Colors.primary} />
    </Pressable>
  );
}

function NativeTabLayout({ unreadCount }: { unreadCount: number }) {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="users">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Users</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="upload">
        <Icon sf={{ default: "square.and.arrow.up", selected: "square.and.arrow.up.fill" }} />
        <Label>Upload</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <Icon sf={{ default: "bell", selected: "bell.fill" }} />
        <Label>Alerts</Label>
        {unreadCount > 0 && <Badge>{unreadCount}</Badge>}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ unreadCount }: { unreadCount: number }) {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : Colors.surface,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.surface }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="users"
        options={{
          title: "Users",
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: "Upload",
          tabBarIcon: ({ color, size }) => <Ionicons name="cloud-upload" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications" size={size} color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
    </Tabs>
  );
}

export default function AdminLayout() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [popup, setPopup] = useState<LatestNotif | null>(null);
  const prevCountRef = useRef<number>(-1);
  const isFirstFetch = useRef(true);
  usePushNotifications();

  useEffect(() => {
    if (!user || user.role !== "admin") {
      router.replace("/login");
    }
  }, [user]);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchUnread() {
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/notifications/unread-count", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const newCount = data.count;
        setUnreadCount(newCount);

        if (!isFirstFetch.current && newCount > prevCountRef.current) {
          fetchLatestAndShowPopup();
        }
        isFirstFetch.current = false;
        prevCountRef.current = newCount;
      }
    } catch {}
  }

  async function fetchLatestAndShowPopup() {
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/notifications", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (res.ok) {
        const notifs = await res.json();
        const unread = notifs.filter((n: any) => !n.is_read);
        if (unread.length > 0) {
          const latest = unread[0];
          setPopup({
            customer_name: latest.customer_name,
            registration_no: latest.registration_no,
            source_role: latest.source_role || "fos",
            fos_name: latest.fos_name,
          });
        }
      }
    } catch {}
  }

  return (
    <View style={{ flex: 1 }}>
      {isLiquidGlassAvailable() ? (
        <NativeTabLayout unreadCount={unreadCount} />
      ) : (
        <ClassicTabLayout unreadCount={unreadCount} />
      )}
      {popup && (
        <AlertPopup
          notif={popup}
          onDismiss={() => setPopup(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  popup: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 999,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: Colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  popupInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  popupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  popupBody: { flex: 1, gap: 3 },
  popupRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  popupBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  popupBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9 },
  popupAgent: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1 },
  popupCustomer: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  popupReg: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.primary },
});
