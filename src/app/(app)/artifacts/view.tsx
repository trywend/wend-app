/**
 * SCREEN: Artifact — one artifact from the library, full size. Reuses the
 * run-card deliverable renderers (page / diff / image / file / answer) in
 * expanded mode, adds an inline text preview for text files, the note and
 * prompt it came from, and open-note / delete actions.
 *
 * NativeWind 4 drops every property a function-form Pressable `style` returns,
 * so every tappable here goes through PressableSurface.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CaretLeftIcon, CaretRightIcon, TrashIcon } from "phosphor-react-native";

import { IconButton, PressableSurface, Spinner, Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useArtifactsCache } from "@/store/artifactsCacheSlice";
import { useArtifactsLibrary } from "@/lib/artifacts/useArtifactsLibrary";
import {
  displayName,
  isTextLike,
  kindLabel,
  libraryKey,
  type LibraryArtifact,
} from "@/lib/artifacts/api";
import { getNote } from "@/lib/notes-storage";
import { requestOpenNote } from "@/lib/notifications";
import { ArtifactKindIcon } from "@/components/artifacts/ArtifactKindIcon";
import { AnswerDeliverable } from "@/components/editor/deliverables/AnswerDeliverable";
import { DiffDeliverable } from "@/components/editor/deliverables/DiffDeliverable";
import { FileDeliverable } from "@/components/editor/deliverables/FileDeliverable";
import { HtmlDeliverable } from "@/components/editor/deliverables/HtmlDeliverable";
import {
  formatBytes,
  useArtifactText,
} from "@/components/editor/deliverables/useArtifact";

const PREVIEW_CAP = 60_000;
const PROMPT_LINES = 6;
const DIMMED = { opacity: 0.6 } as const;

export default function ArtifactScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ runId: string; id: string }>();
  const key = libraryKey({ runId: params.runId ?? "", id: params.id ?? "" });
  const artifact = useArtifactsCache((s) => s.list.find((a) => libraryKey(a) === key));
  const { remove } = useArtifactsLibrary();

  const [hasLocalNote, setHasLocalNote] = useState(false);
  useEffect(() => {
    if (!artifact?.noteId) return;
    let alive = true;
    void getNote(artifact.noteId).then((n) => {
      if (alive) setHasLocalNote(Boolean(n));
    });
    return () => {
      alive = false;
    };
  }, [artifact?.noteId]);

  const canvas = tokens["surface-canvas"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const chip = tokens["surface-chip"];
  const failed = tokens["status-failed"];

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/artifacts");
  }

  function openNote() {
    if (!artifact) return;
    requestOpenNote(artifact.noteId);
    router.dismissAll();
  }

  function confirmDelete() {
    if (!artifact) return;
    Alert.alert(
      `Delete “${displayName(artifact)}”?`,
      "It is removed from your Mac. The note itself is not affected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            remove(artifact)
              .then(goBack)
              .catch(() =>
                Alert.alert("Could not delete", "Your Mac did not respond. Try again."),
              );
          },
        },
      ],
    );
  }

  const removed = artifact ? !artifact.available : false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: canvas }} edges={["top", "bottom"]}>
      <View
        style={{
          height: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: border,
        }}
      >
        <IconButton onPress={goBack} accessibilityLabel="Back to artifacts">
          <CaretLeftIcon size={22} color={subtle} weight="regular" />
        </IconButton>
        <Text variant="meta" style={{ color: subtle }}>
          {artifact ? kindLabel(artifact.kind) : "Artifact"}
        </Text>
        <View style={{ width: 40, height: 40 }} />
      </View>

      {!artifact ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 32,
            paddingBottom: 48,
          }}
        >
          <Text variant="body-em" style={{ color: subtle, textAlign: "center", maxWidth: 280 }}>
            This artifact is no longer in the library.
          </Text>
          <PressableSurface
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to artifacts"
            hitSlop={14}
            style={{ marginTop: 16 }}
            pressedStyle={DIMMED}
          >
            <Text variant="meta" style={{ color: tokens["accent-default"] }}>
              Back to artifacts
            </Text>
          </PressableSurface>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 48,
            gap: 24,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: removed ? "transparent" : chip,
                borderWidth: 1,
                borderColor: border,
                flexShrink: 0,
              }}
            >
              <ArtifactKindIcon
                kind={artifact.kind}
                size={20}
                color={removed ? tertiary : subtle}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="title" selectable numberOfLines={3} style={{ color: ink }}>
                {displayName(artifact)}
              </Text>
              <Text variant="meta" style={{ color: tertiary, marginTop: 4 }}>
                {[
                  formatBytes(artifact.size),
                  new Date(artifact.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>

          <View
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: border,
              backgroundColor: tokens["surface-elevated"],
              overflow: "hidden",
            }}
          >
            {hasLocalNote ? (
              <PressableSurface
                onPress={openNote}
                accessibilityRole="button"
                accessibilityLabel="Open the note"
                pressedStyle={{ backgroundColor: chip }}
              >
                <MetaRow label="Note" value={artifact.noteTitle} trailing />
              </PressableSurface>
            ) : (
              <MetaRow label="Note" value={artifact.noteTitle} />
            )}
            {artifact.project ? (
              <>
                <Hairline />
                <MetaRow label="Project" value={artifact.project} mono />
              </>
            ) : null}
            <Hairline />
            <MetaRow label="Type" value={artifact.mime} mono />
          </View>

          {artifact.prompt ? <PromptQuote prompt={artifact.prompt} /> : null}

          {artifact.available ? (
            <Preview artifact={artifact} />
          ) : (
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: border, padding: 14 }}>
              <Text variant="meta" style={{ color: subtle }}>
                Removed from your Mac
              </Text>
              <Text variant="caption" style={{ color: tertiary, marginTop: 4 }}>
                The record stays so you know it existed.
              </Text>
            </View>
          )}

          <View
            style={{
              borderRadius: 12,
              borderWidth: 1,
              borderColor: border,
              overflow: "hidden",
              marginTop: 8,
            }}
          >
            <PressableSurface
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete from Mac"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                height: 48,
              }}
              pressedStyle={{ backgroundColor: chip }}
            >
              <TrashIcon size={18} color={failed} weight="regular" />
              <Text variant="body-em" style={{ color: failed, fontSize: 15 }}>
                Delete from Mac
              </Text>
            </PressableSurface>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Hairline() {
  const { tokens } = useTheme();
  return <View style={{ height: 1, backgroundColor: tokens["border-hairline"] }} />;
}

function MetaRow({
  label,
  value,
  mono,
  trailing,
}: {
  label: string;
  value: string;
  mono?: boolean;
  trailing?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 44,
      }}
    >
      <Text variant="caption" style={{ color: tokens["text-tertiary"], width: 64 }}>
        {label}
      </Text>
      <Text
        variant={mono ? "mono-inline" : "meta"}
        numberOfLines={2}
        selectable
        style={[{ color: tokens["text-primary"], flex: 1 }, mono ? { fontSize: 13 } : null]}
      >
        {value}
      </Text>
      {trailing ? (
        <CaretRightIcon size={14} color={tokens["text-tertiary"]} weight="regular" />
      ) : null}
    </View>
  );
}

function PromptQuote({ prompt }: { prompt: string }) {
  const { tokens } = useTheme();
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const subtle = tokens["text-secondary"];
  const textStyle = { color: subtle, fontSize: 15, lineHeight: 22 };

  return (
    <View>
      <Text
        variant="caption"
        style={{
          color: tokens["text-tertiary"],
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 8,
        }}
      >
        Prompt
      </Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ width: 2, borderRadius: 1, backgroundColor: tokens["border-default"] }} />
        <View style={{ flex: 1 }}>
          <Text
            variant="body"
            selectable
            numberOfLines={expanded ? undefined : PROMPT_LINES}
            style={textStyle}
          >
            {prompt}
          </Text>
          {/* Unclamped twin measures the real line count; a clamped Text's
              onTextLayout reports different things on iOS and Android. */}
          <Text
            variant="body"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={(e) => setOverflows(e.nativeEvent.lines.length > PROMPT_LINES)}
            style={[textStyle, { position: "absolute", left: 0, right: 0, top: 0, opacity: 0 }]}
          >
            {prompt}
          </Text>
        </View>
      </View>
      {overflows ? (
        <View style={{ alignItems: "flex-start" }}>
          <PressableSurface
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Show less" : "Show all"}
            hitSlop={12}
            style={{ marginTop: 6 }}
            pressedStyle={DIMMED}
          >
            <Text variant="meta" style={{ color: subtle }}>
              {expanded ? "Show less" : "Show all"}
            </Text>
          </PressableSurface>
        </View>
      ) : null}
    </View>
  );
}

