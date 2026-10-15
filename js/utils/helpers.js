export function formatCurrency(amount) {
  return `GBP ${amount.toLocaleString()}`;
}

export function clubNameForDisplay(club) {
  if (!club) {
    return "Free agent";
  }
  if (typeof club === "string") {
    // Prefer resolving IDs elsewhere; never show a raw employment ID as a club name.
    if (club.startsWith("club:")) return "Unknown Club";
    return club;
  }
  return club.displayName ?? club.name ?? "Free agent";
}

export function formatOrdinal(value) {
  const abs = Math.abs(value);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = abs % 10;
  const suffix = mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

export function formatSigned(value) {
  if (value > 0) return `+${value}`;
  if (value === 0) return "0";
  return `${value}`;
}

export function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function pickRandom(list) {
  return list[randInt(0, list.length - 1)];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
