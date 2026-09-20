import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth, isSubscriptionLocked } from "@/contexts/AuthContext";
import { useBilling, formatBillingDate, formatRupees } from "@/hooks/useBilling";

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { status, loading, starting, awaiting, error, startPayment, refresh, cancelWaiting } = useBilling();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const isAdmin = user?.role === "admin";
  const sub = user?.subscription;

  // Not logged in → login. Paid up (or exempt) → straight back into the app.
  useEffect(() => {
    if (!user) router.replace("/login");
    else if (!isSubscriptionLocked(user.subscription)) router.replace("/");
  }, [user]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  const price = formatRupees(sub?.amount ?? status?.subscription.amount ?? 2000);
  const wasPaying = !!sub?.subscriptionEndsAt;
  const endedOn = formatBillingDate(sub?.accessEndsAt);
  const paymentsAvailable = status?.paymentsAvailable !== false;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 40, paddingBottom: bottomPad + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed" size={40} color={Colors.primary} />
      </View>

      {isAdmin ? (
        <>
          <Text style={styles.title}>{wasPaying ? "Your subscription has ended" : "Your free trial has ended"}</Text>
          <Text style={styles.subtitle}>
            {endedOn ? `Access ended on ${endedOn}. ` : ""}Subscribe to keep {user?.agencyName || "your agency"} and your
            whole team working.
          </Text>

          <View style={styles.planCard}>
            <Text style={styles.planLabel}>Monthly plan</Text>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{price}</Text>
              <Text style={styles.perMonth}> / month</Text>
            </View>
            <View style={styles.bullets}>
              <Bullet text="Full access for you and all your FOS & Repo staff" />
              <Bullet text="Your allocation data is kept safe while you're away" />
              <Bullet text="Pay securely with UPI, cards or net banking" />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!paymentsAvailable ? (
            <Text style={styles.notice}>Online payments aren't available yet. Please contact support to renew.</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.payBtn,
              (pressed || starting) && { opacity: 0.85 },
              !paymentsAvailable && { opacity: 0.4 },
            ]}
            onPress={startPayment}
            disabled={starting || !paymentsAvailable}
          >
            {starting ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <>
                <Ionicons name="card" size={20} color={Colors.background} />
                <Text style={styles.payBtnText}>Pay {price} with Cashfree</Text>
              </>
            )}
          </Pressable>

          {awaiting ? (
            <View style={styles.waitBox}>
              <ActivityIndicator color={Colors.primary} size="small" />
              <View style={{ flex: 1 }}>
                <Text style={styles.waitTitle}>Waiting for payment confirmation…</Text>
                <Text style={styles.waitText}>
                  Finished paying? Come back here — this unlocks automatically. Or tap the button below.
                </Text>
              </View>
            </View>
          ) : null}

          <Pressable style={styles.secondaryBtn} onPress={refresh}>
            <Text style={styles.secondaryBtnText}>{awaiting ? "I've paid — check now" : "Already paid? Refresh"}</Text>
          </Pressable>
          {awaiting ? (
            <Pressable onPress={cancelWaiting} hitSlop={8}>
              <Text style={styles.linkText}>Stop waiting</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.title}>Subscription expired</Text>
          <Text style={styles.subtitle}>
            {user?.agencyName || "Your agency"}'s subscription has expired. Please ask your admin to renew it — the app
            will unlock as soon as it's paid.
          </Text>
          <Pressable style={styles.payBtn} onPress={refresh}>
            {loading ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <>
                <Ionicons name="refresh" size={20} color={Colors.background} />
                <Text style={styles.payBtnText}>Check again</Text>
              </>
            )}
          </Pressable>
        </>
      )}

      <Pressable style={styles.logout} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color={Colors.textSecondary} />
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="checkmark-circle" size={18} color={Colors.green} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 24, alignItems: "center" },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.textPrimary, textAlign: "center" },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 24,
    maxWidth: 420,
  },
  planCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 22,
    marginBottom: 20,
  },
  planLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  priceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 6, marginBottom: 16 },
  price: { fontFamily: "Inter_700Bold", fontSize: 40, color: Colors.primary },
  perMonth: { fontFamily: "Inter_500Medium", fontSize: 15, color: Colors.textSecondary, paddingBottom: 6 },
  bullets: { gap: 10 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletText: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textPrimary, flex: 1 },
  error: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.red,
    textAlign: "center",
    marginBottom: 12,
    maxWidth: 420,
  },
  notice: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.orange,
    textAlign: "center",
    marginBottom: 12,
    maxWidth: 420,
  },
  payBtn: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
  },
  payBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.background },
  waitBox: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginTop: 16,
  },
  waitTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textPrimary },
  waitText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: 2 },
  secondaryBtn: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  linkText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textMuted, marginTop: 14 },
  logout: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 32, padding: 8 },
  logoutText: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.textSecondary },
});
