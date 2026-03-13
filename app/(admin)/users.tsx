import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Platform,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";

interface User {
  id: number;
  username: string;
  role: "admin" | "fos" | "repo";
  full_name: string;
  created_at: string;
}

const ROLE_CONFIG = {
  admin: { label: "Admin", color: Colors.primary, bg: "#2A2000" },
  fos: { label: "FOS", color: Colors.blue, bg: Colors.blueBg },
  repo: { label: "Repo", color: "#FF6B35", bg: "#2A0A00" },
};

function AddUserModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (data: any) => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "fos" | "repo">("fos");
  const [isLoading, setIsLoading] = useState(false);

  async function handleCreate() {
    if (!fullName.trim() || !username.trim() || !password.trim()) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    setIsLoading(true);
    try {
      await onAdd({ full_name: fullName.trim(), username: username.trim(), password: password.trim(), role });
      setFullName("");
      setUsername("");
      setPassword("");
      setRole("fos");
      onClose();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add New User</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter full name"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Enter username"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Role</Text>
            <View style={styles.roleRow}>
              {(["fos", "repo", "admin"] as const).map((r) => (
                <Pressable
                  key={r}
                  style={[styles.roleBtn, role === r && { backgroundColor: ROLE_CONFIG[r].bg, borderColor: ROLE_CONFIG[r].color }]}
                  onPress={() => setRole(r)}
                >
                  <Text style={[styles.roleBtnText, role === r && { color: ROLE_CONFIG[r].color }]}>
                    {ROLE_CONFIG[r].label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            style={[styles.createBtn, isLoading && { opacity: 0.6 }]}
            onPress={handleCreate}
            disabled={isLoading}
          >
            {isLoading ? <ActivityIndicator color={Colors.background} /> : <Text style={styles.createBtnText}>Create User</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function UsersScreen() {
  const insets = useSafeAreaInsets();
  const { user: me, logout } = useAuth();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: usersData, isLoading, refetch } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });
  const users = usersData ?? [];

  const addMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to create user"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (e: any) => Alert.alert("Error", e.message || "Failed to delete user"),
  });

  function handleDelete(u: User) {
    if (u.id === me?.id) {
      Alert.alert("Error", "Cannot delete yourself");
      return;
    }
    Alert.alert("Delete User", `Delete ${u.full_name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(u.id) },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Users</Text>
          <Text style={styles.subheading}>Manage admin, FOS & Repo accounts</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={[styles.addBtn]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowModal(true);
            }}
          >
            <Ionicons name="add" size={22} color={Colors.background} />
          </Pressable>
          <Pressable
            onPress={async () => {
              await logout();
              router.replace("/login");
            }}
            style={styles.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={22} color={Colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={users}
        keyExtractor={(item) => item.id.toString()}
        refreshing={isLoading}
        onRefresh={refetch}
        contentContainerStyle={[styles.listContent, users.length === 0 && styles.emptyList]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No users yet</Text>
              <Text style={styles.emptySubtitle}>Add your first user</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const roleConf = ROLE_CONFIG[item.role] || ROLE_CONFIG.fos;
          return (
            <View style={styles.userCard}>
              <View style={[styles.userAvatar, { backgroundColor: roleConf.bg }]}>
                <Ionicons
                  name={item.role === "admin" ? "shield-checkmark" : item.role === "repo" ? "car" : "person"}
                  size={20}
                  color={roleConf.color}
                />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{item.full_name}</Text>
                <Text style={styles.userUsername}>@{item.username}</Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: roleConf.bg }]}>
                <Text style={[styles.roleBadgeText, { color: roleConf.color }]}>{roleConf.label}</Text>
              </View>
              {item.id !== me?.id && (
                <Pressable onPress={() => handleDelete(item)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={18} color={Colors.red} />
                </Pressable>
              )}
            </View>
          );
        }}
      />

      <AddUserModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onAdd={async (data) => {
          await addMutation.mutateAsync(data);
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 10 },
  emptyList: { flex: 1, justifyContent: "center" },
  emptyContainer: { alignItems: "center", gap: 12, paddingVertical: 48 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: Colors.textSecondary },
  emptySubtitle: { fontFamily: "Inter_400Regular", fontSize: 14, color: Colors.textMuted },
  userCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  userInfo: { flex: 1 },
  userName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.textPrimary },
  userUsername: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  roleBadgeText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.redBg,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.textPrimary },
  closeBtn: { padding: 4 },
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
  roleRow: { flexDirection: "row", gap: 10 },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.border,
  },
  roleBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: Colors.textMuted },
  createBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  createBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: Colors.background },
});
