// Wend — Metro config.
//
// Wraps Expo's default Metro config with NativeWind so Tailwind classes
// resolve at bundle time. `input` points at the Tailwind entry CSS that
// declares the @tailwind layers; the Paper & Ember tokens themselves live in
// the Tailwind config (tailwind.config.js) as the single source of truth.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, {
  input: "./src/theme/global.css",
});
