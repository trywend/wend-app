/**
 * Wend — font registration map for expo-font's useFonts.
 *
 * Inter (UI + body) and JetBrains Mono (code / file chips / diffs). No serif
 * (Design Doc § 3.2). We register the specific weights the scale uses (400 /
 * 500 / 600) under stable family names that the Tailwind config references
 * (Inter, Inter-Medium, Inter-SemiBold, JetBrainsMono, JetBrainsMono-Medium).
 *
 * The @expo-google-fonts packages ship the static TTFs; we alias them to our
 * own names so component className strings stay short and font-family swaps
 * stay centralized here.
 */
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";

export const fontMap = {
  Inter: Inter_400Regular,
  "Inter-Medium": Inter_500Medium,
  "Inter-SemiBold": Inter_600SemiBold,
  JetBrainsMono: JetBrainsMono_400Regular,
  "JetBrainsMono-Medium": JetBrainsMono_500Medium,
};
