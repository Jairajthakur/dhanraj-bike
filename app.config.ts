import { ExpoConfig, ConfigContext } from "expo/config";
import baseConfig from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const isProduction = process.env.NODE_ENV === "production" || !process.env.REPLIT_DEV_DOMAIN;
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;

  const origin = replitDomain
    ? `https://${replitDomain}:3001`
    : "https://dhanraj-production.up.railway.app";

  return {
    ...baseConfig.expo,
    owner: "jairaj123",
    extra: {
      ...baseConfig.expo.extra,
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