function Preview({ artifact }: { artifact: LibraryArtifact }) {
  switch (artifact.kind) {
    case "html":
      return <HtmlDeliverable artifact={artifact} runId={artifact.runId} flush />;
    case "diff":
      return <DiffDeliverable artifact={artifact} runId={artifact.runId} flush />;
    case "image":
      return <FileDeliverable artifact={artifact} runId={artifact.runId} flush />;
    case "answer":
      return <AnswerPreview artifact={artifact} />;
    default:
      return (
        <View style={{ gap: 12 }}>
          <FileDeliverable artifact={artifact} runId={artifact.runId} flush />
          {isTextLike(artifact) ? <TextPreview artifact={artifact} /> : null}
        </View>
      );
  }
}

function AnswerPreview({ artifact }: { artifact: LibraryArtifact }) {
  const state = useArtifactText(artifact.runId, artifact.id, true);
  if (state.phase === "ready") {
    return <AnswerDeliverable artifact={artifact} text={state.text} flush />;
  }
  return <LoadState phase={state.phase} />;
}

function TextPreview({ artifact }: { artifact: LibraryArtifact }) {
  const { tokens } = useTheme();
  const state = useArtifactText(artifact.runId, artifact.id, artifact.size <= 2_000_000);
  const text = useMemo(
    () => (state.phase === "ready" ? state.text.slice(0, PREVIEW_CAP) : ""),
    [state],
  );
  if (artifact.size > 2_000_000) return null;
  if (state.phase !== "ready") return <LoadState phase={state.phase} />;
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        backgroundColor: tokens["surface-chip"],
        overflow: "hidden",
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          variant="mono-body"
          selectable
          style={{ color: tokens["text-primary"], fontSize: 12.5, lineHeight: 19, padding: 14 }}
        >
          {text}
        </Text>
      </ScrollView>
      {state.text.length > PREVIEW_CAP ? (
        <Text
          variant="caption"
          style={{ color: tokens["text-tertiary"], paddingHorizontal: 14, paddingBottom: 12 }}
        >
          Preview trimmed. Download for the full file.
        </Text>
      ) : null}
    </View>
  );
}

function LoadState({ phase }: { phase: string }) {
  const { tokens } = useTheme();
  const color = tokens["text-secondary"];
  if (phase === "loading") {
    return (
      <View style={{ paddingVertical: 24, alignItems: "center" }}>
        <Spinner size={20} color={color} />
      </View>
    );
  }
  const message =
    phase === "gone"
      ? "No longer on your Mac."
      : phase === "unavailable"
        ? "Pair your Mac to open this."
        : "Could not reach your Mac.";
  return (
    <Text variant="caption" style={{ color, paddingVertical: 12 }}>
      {message}
    </Text>
  );
}
