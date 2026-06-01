// Wend — Babel config.
//
// `babel-preset-expo` (SDK 56) handles Hermes, Reanimated worklets, and the
// React Compiler (enabled via app.json experiments.reactCompiler). We add
// NativeWind's jsxImportSource so className props compile to RN styles.
//
// NOTE: react-native-reanimated's babel plugin is folded into babel-preset-expo
// for SDK 53+, so we do NOT add it separately (doing so double-transforms).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
