// Control UI Alive page: lightweight keyword-based intent detection over the
// live user transcript, used to reveal the (normally hidden) model/voice
// picker only when the user actually asks for it by voice -- e.g. "quero
// trocar o modelo e a voz" / "change the voice". No LLM round-trip: this is
// a simple phrase-match, good enough for a small, well-known trigger set.

const SETTINGS_INTENT_PHRASES = [
  // Portuguese
  "modelo e voz",
  "modelo e a voz",
  "trocar modelo",
  "trocar o modelo",
  "trocar a voz",
  "mudar modelo",
  "mudar o modelo",
  "mudar a voz",
  "alterar modelo",
  "alterar o modelo",
  "alterar a voz",
  "configuracoes",
  "configuracao",
  // English
  "model and voice",
  "change the model",
  "change model",
  "change the voice",
  "change voice",
  "switch model",
  "switch voice",
  "settings",
] as const;

/** Unicode combining diacritical marks (U+0300-U+036F), stripped after NFD
 * normalization so e.g. "configuracao" matches transcribed "configuracao". */
const COMBINING_DIACRITICS_RE = /[̀-ͯ]/g;

function normalizeForIntentMatch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_DIACRITICS_RE, "").toLowerCase();
}

/** True if the (final) user transcript asks to open the model/voice settings. */
export function detectSettingsIntent(text: string): boolean {
  const normalized = normalizeForIntentMatch(text);
  return SETTINGS_INTENT_PHRASES.some((phrase) => normalized.includes(phrase));
}
