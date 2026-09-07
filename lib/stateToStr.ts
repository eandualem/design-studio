/**
 * Converts XState nested state values to dot-separated strings.
 * e.g. { idle: {} } → "idle"; { editing: { form: {} } } → "editing.form"
 */
export function convertStateToString(stateValue: unknown): string {
  if (typeof stateValue === "string") return stateValue;
  if (typeof stateValue === "object" && stateValue !== null) {
    const entries = Object.entries(stateValue as Record<string, unknown>);
    if (entries.length === 0) return "";
    const [key, value] = entries[0];
    const nested = convertStateToString(value);
    return nested ? `${key}.${nested}` : key;
  }
  return "";
}
