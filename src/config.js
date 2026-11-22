// Zentrale Einstellungen – alles per Umgebungsvariable überschreibbar
const int = (v, d) => (v !== undefined && v !== '' && !isNaN(+v) ? +v : d);

module.exports = {
  PORT: int(process.env.PORT, 8084),
  DATA_DIR: process.env.DATA_DIR || '/data',
  TZ: process.env.GAME_TZ || process.env.TZ || 'Europe/Berlin',

  PAYOUT_HOUR: int(process.env.PAYOUT_HOUR, 20),        // Auszahlung um 20:00
  OPEN_HOUR: int(process.env.OPEN_HOUR, 0),             // ab wann die Tagesfragen offen sind
  QUESTIONS_PER_DAY: int(process.env.QUESTIONS_PER_DAY, 10),
  JOKERS_PER_DAY: int(process.env.JOKERS_PER_DAY, 1),   // 50:50-Joker pro Spieler und Tag
  WEEK_DAYS: int(process.env.WEEK_DAYS, 7),

  POINTS_PER_CORRECT: int(process.env.POINTS_PER_CORRECT, 10),
  PERFECT_DAY_BONUS: int(process.env.PERFECT_DAY_BONUS, 20),
  WEEK_WIN_BONUS: int(process.env.WEEK_WIN_BONUS, 100),
  MAX_PLAYERS: int(process.env.MAX_PLAYERS, 2),

  PUBLIC_URL: process.env.PUBLIC_URL || '',             // z. B. https://quiz.deinedomain.de – für Einladungslinks
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',           // optional: z. B. Home-Assistant-Webhook
};
