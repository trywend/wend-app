const { withProjectBuildGradle } = require("@expo/config-plugins");

// expo-updates depends on org.bouncycastle:bcprov-jdk15to18 via a dynamic
// version range ([1.81,1.82)). Resolving a range forces Gradle to fetch
// maven-metadata.xml from EVERY repo in allprojects, including jitpack.io
// (added by Expo's root template). When jitpack has a transient outage the
// metadata GET fails, Gradle disables repos, and the build dies. Pinning the
// exact versions turns this into fixed-artifact lookups that resolve from
// mavenCentral (listed before jitpack) without ever touching jitpack's
// metadata. This must apply to EVERY module (the failing resolution is in
// :expo-updates' own classpath, not :app), so it goes in the root
// build.gradle under an allprojects block.
const BLOCK = `
allprojects {
    configurations.all {
        resolutionStrategy {
            force 'org.bouncycastle:bcprov-jdk15to18:1.81'
            force 'org.bouncycastle:bcutil-jdk15to18:1.81'
        }
    }
}
`;

module.exports = function withBouncyCastlePin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes("bcprov-jdk15to18:1.81")) {
      cfg.modResults.contents += BLOCK;
    }
    return cfg;
  });
};
