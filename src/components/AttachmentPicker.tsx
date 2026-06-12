/**
 * Wend — AttachmentPicker.
 *
 * Bottom sheet with two options: Photo (expo-image-picker) and Document
 * (expo-document-picker). On selection the caller receives an Attachment
 * record (already copied into the per-note attachments dir) and is
 * responsible for persisting it onto the note. Cancellation closes the
 * sheet silently.
 *
 * Why a thin bottom sheet rather than reusing primitives/Sheet: this one is
 * auto-height (two rows) and matches the visual cadence of NoteActionsSheet
 * — single backdrop + slide-up panel without the InboxSheet drag-handle
 * machinery, which would be overkill for two rows.
 *
 * NativeWind 4 + Pressable note: every Pressable here uses inline style for
 * layout/colors. className stays out of function-form styles entirely — same
 * gotcha as InboxSheet and the composer.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import { CaretRightIcon, FileIcon, ImageIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import {
  copyAttachmentIntoNote,
  type Attachment,
} from "@/lib/attachments";
import { useAndroidBack } from "@/lib/useAndroidBack";

// expo-image-picker and expo-document-picker are loaded at runtime via
// require so a dev client that was built before they were added doesn't
// crash on module eval — same pattern as expo-camera in ConnectMacSheet.
// When the native module is missing we surface a friendly "rebuild the
// dev client" panel instead of taking the whole app down.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ImagePicker: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DocumentPicker: any = null;
let pickersLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ImagePicker = require("expo-image-picker");
} catch (err) {
  pickersLoadError =
    err instanceof Error ? err.message : "expo-image-picker not available";
}
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DocumentPicker = require("expo-document-picker");
} catch (err) {
  pickersLoadError =
    pickersLoadError ||
    (err instanceof Error ? err.message : "expo-document-picker not available");
}
const pickersAvailable = Boolean(ImagePicker && DocumentPicker);

export interface AttachmentPickerProps {
  open: boolean;
  onClose: () => void;
  /** Note that owns the freshly-attached file. */
  noteId: string;
  /** Fired AFTER the file has been copied into the note's attachments dir. */
  onAttached: (attachment: Attachment) => void;
}

// MIME types we accept for the Document path. We pass the catch-all wildcard
// (asterisk slash asterisk) here rather than a narrowed list because some
// Android pickers silently filter to a single category if any specific type
// is passed. Renderer-level support is handled in FileViewerModal.
const DOC_MIME_TYPES = "*/*";

export function AttachmentPicker(props: AttachmentPickerProps) {
  if (!props.open) return null;
  return <Mounted {...props} />;
}

