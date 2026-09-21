/**
 * withAndroidReleaseSigning
 *
 * `expo prebuild --clean` regenerates the android/ folder from scratch on
 * every CI run, so any manual edits to android/app/build.gradle don't
 * persist. This config plugin re-injects the release signing config every
 * time prebuild runs, so `./gradlew assembleRelease` / `bundleRelease`
 * always produce a properly-signed (not debug-signed) build.
 *
 * It does NOT contain any secrets itself. Instead it makes build.gradle read
 * android/keystore.properties at build time. That file is created by CI
 * (see .github/workflows/build-apk.yml) from GitHub Actions secrets, right
 * after prebuild runs -- it never touches this repo.
 *
 * If keystore.properties is missing (e.g. a local dev build), the release
 * build type silently falls back to Android's default debug signing, so
 * `npx expo prebuild` + local builds keep working without any setup.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

const SIGNING_CONFIG_MARKER = "// BEGIN withAndroidReleaseSigning";

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(SIGNING_CONFIG_MARKER)) {
      return config;
    }

    const injected = `
${SIGNING_CONFIG_MARKER}
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
def hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
// END withAndroidReleaseSigning
`;

    let contents = config.modResults.contents;

    // Insert the property-loading block right before the "android {" block.
    contents = contents.replace(
      /android\s*\{/,
      `${injected}\nandroid {`
    );

    // Add a signingConfigs.release block right after signingConfigs.debug
    // (matched by its known literal contents from the RN/Expo template),
    // so it sits as a sibling of "debug", not nested inside it. This regex
    // only matches a debug-only signingConfigs block (debug's "}" directly
    // followed by signingConfigs' closing "}"), so it's naturally
    // idempotent -- once release{} is inserted between them, re-running
    // prebuild won't match or double-insert.
    contents = contents.replace(
      /(signingConfigs\s*\{\s*debug\s*\{[^}]*\}\s*)\}/,
      `$1
        if (hasReleaseKeystore) {
            release {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }`
    );

    // Point the "release" build type (not "debug") at signingConfigs.release
    // when a release keystore is present. Anchored to "release {" so this
    // never matches the debug build type's identical-looking line.
    contents = contents.replace(
      /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug`
    );

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withAndroidReleaseSigning;
