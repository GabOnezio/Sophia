// Control UI "Configuração Viva": curated per-category provider shortlists,
// sourced from the actual bundled extensions (extensions/*/{image,video}-
// generation-provider.ts, plus the TTS provider matrix). Not exhaustive —
// any provider id can still be typed in via the "outro" free-text option,
// this just saves a click for the common ones.
//
// The "voice" category feeds agents.defaults.voiceModel, which powers
// realtime Talk sessions (the Vivo/Alive page) and only accepts providers
// that implement the "realtimeVoiceProviders" plugin contract — today that
// is just openai and google (see extensions/*/openclaw.plugin.json). Other
// TTS-only providers (elevenlabs, azure, minimax, xai, ...) can synthesize
// speech but cannot power a realtime session, so listing them here would
// let an entry be added that can never actually work.

export type LiveConfigCategory = "thinking" | "voice" | "image" | "video" | "music";

export type CatalogProvider = {
  id: string;
  label: string;
  /** Used when the "modelo" field is left blank on add — without this, an
   * entry with no model is stored as a bare provider id (e.g. "openai"),
   * which OpenClaw's provider/model ref parser silently drops wherever a
   * ref list is read (it requires "provider/model"), leaving the entry
   * configured-looking in the UI but inert everywhere else. */
  defaultModel?: string;
};

export const LIVE_CONFIG_CATEGORY_LABELS: Record<LiveConfigCategory, string> = {
  thinking: "Pensamento",
  voice: "Voz (ordem de fallback)",
  image: "Imagem",
  video: "Vídeo",
  music: "Música",
};

export const LIVE_CONFIG_CATEGORY_CONFIG_FIELD: Record<LiveConfigCategory, string> = {
  thinking: "model",
  voice: "voiceModel",
  image: "imageGenerationModel",
  video: "videoGenerationModel",
  music: "musicGenerationModel",
};

const PROVIDER_CATALOG: Record<LiveConfigCategory, CatalogProvider[]> = {
  thinking: [
    { id: "anthropic", label: "Anthropic (Claude)" },
    { id: "openai", label: "OpenAI" },
    { id: "xai", label: "xAI (Grok)" },
    { id: "google", label: "Google (Gemini)" },
  ],
  voice: [
    { id: "openai", label: "OpenAI", defaultModel: "gpt-realtime-2.1" },
    {
      id: "google",
      label: "Google (Gemini)",
      defaultModel: "gemini-2.5-flash-native-audio-preview-12-2025",
    },
  ],
  image: [
    { id: "openai", label: "OpenAI" },
    { id: "google", label: "Google (Gemini)" },
    { id: "fal", label: "Fal.ai" },
    { id: "xai", label: "xAI (Grok)" },
    { id: "deepinfra", label: "DeepInfra" },
    { id: "minimax", label: "MiniMax" },
    { id: "microsoft-foundry", label: "Microsoft Foundry" },
    { id: "litellm", label: "LiteLLM" },
  ],
  video: [
    { id: "fal", label: "Fal.ai" },
    { id: "runway", label: "Runway" },
    { id: "xai", label: "xAI (Grok)" },
    { id: "pixverse", label: "PixVerse" },
    { id: "minimax", label: "MiniMax" },
    { id: "qwen", label: "Qwen" },
    { id: "deepinfra", label: "DeepInfra" },
    { id: "byteplus", label: "BytePlus" },
    { id: "alibaba", label: "Alibaba" },
  ],
  music: [
    { id: "minimax", label: "MiniMax" },
    { id: "fal", label: "Fal.ai" },
  ],
};

export function providersForCategory(category: LiveConfigCategory): CatalogProvider[] {
  return PROVIDER_CATALOG[category];
}
