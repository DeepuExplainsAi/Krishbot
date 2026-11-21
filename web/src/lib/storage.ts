/** Per-browser settings in localStorage under `krishbot.<name>`. */
export function lsGet(name: string): string | null {
  try { return localStorage.getItem(`krishbot.${name}`); } catch { return null; }
}

export function lsSet(name: string, value: string) {
  try { localStorage.setItem(`krishbot.${name}`, value); } catch { /* storage unavailable */ }
}
