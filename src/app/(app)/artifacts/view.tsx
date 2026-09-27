/**
 * SCREEN: Artifact — one artifact from the library, full size. Reuses the
 * run-card deliverable renderers (page / diff / image / file / answer) in
 * expanded mode, adds an inline text preview for text files, the note and
 * prompt it came from, and open-note / delete actions.
 *
 * NativeWind gotcha: every Pressable here with a function `style` keeps
 * layout inline; className carries non-layout only.
 */
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CaretLeftIcon, NoteIcon, TrashIcon } from "phosphor-react-native";

import { Text, Spinner } from "@/components/primitives";
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
  const accent = tokens["accent-default"];

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
        <View style={{ width: 40, height: 36, borderRadius: 8, overflow: "hidden" }}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to artifacts"
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <CaretLeftIcon size={22} color={subtle} weight="regular" />
          </Pressable>
        </View>
        <Text variant="meta" style={{ color: subtle }}>
          {artifact ? kindLabel(artifact.kind) : "Artifact"}
        </Text>
        <View style={{ width: 40, height: 36, borderRadius: 8, overflow: "hidden" }}>
          {artifact ? (
            <Pressable
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete artifact"
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <TrashIcon size={20} color={subtle} weight="regular" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!artifact ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text variant="body-em" style={{ color: subtle, textAlign: "center" }}>
            This artifact is no longer in the library.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: chip,
                borderWidth: 1,
                borderColor: border,
              }}
            >
              <ArtifactKindIcon kind={artifact.kind} size={19} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="title" selectable style={{ color: ink }}>
                {displayName(artifact)}
              </Text>
              <Text variant="caption" style={{ color: tertiary, marginTop: 4 }}>
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
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 8,
            }}
          >
            <MetaRow label="Note" value={artifact.noteTitle} subtle={tertiary} ink={ink} />
            {artifact.project ? (
              <MetaRow label="Project" value={artifact.project} subtle={tertiary} ink={ink} mono />
            ) : null}
            <MetaRow label="Type" value={artifact.mime} subtle={tertiary} ink={ink} mono />
            {hasLocalNote ? (
              <Pressable
                onPress={openNote}
                accessibilityRole="button"
                accessibilityLabel="Open the note"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <NoteIcon size={15} color={accent} weight="regular" />
                <Text variant="meta" style={{ color: accent }}>
                  Open note
                </Text>
              </Pressable>
            ) : null}
          </View>

          {artifact.prompt ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 2, borderRadius: 1, backgroundColor: accent }} />
              <Text
                variant="body"
                numberOfLines={6}
                style={{ color: subtle, flex: 1, fontSize: 15, lineHeight: 22 }}
              >
                {artifact.prompt}
              </Text>
            </View>
          ) : null}

          {artifact.available ? (
            <Preview artifact={artifact} />
          ) : (
            <Text variant="caption" style={{ color: tertiary, lineHeight: 18 }}>
              The file was removed from your Mac. The record stays so you know it existed.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetaRow({
  label,
  value,
  subtle,
  ink,
  mono,
}: {
  label: string;
  value: string;
  subtle: string;
  ink: string;
  mono?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Text variant="caption" style={{ color: subtle, width: 56 }}>
        {label}
      </Text>
      <Text
        variant={mono ? "mono-inline" : "meta"}
        numberOfLines={2}
        selectable
        style={{ color: ink, flex: 1, fontSize: 13 }}
      >
        {value}
      </Text>
    </View>
  );
}

function Preview({ artifact }: { artifact: LibraryArtifact }) {
  switch (artifact.kind) {
    case "html":
      return <HtmlDeliverable artifact={artifact} runId={artifact.runId} />;
    case "diff":
      return <DiffDeliverable artifact={artifact} runId={artifact.runId} />;
    case "image":
      return <FileDeliverable artifact={artifact} runId={artifact.runId} />;
    case "answer":
      return <AnswerPreview artifact={artifact} />;
    default:
      return (
        <View style={{ gap: 14 }}>
          <FileDeliverable artifact={artifact} runId={artifact.runId} />
          {isTextLike(artifact) ? <TextPreview artifact={artifact} /> : null}
        </View>
      );
  }
}

function AnswerPreview({ artifact }: { artifact: LibraryArtifact }) {
  const { tokens } = useTheme();
  const state = useArtifactText(artifact.runId, artifact.id, true);
  if (state.phase === "ready") {
    return <AnswerDeliverable artifact={artifact} text={state.text} />;
  }
  return <LoadState phase={state.phase} color={tokens["text-secondary"]} />;
}

function TextPreview({ artifact }: { artifact: LibraryArtifact }) {
  const { tokens } = useTheme();
  const state = useArtifactText(artifact.runId, artifact.id, artifact.size <= 2_000_000);
  const text = useMemo(
    () => (state.phase === "ready" ? state.text.slice(0, PREVIEW_CAP) : ""),
    [state],
  );
  if (artifact.size > 2_000_000) return null;
  if (state.phase !== "ready") {
    return <LoadState phase={state.phase} color={tokens["text-secondary"]} />;
  }
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: tokens["border-hairline"],
        backgroundColor: tokens["surface-chip"],
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

function LoadState({ phase, color }: { phase: string; color: string }) {
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
