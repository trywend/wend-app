/**
 * Wend — NoteActionsSheet.
 *
 * Small auto-height bottom sheet (z=60) shown when the user long-presses a
 * note card in the inbox. Two actions:
 *
 *   - Archive — fires onArchive(noteId) and closes
 *   - Delete  — moves the sheet into a confirmation view (replaces the
 *               action list with copy + Cancel/Delete buttons). The second
 *               tap on Delete fires onDelete(noteId) and closes.
 *
 * The confirmation step is in-place rather than a stacked sheet because
 * the founder's mock keeps the destructive flow inside a single surface
 * (one panel, two states) — simpler model, fewer modal layers.
 *
 * Auto-height: no fixed `height` on the panel; content-fit. We still cap
 * with `maxHeight` so a stupendously long title can't push the sheet to
 * the top of the screen.
 *
 * Reset behavior: when `open` flips false we unmount entirely (return null);
 * on next open the confirmation state starts back at "actions". This is
 * what we want — long-pressing a different note should never inherit a
 * mid-confirmation state from a previous one.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from "react-native-reanimated";
import {
  ArchiveIcon,
  TrashIcon,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";

export interface NoteActionsSheetProps {
  open: boolean;
  noteId: string | null;
  noteTitle: string | null;
  onClose: () => void;
  onArchive: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

export function NoteActionsSheet(
  props: NoteActionsSheetProps,
): React.JSX.Element | null {
  if (!props.open) return null;
  return <NoteActionsSheetMounted {...props} />;
}

function NoteActionsSheetMounted({
  noteId,
  noteTitle,
  onClose,
  onArchive,
  onDelete,
}: NoteActionsSheetProps) {
  const { tokens } = useTheme();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canvasBg = tokens["surface-canvas"];
  const inkColor = tokens["text-primary"];
  const subtleColor = tokens["text-secondary"];
  const tertiaryColor = tokens["text-tertiary"];
  const borderColor = tokens["border-hairline"];
  const failedColor = tokens["status-failed"];

  function handleArchive() {
    if (noteId) onArchive(noteId);
    onClose();
  }
  function handleDeleteConfirm() {
    if (noteId) onDelete(noteId);
    onClose();
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
      }}
      pointerEvents="box-none"
    >
      {/* Backdrop. */}
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(160)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.32)",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.duration(240)}
        exiting={SlideOutDown.duration(200)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: canvasBg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderWidth: 1,
          borderColor: borderColor,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.1,
          shadowRadius: 24,
          elevation: 12,
          overflow: "hidden",
          maxHeight: "70%",
          paddingBottom: 24,
        }}
      >
        {/* Drag handle */}
        <View
          style={{
            width: "100%",
            paddingTop: 10,
            paddingBottom: 8,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              backgroundColor: tertiaryColor,
            }}
          />
        </View>

        {/* Title row — note title (truncated to a single line). */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 4,
            paddingBottom: 16,
          }}
        >
          <Text
            variant="body-em"
            numberOfLines={1}
            style={{ color: inkColor }}
          >
            {noteTitle ?? "Untitled"}
          </Text>
        </View>

        {confirmingDelete ? (
          <View
            style={{ paddingHorizontal: 20, paddingTop: 4, gap: 16 }}
          >
            <Text variant="body" style={{ color: inkColor }}>
              Delete this note? This cannot be undone.
            </Text>
            <View
              style={{
                flexDirection: "row",
                gap: 12,
                marginTop: 4,
              }}
            >
              {/* Cancel — outlined. Wrapper-View pattern (cssInterop). */}
              <Pressable
                onPress={() => setConfirmingDelete(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    height: 48,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: borderColor,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: inkColor,
                      fontFamily: "Inter-SemiBold",
                      fontSize: 15,
                    }}
                  >
                    Cancel
                  </Text>
                </View>
              </Pressable>

              {/* Delete — destructive fill. */}
              <Pressable
                onPress={handleDeleteConfirm}
                accessibilityRole="button"
                accessibilityLabel="Delete"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View
                  style={{
                    height: 48,
                    borderRadius: 12,
                    backgroundColor: failedColor,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontFamily: "Inter-SemiBold",
                      fontSize: 15,
                    }}
                  >
                    Delete
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        ) : (
          <View>
            <ActionRow
              Icon={ArchiveIcon}
              label="Archive"
              labelColor={inkColor}
              iconColor={subtleColor}
              onPress={handleArchive}
            />
            <View
              style={{
                height: 1,
                backgroundColor: borderColor,
                marginHorizontal: 20,
              }}
            />
            <ActionRow
              Icon={TrashIcon}
              label="Delete"
              labelColor={failedColor}
              iconColor={failedColor}
              onPress={() => setConfirmingDelete(true)}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function ActionRow({
  Icon,
  label,
  labelColor,
  iconColor,
  onPress,
}: {
  Icon: PhosphorIcon;
  label: string;
  labelColor: string;
  iconColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 24,
          paddingVertical: 16,
        }}
      >
        <Icon size={22} color={iconColor} weight="regular" />
        <Text
          style={{
            marginLeft: 14,
            color: labelColor,
            fontFamily: "Inter-Medium",
            fontSize: 16,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
