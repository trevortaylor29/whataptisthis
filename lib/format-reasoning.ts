/** First `max` sentences (split on sentence-ending punctuation + space). */
export function shortenToSentences(text: string, max = 2): string {
  const t = text.trim();
  if (!t) return "";
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= max) return t;
  return parts.slice(0, max).join(" ");
}
