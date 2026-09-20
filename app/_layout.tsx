import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth, isSubscriptionLocked } from "@/contexts/AuthContext";
import { Colors } from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

// Sends the user to the paywall whenever their agency's trial/subscription has
// ended (from the login/me payload, a 402 from the API, or the local clock
// passing the expiry time). The server enforces this independently.
function SubscriptionGate() {
  const { user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navState = useRootNavigationState();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const locked = !!user && isSubscriptionLocked(user.subscription, now);
  const onPaywall = (segments as string[])[0] === "subscription";

  useEffect(() => {
    if (!navState?.key) return; // navigator not mounted yet
    if (locked && !onPaywall) router.replace("/subscription");
  }, [locked, onPaywall, navState?.key]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
    <SubscriptionGate />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.primary,
        headerTitleStyle: {
          color: Colors.textPrimary,
          fontFamily: "Inter_600SemiBold",
        },
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="subscription" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(admin)" options={{ headerShown: false }} />
      <Stack.Screen name="(fos)" options={{ headerShown: false }} />
      <Stack.Screen name="(repo)" options={{ headerShown: false }} />
      <Stack.Screen
        name="allocation/[id]"
        options={{
          title: "Details",
          headerShown: true,
          headerBackTitle: "Back",
        }}
      />
      <Stack.Screen
        name="repo-allocation/[id]"
        options={{
          title: "Repo Details",
          headerShown: true,
          headerBackTitle: "Back",
        }}
      />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: Colors.background }}>
          <KeyboardProvider>
            <AuthProvider>
              <RootLayoutNav />
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
