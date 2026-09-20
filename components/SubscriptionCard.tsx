import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useBilling, formatBillingDate, formatRupees } from "@/hooks/useBilling";

// Admin-facing subscription status + pay/renew button. Renders nothing for
// agencies that never pay (Dhanraj Enterprises), so their screen is unchanged.
export default function SubscriptionCard() {
  const { user } = useAuth();
  const { status, starting, awaiting, error, startPayment, refresh, cancelWaiting } = useBilling();

  const sub = status?.subscription ?? user?.subscription;

  // `user.subscription` comes with login, so there's a value on first render;
  // `status` (fresher, from /api/billing/status) replaces it once loaded.
  if (!sub || sub.status === "exempt") return null;

  const price = formatRupees(sub.amount);
  const isTrial = sub.status === "trial";
  const days = sub.daysLeft ?? 0;
  const urgent = days <= 3;
  const paymentsAvailable = status?.paymentsAvailable !== false;

  const badgeColor = isTrial ? Colors.blue : urgent ? Colors.orange : Colors.green;
  const badgeBg = isTrial ? Colors.blueBg : urgent ? Colors.orangeBg : Colors.greenBg;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Subscription</Text>
        <View style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeColor }]}>
          <Text style={[styles.badgeText, { color: badgeColor }]}>{isTrial ? "FREE TRIAL" : "ACTIVE"}</Text>
        </View>
      </View>

      <Text style={styles.big}>
        {days} day{days === 1 ? "" : "s"} left
      </Text>
      <Text style={styles.sub}>
        {isTrial
          ? `Your free trial ends on ${formatBillingDate(sub.trialEndsAt)}.`
          : `Paid through ${formatBillingDate(sub.subscriptionEndsAt)}.`}
      </Text>
      <Text style={styles.hint}>
        {isTrial
          ? `Then ${price}/month. Subscribing now doesn't waste any trial days — your paid month starts when the trial ends.`
          : `Renew any time — the new month is added on top of the days you have left.`}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!paymentsAvailable ? (
        <Text style={styles.notice}>Online payments aren't available yet. Please contact support.</Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.btn,
          (pressed || starting) && { opacity: 0.85 },
          !paymentsAvailable && { opacity: 0.4 },
        ]}
        onPress={startPayment}
        disabled={starting || !paymentsAvailable}
      >
        {starting ? (
          <ActivityIndicator color={Colors.background} size="small" />
        ) : (
          <>
            <Ionicons name="card" size={18} color={Colors.background} />
            <Text style={styles.btnText}>{isTrial ? `Subscribe — ${price}/month` : `Renew 1 month — ${price}`}</Text>
          </>
        )}
      </Pressable>

      {awaiting ? (
        <View style={styles.waitRow}>
          <ActivityIndicator color={Colors.primary} size="small" />
          <Text style={styles.waitText}>Waiting for payment confirmation…</Text>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.link}>Check now</Text>
          </Pressable>
          <Pressable onPress={cancelWaiting} hitSlop={8}>
            <Text style={[styles.link, { color: Colors.textMuted }]}>Stop</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    marginBottom: 16,
    gap: 6,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.textPrimary },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 },
  big: { fontFamily: "Inter_700Bold", fontSize: 28, color: Colors.textPrimary },
  sub: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.textSecondary },
  hint: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: Colors.textMuted, marginBottom: 8 },
  error: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.red, marginBottom: 4 },
  notice: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.orange, marginBottom: 4 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 4,
  },
  btnText: { fontFamily: "Inter_700Bold", fontSize: 15, color: Colors.background },
  waitRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" },
  waitText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, flex: 1 },
  link: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: Colors.primary },
});
