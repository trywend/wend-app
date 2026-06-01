/// <reference types="nativewind/types" />

// Allow side-effect imports of the Tailwind entry CSS (processed by Metro via
// NativeWind). Without this, TS flags `import "@/theme/global.css"`.
declare module "*.css";
