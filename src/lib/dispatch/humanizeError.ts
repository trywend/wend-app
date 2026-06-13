const GENERIC = "Something went wrong on your Mac. Give it another go?";
const UNREACHABLE =
  "Couldn't reach your Mac. Check you're both on the same Wi-Fi, then try again.";

export function humanizeDispatchError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return GENERIC;

  if (msg === "Cancelled") return msg;
  if (/Wend Pro|Wend subscription/.test(msg)) return msg;
  if (/^No Mac paired/.test(msg)) return msg;
  if (/Connection to your Mac was lost/.test(msg)) return msg;

  if (
    /Network request failed|Failed to fetch|Load failed|fetch failed|timed out|timeout|ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(
      msg,
    )
  ) {
    return UNREACHABLE;
  }

  if (/\bHTTP\b|\b5\d\d\b|server error|Internal Server/i.test(msg)) {
    return "Your Mac hit a server error. Give it another go?";
  }

  if (/Dispatch failed|reported an error result|error result/i.test(msg)) {
    return "Claude hit a snag on your Mac. Try again?";
  }

  return msg;
}
