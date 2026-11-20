// Schedules: standard 5-field cron (minute hour day month weekday) in this computer's local time,
// plus "every N minutes/hours".
function field(spec, min, max) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min, hi = max;
    if (range !== '*') { const [a, b] = range.split('-'); lo = Number(a); hi = b === undefined ? (stepStr ? max : lo) : Number(b); }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || !(step >= 1) || lo < min || hi > max) throw new Error(`Bad schedule field "${spec}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function normalize(schedule) {
  const s = String(schedule).trim().toLowerCase();
  let m;
  if ((m = s.match(/^every (\d+) ?(min|minutes?)$/))) return `*/${Math.min(59, Number(m[1]))} * * * *`;
  if ((m = s.match(/^every (\d+) ?(h|hours?)$/))) return `0 */${Math.min(23, Number(m[1]))} * * *`;
  return s;
}

export function parse(schedule) {
  const f = normalize(schedule).split(/\s+/);
  if (f.length !== 5) throw new Error('Schedule must be 5 cron fields, e.g. "0 9 * * 1-5" (weekdays at 9:00).');
  const dow = field(f[4].replace(/7/g, '0'), 0, 6);
  return { min: field(f[0], 0, 59), hour: field(f[1], 0, 23), dom: field(f[2], 1, 31), mon: field(f[3], 1, 12), dow, domAny: f[2] === '*', dowAny: f[4] === '*' };
}

export function nextRun(schedule, after = Date.now()) {
  const c = parse(schedule);
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++, d.setMinutes(d.getMinutes() + 1)) {
    if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) continue;
    const domOk = c.dom.has(d.getDate()), dowOk = c.dow.has(d.getDay());
    if (c.domAny || c.dowAny ? domOk && dowOk : domOk || dowOk) return d.getTime();
  }
  return null;
}

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
