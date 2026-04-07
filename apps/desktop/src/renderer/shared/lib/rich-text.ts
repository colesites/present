export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function normalizeEditableRichTextHtml(value: string): string | undefined {
  const normalized = value
    .replace(/&nbsp;/gi, " ")
    .replace(/<div><br><\/div>/gi, "<br>")
    .replace(/<\/div>\s*<div>/gi, "<br>")
    .replace(/^<div>/i, "")
    .replace(/<\/div>$/i, "")
    .replace(/<div>/gi, "")
    .replace(/<\/div>/gi, "<br>")
    .replace(/(<br\s*\/?>)+$/gi, "")
    .trim();

  return normalized.length > 0 ? normalized : undefined;
}