function Mounted({
  onClose,
  noteId,
  onAttached,
}: AttachmentPickerProps) {
  const { tokens } = useTheme();
  const [busy, setBusy] = useState(false);
  // Android back closes the picker rather than exiting the app.
  useAndroidBack(true, () => {
    if (!busy) onClose();
  });

  const surface = tokens["surface-elevated"];
  const border = tokens["border-hairline"];
  const ink = tokens["text-primary"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const accent = tokens["accent-default"];
  const chipBg = tokens["surface-chip"];

  async function pickImage() {
    if (busy) return;
    if (!pickersAvailable) {
      Alert.alert(
        "Rebuild the app to attach files",
        "Photo + document picking needs a fresh dev client. Rebuild with `npx eas-cli build --profile development --platform android` (or `ios`) and reinstall the app.",
      );
      return;
    }
    setBusy(true);
    try {
      // Permission first — iOS requires it for the limited-library API even
      // though the modern picker is technically permissionless. Cheap
      // belt-and-braces. On Android 13+ the OS only prompts for
      // READ_MEDIA_IMAGES once; "don't ask again" returns `canAskAgain:false`,
      // in which case the only path forward is the app's system Settings
      // screen — we surface that with a deeplink button.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        const canAsk = perm.canAskAgain !== false;
        Alert.alert(
          "Photos access needed",
          canAsk
            ? "Wend needs access to your photo library to attach images. You can enable it in Settings."
            : "Photos access was previously denied. Tap Open Settings to enable it for Wend.",
          canAsk
            ? [{ text: "OK", style: "default" }]
            : [
                { text: "Not now", style: "cancel" },
                {
                  text: "Open Settings",
                  onPress: () => {
                    void Linking.openSettings();
                  },
                },
              ],
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 0.92,
        // expo-image-picker copies the file into a cache directory by default —
        // we re-copy in copyAttachmentIntoNote so cache eviction doesn't take
        // the attachment with it.
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0]!;
      const meta = await copyAttachmentIntoNote({
        noteId,
        sourceUri: asset.uri,
        name: asset.fileName ?? null,
        mimeType: asset.mimeType ?? "image/jpeg",
        sizeBytes: asset.fileSize ?? null,
      });
      onAttached(meta);
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AttachmentPicker] image pick failed:", err);
      Alert.alert("Couldn't attach photo", "Something went wrong reading the file. Try again?");
    } finally {
      setBusy(false);
    }
  }

  async function pickDocument() {
    if (busy) return;
    if (!pickersAvailable) {
      Alert.alert(
        "Rebuild the app to attach files",
        "Photo + document picking needs a fresh dev client. Rebuild with `npx eas-cli build --profile development --platform android` (or `ios`) and reinstall the app.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: DOC_MIME_TYPES,
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0]!;
      const meta = await copyAttachmentIntoNote({
        noteId,
        sourceUri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        sizeBytes: asset.size ?? null,
      });
      onAttached(meta);
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[AttachmentPicker] document pick failed:", err);
      Alert.alert(
        "Couldn't attach file",
        "Something went wrong reading the file. Try again?",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 65,
      }}
      pointerEvents="box-none"
    >
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(140)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.22)",
        }}
      >
        <Pressable
          onPress={busy ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close attachment picker"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(220)}
        exiting={SlideOutDown.duration(180)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: surface,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderWidth: 1,
          borderColor: border,
          paddingTop: 12,
          paddingBottom: 32,
          paddingHorizontal: 20,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.1,
          shadowRadius: 24,
          elevation: 10,
        }}
      >
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            backgroundColor: tertiary,
            alignSelf: "center",
            marginBottom: 12,
          }}
        />

        <Text
          variant="title"
          style={{ color: ink, marginBottom: 4, paddingHorizontal: 4 }}
        >
          Attach to note
        </Text>
        <Text
          variant="meta"
          style={{ color: subtle, marginBottom: 16, paddingHorizontal: 4 }}
        >
          Staged on your Mac and read by Claude when the note runs.
        </Text>

        <PickerRow
          label="Photo"
          subtitle="From your library"
          icon={<ImageIcon size={22} color={accent} weight="regular" />}
          onPress={pickImage}
          disabled={busy}
          chipBg={chipBg}
          border={border}
          ink={ink}
          subtle={subtle}
          tertiary={tertiary}
        />
        <PickerRow
          label="Document"
          subtitle="PDF, DOCX, TXT, MD…"
          icon={<FileIcon size={22} color={accent} weight="regular" />}
          onPress={pickDocument}
          disabled={busy}
          chipBg={chipBg}
          border={border}
          ink={ink}
          subtle={subtle}
          tertiary={tertiary}
        />

        {busy ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 12,
            }}
          >
            <ActivityIndicator color={subtle} />
            <Text variant="meta" style={{ color: subtle }}>
              Copying…
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

interface PickerRowProps {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled: boolean;
  chipBg: string;
  border: string;
  ink: string;
  subtle: string;
  tertiary: string;
}

function PickerRow(props: PickerRowProps) {
  return (
    <Pressable
      onPress={props.disabled ? undefined : props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      android_ripple={{ color: "rgba(0,0,0,0.07)", borderless: false }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: props.border,
        backgroundColor: props.chipBg + "55",
        opacity: props.disabled ? 0.5 : 1,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: props.chipBg,
        }}
      >
        {props.icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body-em" style={{ color: props.ink }}>
          {props.label}
        </Text>
        <Text variant="meta" style={{ color: props.subtle }}>
          {props.subtitle}
        </Text>
      </View>
      <CaretRightIcon size={16} color={props.tertiary} weight="bold" />
    </Pressable>
  );
}
