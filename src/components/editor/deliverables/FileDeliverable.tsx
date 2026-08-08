/**
 * Wend — file / image deliverable. Image kinds render an inline preview
 * (expo-image) from the token'd artifact URL; tap opens a fullscreen viewer.
 * File kinds show an icon card with name · size · mime. Both are downloadable.
 * A 404 (evicted by the daemon's GC) degrades to a "no longer available" panel
 * rather than a broken image.
 */
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import {
  ArrowsOutSimpleIcon,
  FileIcon,
  ImageBrokenIcon,
  ImageSquareIcon,
  XIcon,
} from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { Artifact } from "@/lib/notes-storage";
import { DeliverableCard, DownloadButton } from "./DownloadButton";
import { downloadFromUrl } from "./download";
import { Spinner } from "./Spinner";
import { formatBytes, useArtifactSource } from "./useArtifact";

type ImgPhase = "loading" | "ready" | "error";

export function FileDeliverable({
  artifact,
  runId,
  compact,
}: {
  artifact: Artifact;
  runId: string | undefined;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const accent = tokens["accent-default"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];
  const ink = tokens["text-primary"];

  const { urlFor } = useArtifactSource(runId);
  const url = urlFor(artifact.id);
  const isImage = artifact.kind === "image";
  const name = artifact.name || (isImage ? "image" : "file");
  const meta = [formatBytes(artifact.size), artifact.mime]
    .filter(Boolean)
    .join(" · ");

  const [imgPhase, setImgPhase] = useState<ImgPhase>("loading");
  const [full, setFull] = useState(false);

  const save = () =>
    url
      ? downloadFromUrl({ url, name, mime: artifact.mime || "application/octet-stream" })
      : Promise.resolve();

  const icon = isImage ? (
    <ImageSquareIcon size={13} color={accent} weight="regular" />
  ) : (
    <FileIcon size={13} color={accent} weight="regular" />
  );
  const chip = isImage ? "Image" : "File";

  if (compact) {
    return (
      <DeliverableCard icon={icon} title={name} chip={chip}>
        {isImage && url && imgPhase !== "error" ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 8,
                overflow: "hidden",
                backgroundColor: "#111",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                source={{ uri: url }}
                contentFit="cover"
                transition={120}
                onError={() => setImgPhase("error")}
                style={{ width: "100%", height: "100%" }}
              />
            </View>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily: "JetBrainsMono",
                fontSize: 12,
                color: tertiary,
                letterSpacing: -0.2,
              }}
            >
              {meta || name}
            </Text>
          </View>
        ) : (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily: "JetBrainsMono",
                fontSize: 12,
                color: tertiary,
                letterSpacing: -0.2,
              }}
            >
              {meta || name}
            </Text>
          </View>
        )}
      </DeliverableCard>
    );
  }

  return (
    <>
      <DeliverableCard icon={icon} title={name} chip={chip}>
        {isImage && url && imgPhase !== "error" ? (
          <Pressable
            onPress={() => setFull(true)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Open ${name} fullscreen`}
            style={{ backgroundColor: "#111" }}
          >
            <Image
              source={{ uri: url }}
              contentFit="contain"
              transition={120}
              onLoad={() => setImgPhase("ready")}
              onError={() => setImgPhase("error")}
              style={{ width: "100%", height: 220 }}
            />
            {imgPhase === "loading" ? (
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Spinner size={18} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        ) : isImage ? (
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 20,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <ImageBrokenIcon size={22} color={subtle} weight="regular" />
            <Text
              style={{ flex: 1, fontFamily: "Inter-Regular", fontSize: 13, color: tertiary }}
            >
              {url
                ? "This image is no longer on your Mac."
                : "Pair your Mac to view this image."}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => void save()}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}`}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <FileIcon size={22} color={subtle} weight="regular" />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: "Inter-Medium", fontSize: 13.5, color: ink }}
              >
                {name}
              </Text>
              {meta ? (
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 2,
                    fontFamily: "JetBrainsMono",
                    fontSize: 11,
                    color: tertiary,
                  }}
                >
                  {meta}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
        {isImage && imgPhase === "error" ? null : (
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: border,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            {isImage && url && imgPhase === "ready" ? (
              <Pressable
                onPress={() => setFull(true)}
                accessibilityRole="button"
                accessibilityLabel="Open fullscreen"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  height: 34,
                  paddingHorizontal: 14,
                  borderRadius: 17,
                  borderWidth: 1,
                  borderColor: border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <ArrowsOutSimpleIcon size={15} color={accent} weight="regular" />
                <Text style={{ fontFamily: "Inter-SemiBold", fontSize: 13, color: accent }}>
                  Fullscreen
                </Text>
              </Pressable>
            ) : null}
            <DownloadButton onDownload={save} />
          </View>
        )}
      </DeliverableCard>

      {full && isImage && url ? (
        <Modal
          visible
          animationType="fade"
          presentationStyle="fullScreen"
          onRequestClose={() => setFull(false)}
        >
          <View style={{ flex: 1, backgroundColor: "#000", paddingTop: insets.top }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontFamily: "Inter-SemiBold", fontSize: 14, color: "#fff" }}
              >
                {name}
              </Text>
              <Pressable
                onPress={() => setFull(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={10}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <XIcon size={20} color="#fff" weight="regular" />
              </Pressable>
            </View>
            <Image
              source={{ uri: url }}
              contentFit="contain"
              transition={120}
              style={{ flex: 1, width: "100%" }}
            />
          </View>
        </Modal>
      ) : null}
    </>
  );
}
