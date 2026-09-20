import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth, isSubscriptionLocked } from "@/contexts/AuthContext";

export default function Index() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0F0F0F" }}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  if (isSubscriptionLocked(user.subscription)) {
    return <Redirect href="/subscription" />;
  }

  if (user.role === "admin") {
    return <Redirect href="/(admin)/users" />;
  }

  if (user.role === "repo") {
    return <Redirect href="/(repo)/search" />;
  }

  // FOS (field officer)
  return <Redirect href="/(fos)/search" />;
}
