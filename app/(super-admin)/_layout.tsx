import React, { useEffect } from "react";
import { Pressable } from "react-native";
import { Stack, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";

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

export default function SuperAdminLayout() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user.role !== "super_admin") {
      router.replace("/login");
    }
  }, [user]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontFamily: "Inter_600SemiBold" },
        headerRight: () => <LogoutButton />,
      }}
    >
      <Stack.Screen name="agencies" options={{ title: "All Agencies" }} />
    </Stack>
  );
}
