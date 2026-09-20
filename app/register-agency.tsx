import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";

export default function RegisterAgencyScreen() {
  const insets = useSafeAreaInsets();
  const { registerAgency, user } = useAuth();
  const [agencyName, setAgencyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  async function handleCreate() {
    if (!agencyName.trim() || !ownerName.trim() || !username.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all required fields");
      return;
    }
    if (password.trim().length < 4) {
      Alert.alert("Error", "Password must be at least 4 characters");
      return;
    }
    setIsLoading(true);
    try {
      await registerAgency({
        agencyName: agencyName.trim(),
        ownerName: ownerName.trim(),
        phone: phone.trim(),
        username: username.trim(),
        password: password.trim(),
      });
      setJustCreated(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Could Not Create Agency", e.message || "Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  // Once registration succeeds, `user` is populated with the new agency's
  // code — show it prominently so the owner can share it with their staff.
  // Gated on justCreated so an already-logged-in visitor doesn't land here.
  if (justCreated && user?.agencyCode) {
    return (
      <View style={[styles.root, { paddingTop: topPad + 40, paddingBottom: bottomPad + 32 }]}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color={Colors.green} />
          </View>
          <Text style={styles.successTitle}>Agency Created</Text>
          <Text style={styles.successSubtitle}>
            Share this code with your FOS and Repo staff — they'll need it to sign in.
          </Text>

          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Your Agency Code</Text>
            <Text style={styles.codeValue} selectable>{user.agencyCode}</Text>
            <Pressable
              style={styles.shareBtn}
              onPress={() =>
                Share.share({
                  message: `Join ${user.agencyName} on the app.\nAgency Code: ${user.agencyCode}\nAsk your admin for your username and password.`,
                })
              }
            >
              <Ionicons name="share-outline" size={16} color={Colors.primary} />
              <Text style={styles.shareBtnText}>Share Code</Text>
            </Pressable>
          </View>

          <Pressable style={styles.continueBtn} onPress={() => router.replace("/")}>
            <Text style={styles.continueBtnText}>Continue to Dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: topPad + 24, paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </Pressable>

        <Text style={styles.title}>Create Your Agency</Text>
        <Text style={styles.subtitle}>
          Set up your agency profile. We'll generate a unique agency code your team will use to log in — your cases stay private to your agency.
        </Text>

        <View style={styles.card}>
          <Field label="Agency Name" value={agencyName} onChangeText={setAgencyName} placeholder="e.g. Shree Finance Recovery" />
          <Field label="Owner / Your Name" value={ownerName} onChangeText={setOwnerName} placeholder="Enter your full name" />
          <Field label="Phone Number" value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" />
          <Field label="Choose Username (Admin Login)" value={username} onChangeText={setUsername} placeholder="e.g. admin" autoCapitalize="none" />
          <Field
            label="Choose Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter password"
            secureTextEntry={!showPassword}
            rightIcon={
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.textMuted} />
              </Pressable>
            }
          />

          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.85 }, isLoading && { opacity: 0.7 }]}
            onPress={handleCreate}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <>
                <Ionicons name="business" size={20} color={Colors.background} />
                <Text style={styles.createBtnText}>Create Agency</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  rightIcon,
  ...inputProps
}: {
  label: string;
  rightIcon?: React.ReactNode;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "phone-pad";
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          placeholderTextColor={Colors.textMuted}
          autoCorrect={false}
          {...inputProps}
        />
        {rightIcon}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  container: { paddingHorizontal: 24, paddingBottom: 40 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 26, color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 24 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 18,
  },
  inputGroup: { gap: 8 },
  inputLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 14,
  },
  createBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 4,
  },
  createBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.background },

  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 6 },
  successIcon: { marginBottom: 8 },
  successTitle: { fontFamily: "Inter_700Bold", fontSize: 24, color: Colors.textPrimary },
  successSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  codeCard: {
    width: "100%",
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    alignItems: "center",
    gap: 12,
    marginBottom: 28,
  },
  codeLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  codeValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 36,
    letterSpacing: 6,
    color: Colors.primary,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primaryDark,
  },
  shareBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.primary },
  continueBtn: {
    width: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.background },
});
