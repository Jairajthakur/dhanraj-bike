import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { apiRequest } from "@/lib/query-client";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const registered = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (registered.current) return;
    registerForPushNotifications();
  }, []);
}

async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") return;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "9252286f-14cc-4aec-b1dc-0cd2c549cb8e",
    });

    const token = tokenData.data;
    if (!token) return;

    await apiRequest("PUT", "/api/auth/push-token", { token });
  } catch {}
}
