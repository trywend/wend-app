/**
 * Wend — file / image deliverable. Image kinds render an inline preview
 * (expo-image) from the artifact URL; file kinds show an icon card with
 * name · size · mime. Both are downloadable.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { FileIcon, ImageSquareIcon } from "phosphor-react-native";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import type { Artifact } from "@/lib/notes-storage";
import { DeliverableCard, DownloadButton } from "./DownloadButton";
import { downloadFromUrl } from "./download";
import { formatBytes, useArtifactSource } from "./useArtifact";

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
  const accent = tokens["accent-default"];
  const subtle = tokens["text-secondary"];
  const tertiary = tokens["text-tertiary"];
  const border = tokens["border-hairline"];

  const { urlFor } = useArtifactSource(runId);
  const url = urlFor(artifact.id);
  const isImage = artifact.kind === "image";
  const name = artifact.name || (isImage ? "image" : "file");
  const meta = [formatBytes(artifact.size), artifact.mime]
    .filter(Boolean)
    .join(" · ");

  const [failed, setFailed] = useState(false);

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
      </DeliverableCard>
    );
  }

  return (
    <DeliverableCard icon={icon} title={name} chip={chip}>
      {isImage && url && !failed ? (
        <Pressable
          onPress={() => void save()}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Preview ${name}`}
          style={{ backgroundColor: "#111" }}
        >
          <Image
            source={{ uri: url }}
            contentFit="contain"
            transition={120}
            onError={() => setFailed(true)}
            style={{ width: "100%", height: 220 }}
          />
        </Pressable>
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
              style={{ fontFamily: "Inter-Medium", fontSize: 13.5, color: tokens["text-primary"] }}
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
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderTopWidth: 1,
          borderTopColor: border,
          flexDirection: "row",
        }}
      >
        <DownloadButton onDownload={save} />
      </View>
    </DeliverableCard>
  );
}
