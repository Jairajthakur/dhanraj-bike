import { Stack, router } from "expo-router";
import React, { useEffect } from "react";
import { Colors } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";

export default function RepoLayout() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    } else if (user.role !== "repo" && user.role !== "admin") {
      router.replace("/login");
    }
  }, [user]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    />
  );
}
