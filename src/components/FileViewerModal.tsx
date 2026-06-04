/**
 * Wend — FileViewerModal.
 *
 * Full-height bottom sheet (88%) for previewing attachments and Mac-side
 * file paths. Renderers branch by classified kind:
 *
 *   - image  → expo-image with `contain` fit on a dark canvas
 *   - pdf    → react-native-pdf (requires a native rebuild — that's expected)
 *   - text   → JetBrainsMono ScrollView, content capped at 200 KB
 *   - docx   → "preview not supported" + Share button
 *   - xlsx   → same
 *   - other  → generic name panel + Share button
 *
 * For paths that look like they live on the user's Mac (no `file:` prefix,
 * no http(s)://), we don't try to render — we show a "this file lives on
 * your Mac" panel with a copy-to-clipboard affordance. A future daemon
 * endpoint can fetch the bytes and render in-line; that's not v1.
 *
 * Matches InboxSheet's drag-handle / slide-up / dim-backdrop pattern. The
 * pan gesture is scoped to the header strip so the body scroll inside the
 * text/pdf viewer doesn't fight it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
} from "react-native-reanimated";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import {
  ClipboardTextIcon,
  ShareNetworkIcon,
  WarningIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import {
  classifyAttachment,
  formatFileSize,
  isLocalUri,
  looksLikeMacPath,
  readTextFile,
  type AttachmentKind,
} from "@/lib/attachments";

const SPRING = { stiffness: 280, damping: 30, mass: 0.9 } as const;
const DRAG_DISMISS_PX = 80;
const DRAG_DISMISS_VELOCITY = 600;

export interface FileViewerModalProps {
  open: boolean;
  onClose: () => void;
  /** The thing to preview. Either a local file:// URI or a Mac/remote path. */
  path: string;
  mimeType?: string;
  /** Display name; falls back to the path basename. */
  name?: string;
  /** Size in bytes — only known for our own attachments. */
  sizeBytes?: number;
}

/**
 * react-native-pdf is loaded lazily. If the native module isn't linked yet
 * (the dev client predates this skill) we keep the rest of the viewer working
 * and show a fallback for the pdf branch. Resolved on first mount of the pdf
 * branch.
 */
let PdfComponentCache: React.ComponentType<{
  source: { uri: string };
  style: object;
  trustAllCerts?: boolean;
  enablePaging?: boolean;
}> | null = null;
let pdfImportAttempted = false;
function loadPdfComponent(): typeof PdfComponentCache {
  if (pdfImportAttempted) return PdfComponentCache;
  pdfImportAttempted = true;
  try {
    // Require — not import — so a missing native module manifests as a thrown
    // error in this function, not a top-level crash at module evaluation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-pdf");
    PdfComponentCache = (mod?.default ?? mod) as typeof PdfComponentCache;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[FileViewerModal] react-native-pdf unavailable:", err);
    PdfComponentCache = null;
  }
  return PdfComponentCache;
}

export function FileViewerModal(props: FileViewerModalProps) {
  if (!props.open) return null;
  return <Mounted {...props} />;
}

