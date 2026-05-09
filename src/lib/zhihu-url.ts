export function extractFirstUrl(input?: string | null) {
  if (!input) {
    return "";
  }

  const match = input.match(/https?:\/\/[^\s"'<>，。；、)）\]]+/i);
  if (!match) {
    return input.trim();
  }

  try {
    return new URL(match[0]).toString();
  } catch {
    return match[0];
  }
}
