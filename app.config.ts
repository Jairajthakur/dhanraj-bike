import { ExpoConfig, ConfigContext } from "expo/config";
import baseConfig from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL || 
    (replitDomain ? `https://${replitDomain}` : "https://app.dhanraj.co.in");

  const origin = replitDomain
    ? `https://${replitDomain}:3001`
    : "https://app.dhanraj.co.in";

  const androidVersionCode = process.env.ANDROID_VERSION_CODE
    ? parseInt(process.env.ANDROID_VERSION_CODE, 10)
    : baseConfig.expo.android?.versionCode;

  const appVersion = process.env.APP_VERSION_NAME || baseConfig.expo.version;

  return {
    ...baseConfig.expo,
    version: appVersion,
    android: {
      ...baseConfig.expo.android,
      versionCode: androidVersionCode,
    },
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
