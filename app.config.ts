import { ExpoConfig, ConfigContext } from "expo/config";
import baseConfig from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;

  const devOrigin = replitDomain
    ? `https://${replitDomain}:3001`
    : "http://localhost:8082";

  return {
    ...baseConfig.expo,
    extra: {
      ...baseConfig.expo.extra,
      router: {
        origin: devOrigin,
        headOrigin: devOrigin,
      },
    },
  };
};
