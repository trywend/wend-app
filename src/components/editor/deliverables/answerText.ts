const PREAMBLE =
  /^(reading|let me|let['’]s|i['’]ll|i will|i am going to|i['’]m going to|looking at|checking|searching|fetching|exploring|investigating|scanning|opening|inspecting|gathering|running|first,? i['’]ll|first,? let)\b/i;

export function resolveAnswerText(
  answer: string | undefined,
  response: string,
): string {
  const clean = (answer ?? "").trim();
  if (clean.length > 0) return clean;

  const lines = response.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.length === 0) {
      i++;
      continue;
    }
    if (PREAMBLE.test(t) || /…$/.test(t) || /\.\.\.$/.test(t)) {
      i++;
      continue;
    }
    break;
  }
  const stripped = lines.slice(i).join("\n").trim();
  return stripped.length > 0 ? stripped : response.trim();
}
