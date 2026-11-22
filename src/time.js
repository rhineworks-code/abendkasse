// Zeit-Helfer: alles in der Spiel-Zeitzone (Standard Europe/Berlin), unabhängig von der Container-TZ
const { TZ } = require('./config');

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function now() {
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, minute: +p.minute, second: +p.second };
}

function addDays(date, n) {
  const t = new Date(date + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// Millisekunden bis zur nächsten vollen Stunde h (in Spiel-Zeitzone)
function msUntilHour(h) {
  const n = now();
  let s = h * 3600 - (n.hour * 3600 + n.minute * 60 + n.second);
  if (s <= 0) s += 86400;
  return s * 1000;
}

module.exports = { now, addDays, diffDays, msUntilHour };
