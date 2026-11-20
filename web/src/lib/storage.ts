/** Per-browser settings in localStorage under `krishbot.<name>`. Values saved before the project was renamed (`grokbot.<name>`) are still read. */
export function lsGet(name: string): string | null {
  try { return localStorage.getItem(`krishbot.${name}`) ?? localStorage.getItem(`grokbot.${name}`); } catch { return null; }
}

export function lsSet(name: string, value: string) {
  try { localStorage.setItem(`krishbot.${name}`, value); } catch { /* storage unavailable */ }
}