function Mounted({
  onClose,
  path,
  mimeType,
  name,
  sizeBytes,
}: FileViewerModalProps) {
  const { tokens } = useTheme();

  const displayName = useMemo(() => name?.trim() || basename(path), [name, path]);
  const kind: AttachmentKind = useMemo(
    () => classifyAttachment(mimeType, displayName),
    [mimeType, displayName],
  );
  const isMacPath = useMemo(() => looksLikeMacPath(path), [path]);

  /* ─── Drag-to-dismiss ─────────────────────────────────────────────── */
  const dragY = useSharedValue(0);
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dragY.value,
      [0, 300],
      [1, 0.2],
      Extrapolation.CLAMP,
    ),
  }));
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const past =
        e.translationY > DRAG_DISMISS_PX || e.velocityY > DRAG_DISMISS_VELOCITY;
      if (past) {
        dragY.value = withTiming(0, { duration: 0 });
        runOnJS(onClose)();
      } else {
        dragY.value = withSpring(0, SPRING);
      }
    });

  /* ─── Style refs ──────────────────────────────────────────────────── */
  const canvas = tokens["surface-canvas"];
  const surface = tokens["surface-elevated"];
  const border = tokens["border-hairline"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const accent = tokens["accent-default"];
  const chipBg = tokens["surface-chip"];

  /* ─── Share helper ────────────────────────────────────────────────── */
  async function handleShare() {
    try {
      if (isLocalUri(path)) {
        const ok = await Sharing.isAvailableAsync();
        if (ok) {
          await Sharing.shareAsync(path, {
            mimeType,
            dialogTitle: displayName,
          });
        } else {
          await Share.share({ url: path, title: displayName });
        }
        return;
      }
      // Mac / remote path — share as text (the path string) so the user can
      // paste it into a file:// URL bar on the Mac, AirDrop note, etc.
      await Share.share({ message: path, title: displayName });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[FileViewerModal] share failed:", err);
    }
  }

  async function handleCopyPath() {
    try {
      // Share with just the path string is the lowest-friction "copy" path
      // without pulling in another module. The user picks "Copy" in the
      // share sheet.
      await Share.share({ message: path });
    } catch (err) {
      Alert.alert("Couldn't copy", "Unable to share the path right now.");
      // eslint-disable-next-line no-console
      console.warn("[FileViewerModal] copy failed:", err);
    }
  }

  /* ─── Header chip text ────────────────────────────────────────────── */
  const chipText = useMemo(() => {
    if (mimeType) return mimeType;
    if (isMacPath) return "On Mac";
    return kind === "other" ? "File" : kind.toUpperCase();
  }, [mimeType, isMacPath, kind]);

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 90,
      }}
      pointerEvents="box-none"
    >
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(160)}
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.28)",
          },
          backdropStyle,
        ]}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close file viewer"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(260)}
        exiting={SlideOutDown.duration(200)}
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "88%",
            backgroundColor: canvas,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderColor: border,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.1,
            shadowRadius: 28,
            elevation: 12,
            overflow: "hidden",
          },
          panelStyle,
        ]}
      >
        {/* Drag handle + header — pan gesture scoped here only. */}
        <GestureDetector gesture={pan}>
          <View>
            <View
              style={{
                width: "100%",
                paddingTop: 10,
                paddingBottom: 6,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: tertiary,
                }}
              />
            </View>

            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 6,
                paddingBottom: 14,
                borderBottomWidth: 1,
                borderBottomColor: border,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  variant="body-em"
                  numberOfLines={1}
                  style={{ color: ink }}
                >
                  {displayName}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 999,
                      backgroundColor: chipBg,
                    }}
                  >
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      style={{ color: subtle, fontFamily: "JetBrainsMono" }}
                    >
                      {chipText}
                    </Text>
                  </View>
                  {typeof sizeBytes === "number" && sizeBytes > 0 ? (
                    <Text variant="caption" style={{ color: tertiary }}>
                      {formatFileSize(sizeBytes)}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <XIcon size={20} color={subtle} weight="regular" />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        {/* Body — kind-specific renderer. */}
        <View style={{ flex: 1 }}>
          {isMacPath ? (
            <MacPathPanel
              path={path}
              ink={ink}
              subtle={subtle}
              border={border}
              accent={accent}
              chipBg={chipBg}
            />
          ) : kind === "image" ? (
            <ImageView uri={path} />
          ) : kind === "pdf" ? (
            <PdfView
              uri={path}
              ink={ink}
              subtle={subtle}
              border={border}
              chipBg={chipBg}
              onShare={handleShare}
              accent={accent}
            />
          ) : kind === "text" ? (
            <TextFileView
              uri={path}
              ink={ink}
              subtle={subtle}
              tertiary={tertiary}
              surface={surface}
              border={border}
            />
          ) : kind === "docx" || kind === "xlsx" ? (
            <UnsupportedPanel
              kind={kind}
              ink={ink}
              subtle={subtle}
              accent={accent}
              border={border}
              chipBg={chipBg}
              onShare={handleShare}
            />
          ) : (
            <UnsupportedPanel
              kind="other"
              ink={ink}
              subtle={subtle}
              accent={accent}
              border={border}
              chipBg={chipBg}
              onShare={handleShare}
            />
          )}
        </View>

        {/* Footer with share action — surfaced when sharing is meaningful
            (local file or Mac path). */}
        {isLocalUri(path) ? (
          <View
            style={{
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: border,
              backgroundColor: surface,
            }}
          >
            <FooterButton
              icon={
                <ShareNetworkIcon size={18} color={accent} weight="regular" />
              }
              label="Share"
              onPress={handleShare}
              accent={accent}
              chipBg={chipBg}
              border={border}
            />
          </View>
        ) : isMacPath ? (
          <View
            style={{
              padding: 16,
              borderTopWidth: 1,
              borderTopColor: border,
              backgroundColor: surface,
            }}
          >
            <FooterButton
              icon={
                <ClipboardTextIcon size={18} color={accent} weight="regular" />
              }
              label="Copy path"
              onPress={handleCopyPath}
              accent={accent}
              chipBg={chipBg}
              border={border}
            />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/* ───────────────────────────── kind renderers ─────────────────────────── */

function ImageView({ uri }: { uri: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#111",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={uri}
        contentFit="contain"
        style={{ width: "100%", height: "100%" }}
        transition={120}
      />
    </View>
  );
}

function PdfView({
  uri,
  ink,
  subtle,
  border,
  chipBg,
  accent,
  onShare,
}: {
  uri: string;
  ink: string;
  subtle: string;
  border: string;
  chipBg: string;
  accent: string;
  onShare: () => void;
}) {
  const Pdf = loadPdfComponent();
  if (!Pdf) {
    return (
      <UnsupportedPanel
        kind="other"
        message="PDF preview needs a native rebuild. Use Share to open it in another app for now."
        ink={ink}
        subtle={subtle}
        accent={accent}
        border={border}
        chipBg={chipBg}
        onShare={onShare}
      />
    );
  }
  return (
    <Pdf
      source={{ uri }}
      style={{ flex: 1, backgroundColor: "#222" }}
      trustAllCerts={false}
      enablePaging={false}
    />
  );
}

function TextFileView({
  uri,
  ink,
  subtle,
  tertiary,
  surface,
  border,
}: {
  uri: string;
  ink: string;
  subtle: string;
  tertiary: string;
  surface: string;
  border: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const MAX_BYTES = 200 * 1024;

  useEffect(() => {
    let alive = true;
    (async () => {
      const text = await readTextFile(uri, MAX_BYTES);
      if (!alive) return;
      if (text == null) {
        setError("Couldn't read this file.");
        return;
      }
      setContent(text);
      // Approximate truncation flag: if we hit exactly the cap, assume the
      // file might have been larger. False positives are harmless.
      if (text.length >= MAX_BYTES - 1) setTruncated(true);
    })();
    return () => {
      alive = false;
    };
  }, [uri]);

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <WarningIcon size={28} color={subtle} weight="regular" />
        <Text variant="body-em" style={{ color: ink, marginTop: 12 }}>
          Can't preview
        </Text>
        <Text
          variant="meta"
          style={{ color: subtle, marginTop: 4, textAlign: "center" }}
        >
          {error}
        </Text>
      </View>
    );
  }

  if (content == null) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={subtle} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: surface }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingVertical: 16,
        paddingBottom: 32,
      }}
      showsVerticalScrollIndicator
    >
      {truncated ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: border,
            marginBottom: 12,
          }}
        >
          <Text variant="meta" style={{ color: tertiary }}>
            Preview truncated at 200 KB.
          </Text>
        </View>
      ) : null}
      <Text
        style={{
          fontFamily: "JetBrainsMono",
          fontSize: 12.5,
          lineHeight: 19,
          color: ink,
        }}
        selectable
      >
        {content}
      </Text>
    </ScrollView>
  );
}

