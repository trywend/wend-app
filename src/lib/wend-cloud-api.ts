/**
 * Wend Cloud API client.
 *
 * Talks to the Tempus-hosted API Gateway endpoint that fronts the
 * cloud-agent Lambda. Auth is always a Clerk session token in the
 * Authorization header; the backend validates it via JWKS.
 *
 * The base URL is baked in at build time via EXPO_PUBLIC_TEMPUS_API_URL.
 * When unset (dev without the env), every call returns a friendly error
 * instead of hitting a placeholder.
 */
import { useAuth } from "@clerk/clerk-expo";

const BASE_URL = (process.env.EXPO_PUBLIC_TEMPUS_API_URL || "").replace(/\/$/, "");

export interface GithubStatus {
  installed: boolean;
  installation_id: number | null;
  login: string | null;
}

export interface GithubInstallUrl {
  installed: boolean;
  installation_id?: number;
  login?: string;
  install_url?: string;
  state?: string;
}

interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

class CloudApiNotConfiguredError extends Error {
  constructor() {
    super("Cloud API not configured (EXPO_PUBLIC_TEMPUS_API_URL is empty).");
    this.name = "CloudApiNotConfiguredError";
  }
}

export class CloudApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`Cloud API ${status}: ${detail}`);
    this.name = "CloudApiError";
  }
}

async function call<T>(
  path: string,
  token: string,
  opts: FetchOptions = {},
): Promise<T> {
  if (!BASE_URL) throw new CloudApiNotConfiguredError();
  const r = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let payload: unknown = null;
  try { payload = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const detail =
      (payload && typeof payload === "object" && "detail" in payload && typeof (payload as { detail: unknown }).detail === "string"
        ? (payload as { detail: string }).detail
        : `HTTP ${r.status}`);
    throw new CloudApiError(r.status, detail);
  }
  return payload as T;
}

export function useWendCloudApi() {
  const { getToken } = useAuth();

  async function authed<T>(path: string, opts: FetchOptions = {}): Promise<T> {
    const token = await getToken();
    if (!token) throw new CloudApiError(401, "Not signed in");
    return call<T>(path, token, opts);
  }

  return {
    isConfigured: Boolean(BASE_URL),
    baseUrl: BASE_URL,

    connectAnthropic(apiKey: string) {
      return authed<{ ok: boolean }>("/v1/connect/anthropic", {
        method: "POST",
        body: { api_key: apiKey },
      });
    },

    disconnectAnthropic() {
      return authed<{ ok: boolean }>("/v1/connect/anthropic", { method: "DELETE" });
    },

    githubStatus() {
      return authed<GithubStatus>("/v1/connect/github/status");
    },

    githubInstallUrl() {
      return authed<GithubInstallUrl>("/v1/connect/github/install-url");
    },

    githubRepos() {
      return authed<{
        repos: Array<{
          full_name: string;
          name: string;
          private: boolean;
          default_branch: string;
          pushed_at: string | null;
          description: string | null;
        }>;
      }>("/v1/connect/github/repos");
    },

    subscriptionStatus() {
      return authed<{
        tier: "free" | "pro" | "cloud_paygo";
        status: "active" | "past_due" | "canceled" | "none";
        current_period_end: string | null;
        cloud_used_this_month: number;
        cloud_quota_total: number;
        cloud_quota_remaining: number;
        can_pair_mac: boolean;
        overage_usd_per_dispatch: number;
        paywalls_disabled?: boolean;
      }>("/v1/subscription/status");
    },

    listRunsForNote(noteId: string, since?: number) {
      const qs = new URLSearchParams({ noteId });
      if (since !== undefined) qs.set("since", String(since));
      return authed<{
        runs: Array<{
          runId: string;
          noteId: string;
          createdAt: number;
          response: string;
          sessionId: string;
          status: "done" | "error";
          durationMs: number;
          costUsd: number;
          toolUses: string[];
          repo: string;
          agentId: string;
        }>;
      }>(`/v1/runs?${qs.toString()}`);
    },
  };
}

export function cloudApiBaseUrl() {
  return BASE_URL;
}
