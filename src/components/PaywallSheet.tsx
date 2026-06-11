/**
 * Paywall sheet — shown when a free-tier user attempts to dispatch.
 *
 * Two products: Wend Pro (Mac + cloud bundle) and Wend Cloud (paygo).
 * Free users hit this regardless of mode; the reason field carries the
 * specific context ("Mac pairing requires Pro" vs "Cloud dispatch
 * requires a subscription").
 */
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { ArrowRightIcon, CheckIcon, CloudIcon, LaptopIcon, SparkleIcon } from "phosphor-react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useAndroidBack } from "@/lib/useAndroidBack";

export interface PaywallReason {
  title: string;
  body: string;
}

export function PaywallSheet({
  open,
  reason,
  onClose,
}: {
  open: boolean;
  reason: PaywallReason | null;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  useAndroidBack(open, onClose);

  if (!open || !reason) return null;

  function handleUpgrade(plan: "pro" | "paygo") {
    // Phase 1: Stripe Checkout not wired yet. Surface a clear "billing
    // portal coming soon" so we don't dead-end the user in alpha.
    // Phase 2: deep-link into Stripe Checkout via expo-web-browser.
    Alert.alert(
      "Coming soon",
      `Billing for Wend ${plan === "pro" ? "Pro" : "Cloud"} ships next week. ` +
        `For closed-alpha access, reach out via the landing page and we'll ` +
        `flip your account manually.`,
      [
        { text: "OK" },
        {
          text: "Open landing",
          onPress: () => Linking.openURL("https://trywend.app"),
        },
      ],
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: tokens["surface-canvas"],
        zIndex: 90,
        paddingTop: 60,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingRight: 16,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text style={{ color: tokens["text-secondary"], fontFamily: "Inter-Medium", fontSize: 15 }}>
            Not now
          </Text>
        </Pressable>

        <Text
          style={{
            fontFamily: "Inter-Bold",
            fontSize: 28,
            color: tokens["text-primary"],
            letterSpacing: -0.4,
            marginTop: 20,
          }}
        >
          {reason.title}
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontFamily: "Inter-Regular",
            fontSize: 14,
            color: tokens["text-secondary"],
            lineHeight: 20,
          }}
        >
          {reason.body}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1, marginTop: 24 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <PlanCard
          tokens={tokens}
          highlighted
          icon={<LaptopIcon size={22} color={tokens["accent-on"]} weight="fill" />}
          name="Wend Pro"
          price="$12 / month"
          subprice="or $99 / year (save 31%)"
          features={[
            "Mac pairing — unlimited dispatches on your laptop",
            "50 cloud dispatches/month included",
            "Push notifications + run history",
            "Multi-device sync",
            "$0.30 per cloud dispatch over the quota",
          ]}
          ctaLabel="Get Pro"
          ctaOnPress={() => handleUpgrade("pro")}
        />

        <View style={{ height: 14 }} />

        <PlanCard
          tokens={tokens}
          icon={<CloudIcon size={22} color={tokens["text-primary"]} weight="regular" />}
          name="Wend Cloud"
          price="$0.30 per dispatch"
          subprice="Pay-as-you-go, no monthly commitment"
          features={[
            "Cloud dispatches only — no Mac required",
            "Bring your own Anthropic key (passthrough billing)",
            "Same Claude Code container as Pro",
            "Switch to Pro any time",
          ]}
          ctaLabel="Start Cloud"
          ctaOnPress={() => handleUpgrade("paygo")}
        />

        <Text
          style={{
            marginTop: 24,
            fontFamily: "Inter-Regular",
            fontSize: 12,
            color: tokens["text-tertiary"],
            textAlign: "center",
            lineHeight: 18,
          }}
        >
          Free forever: write notes locally with the full editor, markdown
          toolbar, and inbox. Dispatching to Claude is what we charge for.
        </Text>
      </ScrollView>
    </Animated.View>
  );
}

function PlanCard({
  tokens,
  highlighted,
  icon,
  name,
  price,
  subprice,
  features,
  ctaLabel,
  ctaOnPress,
}: {
  tokens: ReturnType<typeof useTheme>["tokens"];
  highlighted?: boolean;
  icon: React.ReactNode;
  name: string;
  price: string;
  subprice: string;
  features: string[];
  ctaLabel: string;
  ctaOnPress: () => void;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: highlighted ? tokens["accent-default"] : tokens["border-hairline"],
        padding: 18,
        backgroundColor: tokens["surface-elevated"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: highlighted ? tokens["accent-default"] : tokens["surface-canvas"],
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
        <Text
          style={{
            fontFamily: "Inter-Bold",
            fontSize: 18,
            color: tokens["text-primary"],
            letterSpacing: -0.2,
          }}
        >
          {name}
        </Text>
        {highlighted ? (
          <View
            style={{
              marginLeft: 6,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: tokens["accent-default"],
            }}
          >
            <Text
              style={{
                fontFamily: "Inter-SemiBold",
                fontSize: 10,
                color: tokens["accent-on"],
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              Recommended
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={{
          marginTop: 12,
          fontFamily: "Inter-Bold",
          fontSize: 26,
          color: tokens["text-primary"],
          letterSpacing: -0.4,
        }}
      >
        {price}
      </Text>
      <Text
        style={{
          marginTop: 2,
          fontFamily: "Inter-Regular",
          fontSize: 12,
          color: tokens["text-tertiary"],
        }}
      >
        {subprice}
      </Text>

      <View style={{ marginTop: 14, gap: 8 }}>
        {features.map((f) => (
          <View key={f} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <CheckIcon
              size={14}
              color={highlighted ? tokens["accent-default"] : tokens["text-secondary"]}
              weight="bold"
              style={{ marginTop: 4 }}
            />
            <Text
              style={{
                flex: 1,
                fontFamily: "Inter-Regular",
                fontSize: 13,
                color: tokens["text-secondary"],
                lineHeight: 19,
              }}
            >
              {f}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={ctaOnPress}
        style={({ pressed }) => ({
          marginTop: 18,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View
          style={{
            height: 48,
            borderRadius: 12,
            backgroundColor: highlighted ? tokens["accent-default"] : tokens["text-primary"],
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
          }}
        >
          <Text
            style={{
              fontFamily: "Inter-SemiBold",
              fontSize: 15,
              color: highlighted ? tokens["accent-on"] : tokens["surface-canvas"],
            }}
          >
            {ctaLabel}
          </Text>
          <ArrowRightIcon
            size={14}
            color={highlighted ? tokens["accent-on"] : tokens["surface-canvas"]}
            weight="bold"
          />
        </View>
      </Pressable>
    </View>
  );
}
