/** Normalize club/nation display strings for alias matching. */
export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|afc|sc|ac|as|ssc|rcd|ud|cd|fk|nk|sk|bk|if|sv|tsv|vfb|vfl|fsv|1)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugId(prefix, name) {
  const body = normalizeName(name).replace(/\s+/g, "-") || "unknown";
  return `${prefix}:${body}`;
}
