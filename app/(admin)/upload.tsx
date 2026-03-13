import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const [isUploading, setIsUploading] = useState(false);
  const [replace, setReplace] = useState(false);
  const [lastResult, setLastResult] = useState<{ inserted: number; total: number } | null>(null);
  const [isRepoUploading, setIsRepoUploading] = useState(false);
  const [repoReplace, setRepoReplace] = useState(false);
  const [lastRepoResult, setLastRepoResult] = useState<{ inserted: number; total: number } | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: countData, refetch: refetchCount } = useQuery<{ count: number } | null>({
    queryKey: ["/api/allocations/count"],
  });

  const { data: repoCountData, refetch: refetchRepoCount } = useQuery<{ count: number } | null>({
    queryKey: ["/api/repo-allocations/count"],
  });

  async function handlePickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const file = result.assets[0];

      if (replace) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Replace Existing Data",
            "This will delete ALL existing allocation data and replace it with the new file. Are you sure?",
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Replace", style: "destructive", onPress: () => resolve(true) },
            ]
          );
        });
        if (!confirmed) return;
      }

      setIsUploading(true);
      setLastResult(null);

      const baseUrl = getApiUrl();
      const uploadUrl = new URL("/api/allocations/upload", baseUrl).toString();

      if (Platform.OS === "web") {
        await uploadWeb(file, uploadUrl, replace);
      } else {
        await uploadNative(file, uploadUrl, replace);
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Upload Failed", e.message || "Failed to upload file");
    } finally {
      setIsUploading(false);
    }
  }

  async function uploadWeb(
    file: DocumentPicker.DocumentPickerAsset,
    url: string,
    shouldReplace: boolean
  ) {
    const formData = new FormData();
    // On web, DocumentPicker gives us a blob: URI or a File object
    const webFile: File =
      (file as any).file instanceof File
        ? (file as any).file
        : await globalThis
            .fetch(file.uri)
            .then((r) => r.blob())
            .then(
              (blob) =>
                new File([blob], file.name, {
                  type: file.mimeType || "application/octet-stream",
                })
            );
    formData.append("file", webFile);
    formData.append("replace", shouldReplace ? "true" : "false");

    const res = await globalThis.fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Upload failed");
    setLastResult({ inserted: data.inserted, total: data.total });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    refetchCount();
  }

  async function uploadNative(
    file: DocumentPicker.DocumentPickerAsset,
    url: string,
    shouldReplace: boolean
  ) {
    // XMLHttpRequest is the most reliable method for file uploads in React Native.
    // It supports the {uri, name, type} FormData syntax natively and uses
    // the native HTTP stack (which properly handles cookies/sessions).
    return new Promise<void>((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", {
        uri: file.uri,
        name: file.name || "upload.xlsx",
        type: file.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as any);
      formData.append("replace", shouldReplace ? "true" : "false");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.withCredentials = true;

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            setLastResult({ inserted: data.inserted, total: data.total });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            refetchCount();
            resolve();
          } else {
            reject(new Error(data.message || `Upload failed (${xhr.status})`));
          }
        } catch {
          reject(new Error("Failed to parse server response"));
        }
      };

      xhr.onerror = () => reject(new Error("Network error — check your connection"));
      xhr.ontimeout = () => reject(new Error("Upload timed out — try a smaller file"));
      xhr.timeout = 60000;

      xhr.send(formData);
    });
  }

  async function handleRepoPickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const file = result.assets[0];

      if (repoReplace) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Replace Repo Data",
            "This will delete ALL existing repo allocation data and replace it with the new file. Are you sure?",
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Replace", style: "destructive", onPress: () => resolve(true) },
            ]
          );
        });
        if (!confirmed) return;
      }

      setIsRepoUploading(true);
      setLastRepoResult(null);

      const baseUrl = getApiUrl();
      const uploadUrl = new URL("/api/repo-allocations/upload", baseUrl).toString();

      if (Platform.OS === "web") {
        const formData = new FormData();
        const webFile: File =
          (file as any).file instanceof File
            ? (file as any).file
            : await globalThis
                .fetch(file.uri)
                .then((r) => r.blob())
                .then((blob) => new File([blob], file.name, { type: file.mimeType || "application/octet-stream" }));
        formData.append("file", webFile);
        formData.append("replace", repoReplace ? "true" : "false");
        const res = await globalThis.fetch(uploadUrl, { method: "POST", body: formData, credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Upload failed");
        setLastRepoResult({ inserted: data.inserted, total: data.total });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refetchRepoCount();
      } else {
        await new Promise<void>((resolve, reject) => {
          const formData = new FormData();
          formData.append("file", {
            uri: file.uri,
            name: file.name || "upload.xlsx",
            type: file.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          } as any);
          formData.append("replace", repoReplace ? "true" : "false");
          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadUrl, true);
          xhr.withCredentials = true;
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) {
                setLastRepoResult({ inserted: data.inserted, total: data.total });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                refetchRepoCount();
                resolve();
              } else {
                reject(new Error(data.message || `Upload failed (${xhr.status})`));
              }
            } catch {
              reject(new Error("Failed to parse server response"));
            }
          };
          xhr.onerror = () => reject(new Error("Network error — check your connection"));
          xhr.ontimeout = () => reject(new Error("Upload timed out — try a smaller file"));
          xhr.timeout = 60000;
          xhr.send(formData);
        });
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Upload Failed", e.message || "Failed to upload file");
    } finally {
      setIsRepoUploading(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 120 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Upload Data</Text>
      <Text style={styles.subheading}>Upload allocation data from Excel file</Text>

      <View style={styles.statsCard}>
        <View style={styles.statsIcon}>
          <Ionicons name="server-outline" size={24} color={Colors.blue} />
        </View>
        <View>
          <Text style={styles.statsLabel}>Records in Database</Text>
          <Text style={styles.statsValue}>{countData?.count?.toLocaleString("en-IN") ?? "—"}</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Excel Column Format</Text>
        <Text style={styles.infoSubtitle}>Your Excel file should have these column headers:</Text>
        <View style={styles.columns}>
          {[
            "LOAN NO", "APP ID", "CUSTOMERNAME", "EMI", "EMI_DUE",
            "CBC", "LPP", "CBC+LPP", "Pos", "Bkt",
            "CUSTOMER_ADDDRESS", "FIRST_EMI_DUE_DATE", "LOAN_MATURITY_DATE",
            "ASSET_MAKE", "REGISTRATION_NO", "engine_no", "chassis_no",
            "Ten", "Number", "status", "Detail FB",
          ].map((col) => (
            <View key={col} style={styles.colBadge}>
              <Text style={styles.colText}>{col}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.replaceRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.replaceLabel}>Replace existing data</Text>
          <Text style={styles.replaceSubLabel}>Delete old records and upload fresh</Text>
        </View>
        <Switch
          value={replace}
          onValueChange={setReplace}
          trackColor={{ false: Colors.border, true: Colors.primaryDark }}
          thumbColor={replace ? Colors.primary : Colors.textMuted}
        />
      </View>

      <Pressable
        style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.85 }, isUploading && { opacity: 0.6 }]}
        onPress={handlePickAndUpload}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <ActivityIndicator color={Colors.background} />
            <Text style={styles.uploadBtnText}>Uploading...</Text>
          </>
        ) : (
          <>
            <Ionicons name="cloud-upload" size={22} color={Colors.background} />
            <Text style={styles.uploadBtnText}>Select Excel File & Upload</Text>
          </>
        )}
      </Pressable>

      {lastResult && (
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={28} color={Colors.green} />
          <View>
            <Text style={styles.successTitle}>Upload Successful</Text>
            <Text style={styles.successSubtitle}>
              {lastResult.inserted} of {lastResult.total} records inserted
            </Text>
          </View>
        </View>
      )}

      <View style={styles.noteCard}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
        <Text style={styles.noteText}>
          Only .xlsx and .xls files are supported. The first sheet of the file will be used. Maximum file size is 10MB.
        </Text>
      </View>

      <View style={styles.sectionDivider}>
        <View style={styles.sectionDividerLine} />
        <View style={styles.sectionDividerBadge}>
          <Ionicons name="car-outline" size={14} color="#FF6B35" />
          <Text style={styles.sectionDividerText}>Repo Allocations</Text>
        </View>
        <View style={styles.sectionDividerLine} />
      </View>

      <View style={styles.statsCard}>
        <View style={[styles.statsIcon, { backgroundColor: "#2A0A00" }]}>
          <Ionicons name="car-outline" size={24} color="#FF6B35" />
        </View>
        <View>
          <Text style={styles.statsLabel}>Repo Records in Database</Text>
          <Text style={[styles.statsValue, { color: "#FF6B35" }]}>
            {repoCountData?.count?.toLocaleString("en-IN") ?? "—"}
          </Text>
        </View>
      </View>

      <View style={styles.replaceRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.replaceLabel}>Replace existing repo data</Text>
          <Text style={styles.replaceSubLabel}>Delete old repo records and upload fresh</Text>
        </View>
        <Switch
          value={repoReplace}
          onValueChange={setRepoReplace}
          trackColor={{ false: Colors.border, true: "#5A2000" }}
          thumbColor={repoReplace ? "#FF6B35" : Colors.textMuted}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.uploadBtn,
          { backgroundColor: "#FF6B35" },
          pressed && { opacity: 0.85 },
          isRepoUploading && { opacity: 0.6 },
        ]}
        onPress={handleRepoPickAndUpload}
        disabled={isRepoUploading}
      >
        {isRepoUploading ? (
          <>
            <ActivityIndicator color={Colors.background} />
            <Text style={styles.uploadBtnText}>Uploading...</Text>
          </>
        ) : (
          <>
            <Ionicons name="cloud-upload" size={22} color={Colors.background} />
            <Text style={styles.uploadBtnText}>Upload Repo Excel File</Text>
          </>
        )}
      </Pressable>

      {lastRepoResult && (
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={28} color={Colors.green} />
          <View>
            <Text style={styles.successTitle}>Repo Upload Successful</Text>
            <Text style={styles.successSubtitle}>
              {lastRepoResult.inserted} of {lastRepoResult.total} records inserted
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: 20, gap: 20 },
  heading: { fontFamily: "Inter_700Bold", fontSize: 32, color: Colors.textPrimary },
  subheading: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textSecondary, marginTop: -12 },
  statsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statsIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.blueBg,
    alignItems: "center",
    justifyContent: "center",
  },
  statsLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  statsValue: { fontFamily: "Inter_700Bold", fontSize: 28, color: Colors.textPrimary, marginTop: 2 },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  infoSubtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  colBadge: {
    backgroundColor: Colors.surface2,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  colText: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  replaceRow: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  replaceLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  replaceSubLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  uploadBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  uploadBtnText: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.background },
  successCard: {
    backgroundColor: Colors.greenBg,
    borderRadius: 14,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.green,
  },
  successTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.green },
  successSubtitle: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  noteCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  noteText: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, flex: 1, lineHeight: 20 },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  sectionDividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionDividerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2A0A00",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FF6B35",
  },
  sectionDividerText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: "#FF6B35" },
});
