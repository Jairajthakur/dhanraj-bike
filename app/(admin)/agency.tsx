import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import SubscriptionCard from "@/components/SubscriptionCard";

interface AgencyProfile {
  id: number;
  name: string;
  code: string;
  owner_name: string;
  phone: string;
}

export default function AgencyScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: agency, isLoading } = useQuery<AgencyProfile>({ queryKey: ["/api/agency"] });

  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (agency) {
      setName(agency.name || "");
      setOwnerName(agency.owner_name || "");
      setPhone(agency.phone || "");
    }
  }, [agency]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/agency", {
        name: name.trim(),
        owner_name: ownerName.trim(),
        phone: phone.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agency"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(false);
    },
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to save"),
  });

  if (isLoading || !agency) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Agency Profile</Text>
      <Text style={styles.subheading}>Your team signs in using this agency code</Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Agency Code</Text>
        <Text style={styles.codeValue} selectable>{agency.code}</Text>
        <Pressable
          style={styles.shareBtn}
          onPress={() =>
            Share.share({
              message: `Join ${agency.name} on the app.\nAgency Code: ${agency.code}\nAsk your admin for your username and password.`,
            })
          }
        >
          <Ionicons name="share-outline" size={16} color={Colors.primary} />
          <Text style={styles.shareBtnText}>Share with Staff</Text>
        </Pressable>
      </View>

      <SubscriptionCard />

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Details</Text>
          {!editing && (
            <Pressable onPress={() => setEditing(true)}>
              <Ionicons name="create-outline" size={20} color={Colors.primary} />
            </Pressable>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Agency Name</Text>
          <TextInput
            style={[styles.input, !editing && styles.inputDisabled]}
            value={name}
            onChangeText={setName}
            editable={editing}
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Owner Name</Text>
          <TextInput
            style={[styles.input, !editing && styles.inputDisabled]}
            value={ownerName}
            onChangeText={setOwnerName}
            editable={editing}
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Phone Number</Text>
          <TextInput
            style={[styles.input, !editing && styles.inputDisabled]}
            value={phone}
            onChangeText={setPhone}
            editable={editing}
            keyboardType="phone-pad"
            placeholderTextColor={Colors.textMuted}
          />
        </View>

        {editing && (
          <View style={styles.editActions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => {
                setEditing(false);
                setName(agency.name || "");
                setOwnerName(agency.owner_name || "");
                setPhone(agency.phone || "");
              }}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, saveMutation.isPending && { opacity: 0.7 }]}
              onPress={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <ActivityIndicator color={Colors.background} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingBottom: 120 },
  heading: { fontFamily: "Inter_700Bold", fontSize: 32, color: Colors.textPrimary, marginTop: 4 },
  subheading: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2, marginBottom: 20 },
  codeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 22,
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  codeLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  codeValue: { fontFamily: "Inter_700Bold", fontSize: 32, letterSpacing: 5, color: Colors.primary },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primaryDark,
    marginTop: 4,
  },
  shareBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: Colors.primary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    gap: 16,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: Colors.textPrimary },
  inputGroup: { gap: 6 },
  inputLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputDisabled: { opacity: 0.6 },
  editActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: Colors.surface2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textSecondary },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: Colors.primary,
  },
  saveBtnText: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.background },
});
