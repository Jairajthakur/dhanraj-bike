import { ExpoConfig, ConfigContext } from "expo/config";
import baseConfig from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 
    (replitDomain ? `https://${replitDomain}` : "https://dhanraj-bike-production.up.railway.app");

  const origin = replitDomain
    ? `https://${replitDomain}:3001`
    : "https://dhanraj-bike-production.up.railway.app";

  return {
    ...baseConfig.expo,
    owner: "jairaj123",
    extra: {
      ...baseConfig.expo.extra,
      apiUrl,
      router: {
        origin,
        headOrigin: origin,
      },
      eas: {
        projectId: "7884b502-c4a6-425e-8a00-5c64e1d39747",
      },
    },
  };
};
