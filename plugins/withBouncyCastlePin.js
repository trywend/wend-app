const { withAppBuildGradle } = require("@expo/config-plugins");

// expo-updates depends on org.bouncycastle:bcprov-jdk15to18 via a dynamic
// version range ([1.81,1.82)). Resolving a range forces Gradle to fetch
// maven-metadata.xml from EVERY repo in allprojects, including jitpack.io
// (added by Expo's root template). When jitpack has a transient outage the
// metadata GET fails and the whole build dies. Pinning the exact version
// turns this into a fixed-artifact lookup that resolves from mavenCentral
// (listed before jitpack) without ever touching jitpack's metadata.
const FORCE = `
configurations.all {
    resolutionStrategy {
        force 'org.bouncycastle:bcprov-jdk15to18:1.81'
    }
}
`;

module.exports = function withBouncyCastlePin(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("bcprov-jdk15to18:1.81")) {
      cfg.modResults.contents += FORCE;
    }
    return cfg;
  });
};