function UnsupportedPanel({
  kind,
  message,
  ink,
  subtle,
  accent,
  border,
  chipBg,
  onShare,
}: {
  kind: AttachmentKind;
  message?: string;
  ink: string;
  subtle: string;
  accent: string;
  border: string;
  chipBg: string;
  onShare: () => void;
}) {
  const label =
    message ??
    (kind === "docx"
      ? "Word document preview isn't supported yet. Use Share to open it in another app."
      : kind === "xlsx"
        ? "Spreadsheet preview isn't supported yet. Use Share to open it in another app."
        : "Preview isn't supported for this file type. Use Share to open it in another app.");
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: chipBg,
          marginBottom: 16,
        }}
      >
        <WarningIcon size={28} color={accent} weight="regular" />
      </View>
      <Text variant="body-em" style={{ color: ink, textAlign: "center" }}>
        Preview not available
      </Text>
      <Text
        variant="meta"
        style={{
          color: subtle,
          marginTop: 6,
          textAlign: "center",
          maxWidth: 280,
        }}
      >
        {label}
      </Text>
      <View style={{ height: 18 }} />
      <FooterButton
        icon={<ShareNetworkIcon size={18} color={accent} weight="regular" />}
        label="Share"
        onPress={onShare}
        accent={accent}
        chipBg={chipBg}
        border={border}
      />
    </View>
  );
}

function MacPathPanel({
  path,
  ink,
  subtle,
  border,
  accent,
  chipBg,
}: {
  path: string;
  ink: string;
  subtle: string;
  border: string;
  accent: string;
  chipBg: string;
}) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingVertical: 32,
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: chipBg,
          marginBottom: 16,
        }}
      >
        <ClipboardTextIcon size={28} color={accent} weight="regular" />
      </View>
      <Text variant="body-em" style={{ color: ink, textAlign: "center" }}>
        This file lives on your Mac
      </Text>
      <Text
        variant="meta"
        style={{
          color: subtle,
          marginTop: 6,
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        Wend can't read it from the phone yet. Copy the path and open it in
        your editor or terminal.
      </Text>
      <View
        style={{
          marginTop: 20,
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: border,
          alignSelf: "stretch",
        }}
      >
        <Text
          style={{
            fontFamily: "JetBrainsMono",
            fontSize: 13,
            color: ink,
            lineHeight: 19,
          }}
          selectable
        >
          {path}
        </Text>
      </View>
    </ScrollView>
  );
}

/* ───────────────────────────── footer button ──────────────────────────── */

function FooterButton({
  icon,
  label,
  onPress,
  accent,
  chipBg,
  border,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  accent: string;
  chipBg: string;
  border: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: pressed ? chipBg : "transparent",
      })}
    >
      {icon}
      <Text
        style={{
          fontFamily: "Inter-Medium",
          fontSize: 14,
          color: accent,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ───────────────────────────── utils ─────────────────────────────── */

function basename(path: string): string {
  if (!path) return "File";
  const trimmed = path.replace(/[\/\\]+$/, "");
  const slash = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
  );
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
