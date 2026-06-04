/**
 * Wend — Markdown renderer.
 *
 * Renders the block list produced by `parseMarkdown` as native RN views.
 * Typography goal: prose reads as Inter prose, code reads as JetBrainsMono.
 * The agent response should feel like a richly-formatted note, not a
 * terminal scroll.
 *
 * Why a custom renderer instead of `react-native-markdown-display`:
 *   - Two extra deps + style override boilerplate just to match our tokens.
 *   - The block AST is tiny — under 200 lines of JSX to render. Cheaper to
 *     own than to wrap.
 */

import { Linking, ScrollView, View } from "react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { Block, InlineNode } from "@/lib/agentMarkdown";

export interface MarkdownProps {
  blocks: Block[];
  /** Override the base body color (defaults to text-primary). */
  textColor?: string;
  /** Renders inline only — useful in the collapsed accordion header. */
  inline?: boolean;
}

export function Markdown({ blocks, textColor, inline }: MarkdownProps) {
  const { tokens } = useTheme();
  const ink = textColor ?? tokens["text-primary"];

  if (inline) {
    // Flatten everything to inline text — used in collapsed previews.
    return (
      <Text
        style={{
          fontFamily: "Inter-Regular",
          fontSize: 14,
          lineHeight: 21,
          color: ink,
        }}
        numberOfLines={2}
      >
        {blocks.map((b, i) => (
          <InlineFlatten key={i} block={b} ink={ink} />
        ))}
      </Text>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} ink={ink} />
      ))}
    </View>
  );
}

function BlockNode({ block, ink }: { block: Block; ink: string }) {
  const { tokens } = useTheme();
  switch (block.type) {
    case "heading": {
      const size =
        block.level === 1 ? 20 : block.level === 2 ? 17 : 15;
      const weight =
        block.level === 1
          ? "Inter-Bold"
          : block.level === 2
            ? "Inter-SemiBold"
            : "Inter-SemiBold";
      return (
        <Text
          style={{
            fontFamily: weight,
            fontSize: size,
            lineHeight: size * 1.35,
            color: ink,
            letterSpacing: -0.2,
            marginTop: block.level === 1 ? 4 : 2,
          }}
        >
          {block.nodes.map((n, i) => (
            <InlineRun key={i} node={n} ink={ink} />
          ))}
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text
          style={{
            fontFamily: "Inter-Regular",
            fontSize: 14.5,
            lineHeight: 22,
            color: ink,
            letterSpacing: -0.1,
          }}
        >
          {block.nodes.map((n, i) => (
            <InlineRun key={i} node={n} ink={ink} />
          ))}
        </Text>
      );
    case "codeBlock":
      return (
        <View
          style={{
            backgroundColor: tokens["surface-canvas"],
            borderWidth: 1,
            borderColor: tokens["border-hairline"],
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {block.lang ? (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: tokens["border-hairline"],
                backgroundColor: tokens["surface-chip"],
              }}
            >
              <Text
                style={{
                  fontFamily: "JetBrainsMono-Medium",
                  fontSize: 10.5,
                  color: tokens["text-tertiary"],
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                }}
              >
                {block.lang}
              </Text>
            </View>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ padding: 12 }}
          >
            <Text
              style={{
                fontFamily: "JetBrainsMono",
                fontSize: 12.5,
                lineHeight: 19,
                color: tokens["text-primary"],
              }}
            >
              {block.code}
            </Text>
          </ScrollView>
        </View>
      );
    case "list":
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, i) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                paddingLeft: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter-Regular",
                  fontSize: 14.5,
                  lineHeight: 22,
                  color: tokens["text-tertiary"],
                  width: 22,
                }}
              >
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontFamily: "Inter-Regular",
                  fontSize: 14.5,
                  lineHeight: 22,
                  color: ink,
                  letterSpacing: -0.1,
                }}
              >
                {item.map((n, j) => (
                  <InlineRun key={j} node={n} ink={ink} />
                ))}
              </Text>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: tokens["accent-default"],
            paddingLeft: 12,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              fontFamily: "Inter-Regular",
              fontSize: 14.5,
              lineHeight: 22,
              fontStyle: "italic",
              color: tokens["text-secondary"],
            }}
          >
            {block.nodes.map((n, i) => (
              <InlineRun key={i} node={n} ink={tokens["text-secondary"]} />
            ))}
          </Text>
        </View>
      );
    case "hr":
      return (
        <View
          style={{
            height: 1,
            backgroundColor: tokens["border-hairline"],
            marginVertical: 4,
          }}
        />
      );
  }
}

function InlineRun({ node, ink }: { node: InlineNode; ink: string }) {
  const { tokens } = useTheme();
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "bold":
      return (
        <Text style={{ fontFamily: "Inter-SemiBold", color: ink }}>
          {node.nodes.map((n, i) => (
            <InlineRun key={i} node={n} ink={ink} />
          ))}
        </Text>
      );
    case "italic":
      return (
        <Text style={{ fontStyle: "italic", color: ink }}>
          {node.nodes.map((n, i) => (
            <InlineRun key={i} node={n} ink={ink} />
          ))}
        </Text>
      );
    case "code":
      return (
        <Text
          style={{
            fontFamily: "JetBrainsMono",
            fontSize: 13,
            backgroundColor: tokens["surface-chip"],
            color: tokens["text-primary"],
          }}
        >
          {` ${node.text} `}
        </Text>
      );
    case "link":
      return (
        <Text
          onPress={() => void Linking.openURL(node.href).catch(() => {})}
          style={{
            color: tokens["accent-default"],
            textDecorationLine: "underline",
          }}
        >
          {node.text}
        </Text>
      );
  }
}

function InlineFlatten({ block, ink }: { block: Block; ink: string }) {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "quote":
      return (
        <>
          {block.nodes.map((n, i) => (
            <InlineRun key={i} node={n} ink={ink} />
          ))}{" "}
        </>
      );
    case "list":
      return (
        <>
          {block.items.map((item, i) => (
            <>
              {item.map((n, j) => (
                <InlineRun key={`${i}-${j}`} node={n} ink={ink} />
              ))}
              {" · "}
            </>
          ))}
        </>
      );
    case "codeBlock":
      return <>{"(code) "}</>;
    case "hr":
      return <>{""}</>;
  }
}
