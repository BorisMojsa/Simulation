/**
 * Presentation helpers for the 1–99 ability / attribute scale.
 * Round only at display time — never write rounded values back into the model.
 */

export function roundAbilityForDisplay(raw) {
  return Number.isFinite(raw) ? Math.round(raw) : null;
}

export function formatAbilityForDisplay(raw) {
  const value = roundAbilityForDisplay(raw);
  return value === null ? "—" : String(value);
}

/**
 * Visible change badge from rounded endpoints (not from rounding the raw delta).
 */
export function abilityDisplayChange(rawBefore, rawAfter) {
  const before = roundAbilityForDisplay(rawBefore);
  const after = roundAbilityForDisplay(rawAfter);
  return before === null || after === null ? null : after - before;
}

export function formatAbilityDisplayChange(rawBefore, rawAfter, zero = "0") {
  const change = abilityDisplayChange(rawBefore, rawAfter);
  if (change === null) return "—";
  if (change === 0) return zero;
  return change > 0 ? `+${change}` : String(change);
}

/** CSS / polarity class for a displayed ability change. */
export function abilityDisplayChangeTone(rawBefore, rawAfter) {
  const change = abilityDisplayChange(rawBefore, rawAfter);
  if (change == null || change === 0) return "neutral";
  return change > 0 ? "positive" : "negative";
}

/**
 * Resolve raw before/after from a change record `{ old?, new?, change? }`.
 * Reconstructs before from new − change only when old is missing.
 */
export function rawAbilityEndpoints(record) {
  if (!record || typeof record !== "object") {
    return { rawBefore: null, rawAfter: null };
  }
  const rawAfter = Number.isFinite(record.new)
    ? record.new
    : Number.isFinite(record.after)
      ? record.after
      : null;
  let rawBefore = Number.isFinite(record.old)
    ? record.old
    : Number.isFinite(record.before)
      ? record.before
      : null;
  if (rawBefore == null && rawAfter != null && Number.isFinite(record.change)) {
    rawBefore = rawAfter - record.change;
  }
  return { rawBefore, rawAfter };
}
