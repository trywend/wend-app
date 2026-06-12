/**
 * Cloud repo picker.
 *
 * Lists the repos the user's Wend Cloud GitHub App installation has
 * access to. Tap one to set it as the target for the current note's
 * next dispatch. Persisted on the note's `cwd` field (which in cloud
 * mode carries the owner/name string), so subsequent sends in the
 * same note default to the same repo without re-picking.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { CheckCircleIcon, GithubLogoIcon, MagnifyingGlassIcon } from "phosphor-react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Text } from "@/components/primitives";
import { useTheme } from "@/theme/ThemeProvider";
import { useWendCloudApi, CloudApiError } from "@/lib/wend-cloud-api";
import { useAndroidBack } from "@/lib/useAndroidBack";

interface Repo {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  description: string | null;
}

export function CloudRepoPickerSheet({
  open,
  currentRepo,
  onClose,
  onPick,
}: {
  open: boolean;
  /** Currently pinned repo (note.cwd) so we can show a checkmark. */
  currentRepo: string | null;
  onClose: () => void;
  onPick: (fullName: string) => void;
}) {
  const { tokens } = useTheme();
  const api = useWendCloudApi();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useAndroidBack(open, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.githubRepos();
      setRepos(r.repos);
    } catch (err) {
      setError(err instanceof CloudApiError ? err.detail : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (open && repos === null) void load();
  }, [open, repos, load]);

  if (!open) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: tokens["surface-canvas"],
        zIndex: 80,
        paddingTop: 60,
      }}
    >
      <View style={{ paddingHorizontal: 20 }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={{
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingRight: 16,
          }}
        >
          <Text style={{ color: tokens["text-secondary"], fontFamily: "Inter-Medium", fontSize: 15 }}>
            Cancel
          </Text>
        </Pressable>
        <Text
          style={{
            fontFamily: "Inter-Bold",
            fontSize: 26,
            color: tokens["text-primary"],
            letterSpacing: -0.4,
            marginTop: 16,
          }}
        >
          Pick a repo
        </Text>
        <Text
          style={{
            marginTop: 6,
            fontFamily: "Inter-Regular",
            fontSize: 13,
            color: tokens["text-secondary"],
            lineHeight: 19,
          }}
        >
          This note's next cloud dispatch clones the repo you pick. Leave it
          alone and Wend picks one from your note content.
        </Text>
      </View>

      {loading && repos === null ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={tokens["text-secondary"]} />
        </View>
      ) : error ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text style={{ color: tokens["status-failed"], fontFamily: "Inter-Medium", fontSize: 14 }}>
            {error}
          </Text>
          <Pressable
            onPress={load}
            accessibilityLabel="Retry"
            style={{
              marginTop: 16,
              alignSelf: "flex-start",
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: tokens["accent-default"], fontFamily: "Inter-SemiBold", fontSize: 14 }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, marginTop: 16 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        >
          {(repos ?? []).map((r) => {
            const active = r.full_name === currentRepo;
            return (
              <Pressable
                key={r.full_name}
                onPress={() => {
                  onPick(r.full_name);
                  onClose();
                }}
                accessibilityLabel={`Pick ${r.full_name}`}
                android_ripple={{ color: "rgba(0,0,0,0.08)" }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: tokens["border-hairline"],
                  }}
                >
                  <GithubLogoIcon size={20} color={tokens["text-secondary"]} weight="regular" />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: "Inter-SemiBold",
                        fontSize: 15,
                        color: tokens["text-primary"],
                      }}
                    >
                      {r.full_name}
                    </Text>
                    {r.description ? (
                      <Text
                        numberOfLines={1}
                        style={{
                          marginTop: 2,
                          fontFamily: "Inter-Regular",
                          fontSize: 12,
                          color: tokens["text-tertiary"],
                        }}
                      >
                        {r.description}
                      </Text>
                    ) : null}
                  </View>
                  {active ? (
                    <CheckCircleIcon size={20} color={tokens["accent-default"]} weight="fill" />
                  ) : (
                    <Text
                      style={{
                        fontFamily: "JetBrainsMono-Medium",
                        fontSize: 11,
                        color: tokens["text-tertiary"],
                      }}
                    >
                      {r.default_branch}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
          {(!repos || repos.length === 0) && !loading ? (
            <View style={{ paddingTop: 24, alignItems: "center" }}>
              <MagnifyingGlassIcon size={32} color={tokens["text-tertiary"]} weight="light" />
              <Text
                style={{
                  marginTop: 12,
                  fontFamily: "Inter-Regular",
                  fontSize: 14,
                  color: tokens["text-secondary"],
                  textAlign: "center",
                }}
              >
                No repos accessible. Open Settings → Cloud → Repo access and
                add one on GitHub.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </Animated.View>
  );
}
