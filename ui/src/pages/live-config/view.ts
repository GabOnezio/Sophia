// Control UI "Live Configuration" settings page: render helpers.
// Curated, hand-built form (per-category provider rosters, default voice
// provider, AI persona) rather than the generic JSON-schema-driven config
// form — these are a small, specific set of fields, not a full config
// section to browse.
import { html } from "lit";
import {
  LIVE_CONFIG_CATEGORY_LABELS,
  providersForCategory,
  type LiveConfigCategory,
} from "./provider-catalog.ts";
import type { RosterEntry } from "./model-roster.ts";
import {
  SPATIAL_AUDIO_FIELD_LIMITS,
  type SpatialAudioSettings,
} from "./spatial-audio.ts";

export const CUSTOM_PROVIDER_OPTION = "__custom__";

export type LiveConfigProviderId = "anthropic" | "openai" | "xai" | "google";

export const LIVE_CONFIG_VOICE_DEFAULT_PROVIDERS: ReadonlyArray<{
  id: LiveConfigProviderId;
  label: string;
}> = [
  { id: "openai", label: "OpenAI" },
  { id: "xai", label: "xAI (Grok)" },
  { id: "google", label: "Google (Gemini)" },
];

export type RosterAddDraft = {
  open: boolean;
  provider: string;
  customProvider: string;
  model: string;
  apiKey: string;
  saving: boolean;
};

export function createRosterAddDraft(): RosterAddDraft {
  return { open: false, provider: "", customProvider: "", model: "", apiKey: "", saving: false };
}

export function resolveDraftProviderId(draft: RosterAddDraft): string {
  return (draft.provider === CUSTOM_PROVIDER_OPTION ? draft.customProvider : draft.provider).trim();
}

export type RosterSectionProps = {
  category: LiveConfigCategory;
  connected: boolean;
  entries: RosterEntry[];
  draft: RosterAddDraft;
  onToggleAdd: () => void;
  onDraftProviderChange: (value: string) => void;
  onDraftCustomProviderChange: (value: string) => void;
  onDraftModelChange: (value: string) => void;
  onDraftApiKeyChange: (value: string) => void;
  onAddSubmit: () => void;
  onSetStars: (key: string, stars: number) => void;
  onRemove: (key: string) => void;
};

export type LiveConfigProps = {
  connected: boolean;
  rosterError: string | null;
  roster: Record<LiveConfigCategory, RosterSectionProps>;
  voiceAutoFailover: boolean;
  voiceAutoFailoverSaving: boolean;
  onVoiceAutoFailoverToggle: (enabled: boolean) => void;
  voiceProvider: string;
  voiceProviderSaving: boolean;
  soulDraft: string;
  soulLoading: boolean;
  soulSaving: boolean;
  userDraft: string;
  userLoading: boolean;
  userSaving: boolean;
  personaError: string | null;
  onVoiceProviderSelect: (providerId: LiveConfigProviderId) => void;
  onSoulInput: (value: string) => void;
  onSoulSave: () => void;
  onUserInput: (value: string) => void;
  onUserSave: () => void;
  spatialAudioDraft: SpatialAudioSettings;
  spatialAudioSaving: boolean;
  onSpatialAudioInput: (field: keyof SpatialAudioSettings, value: number) => void;
  onSpatialAudioSave: () => void;
};

const STAR_VALUES = Array.from({ length: 10 }, (_, i) => i + 1);

function renderStars(current: number, disabled: boolean, onSet: (stars: number) => void) {
  return html`
    <div class="live-config__stars" role="group" aria-label="Nota de 1 a 10">
      ${STAR_VALUES.map(
        (n) => html`
          <button
            type="button"
            class="live-config__star ${n <= current ? "live-config__star--filled" : ""}"
            ?disabled=${disabled}
            title="${n} estrela${n > 1 ? "s" : ""}"
            @click=${() => onSet(n === current ? 0 : n)}
          >
            ★
          </button>
        `,
      )}
    </div>
  `;
}

function providerLabel(category: LiveConfigCategory, providerId: string): string {
  return providersForCategory(category).find((p) => p.id === providerId)?.label ?? providerId;
}

function renderRosterEntry(props: RosterSectionProps, entry: RosterEntry) {
  return html`
    <div class="live-config__roster-row">
      <div class="live-config__roster-label">
        <span>${providerLabel(props.category, entry.provider)}</span>
        ${entry.model ? html`<span class="live-config__roster-model">${entry.model}</span>` : null}
      </div>
      ${renderStars(entry.stars, !props.connected, (stars) => props.onSetStars(entry.key, stars))}
      <button
        type="button"
        class="live-config__roster-remove"
        title="Remover"
        aria-label="Remover ${providerLabel(props.category, entry.provider)}"
        @click=${() => props.onRemove(entry.key)}
      >
        ✕
      </button>
    </div>
  `;
}

function renderAddRow(props: RosterSectionProps) {
  if (!props.draft.open) {
    return html`
      <button type="button" class="live-config__add-btn" @click=${() => props.onToggleAdd()}>
        + Adicionar provedor
      </button>
    `;
  }
  const catalog = providersForCategory(props.category);
  const resolvedProvider = resolveDraftProviderId(props.draft);
  const canSubmit =
    props.connected && !props.draft.saving && Boolean(resolvedProvider) && Boolean(props.draft.apiKey.trim());
  return html`
    <div class="live-config__add-row">
      <select
        class="live-config__add-select"
        .value=${props.draft.provider}
        @change=${(event: Event) =>
          props.onDraftProviderChange((event.target as HTMLSelectElement).value)}
      >
        <option value="">Escolher provedor...</option>
        ${catalog.map((provider) => html`<option value=${provider.id}>${provider.label}</option>`)}
        <option value=${CUSTOM_PROVIDER_OPTION}>Outro (digitar id)...</option>
      </select>
      ${props.draft.provider === CUSTOM_PROVIDER_OPTION
        ? html`
            <input
              type="text"
              class="live-config__add-input"
              placeholder="id do provedor"
              .value=${props.draft.customProvider}
              @input=${(event: Event) =>
                props.onDraftCustomProviderChange((event.target as HTMLInputElement).value)}
            />
          `
        : null}
      <input
        type="text"
        class="live-config__add-input"
        placeholder="modelo (opcional)"
        .value=${props.draft.model}
        @input=${(event: Event) => props.onDraftModelChange((event.target as HTMLInputElement).value)}
      />
      <input
        type="password"
        class="live-config__add-input"
        placeholder="Chave de API"
        autocomplete="off"
        spellcheck="false"
        .value=${props.draft.apiKey}
        @input=${(event: Event) => props.onDraftApiKeyChange((event.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        class="btn btn--subtle btn--sm"
        ?disabled=${!canSubmit}
        @click=${() => props.onAddSubmit()}
      >
        ${props.draft.saving ? "Adicionando..." : "Adicionar"}
      </button>
      <button type="button" class="live-config__add-cancel" @click=${() => props.onToggleAdd()}>
        Cancelar
      </button>
    </div>
  `;
}

function renderVoiceAutoFailoverToggle(props: LiveConfigProps) {
  return html`
    <label class="live-config__checkbox-row">
      <input
        type="checkbox"
        .checked=${props.voiceAutoFailover}
        ?disabled=${!props.connected || props.voiceAutoFailoverSaving}
        @change=${(event: Event) =>
          props.onVoiceAutoFailoverToggle((event.target as HTMLInputElement).checked)}
      />
      <span>
        Trocar de provedor automaticamente quando o atual ficar sem crédito (recomendado)
      </span>
    </label>
  `;
}

export function renderProviderRosterSection(
  props: RosterSectionProps,
  autoFailoverToggle?: ReturnType<typeof html>,
) {
  return html`
    <section class="live-config__section">
      <h3 class="live-config__heading">${LIVE_CONFIG_CATEGORY_LABELS[props.category]}</h3>
      <p class="live-config__hint">
        Se uma ficar sem crédito, a Sophia percebe sozinha e tenta a próxima da lista (por ordem de
        estrelas).
      </p>
      ${autoFailoverToggle ?? null}
      <div class="live-config__roster">
        ${props.entries.length === 0
          ? html`<p class="live-config__roster-empty">Nenhum provedor configurado ainda.</p>`
          : props.entries.map((entry) => renderRosterEntry(props, entry))}
      </div>
      ${renderAddRow(props)}
    </section>
  `;
}

const ROSTER_CATEGORY_ORDER: LiveConfigCategory[] = ["thinking", "voice", "image", "video", "music"];

export function renderLiveConfig(props: LiveConfigProps) {
  return html`
    <div class="live-config">
      ${props.rosterError
        ? html`<div class="live-config__error live-config__error--banner">${props.rosterError}</div>`
        : null}
      ${ROSTER_CATEGORY_ORDER.map((category) =>
        renderProviderRosterSection(
          props.roster[category],
          category === "voice" ? renderVoiceAutoFailoverToggle(props) : undefined,
        ),
      )}

      <section class="live-config__section">
        <h3 class="live-config__heading">Quem fala por você</h3>
        <p class="live-config__hint">
          Provedor padrão de voz usado na página "Vivo" (você ainda pode trocar por sessão lá).
        </p>
        <div class="alive-picker" role="group" aria-label="Provedor de voz padrão">
          ${LIVE_CONFIG_VOICE_DEFAULT_PROVIDERS.map(
            (provider) => html`
              <button
                type="button"
                class="alive-picker__btn ${provider.id === props.voiceProvider
                  ? "alive-picker__btn--active"
                  : ""}"
                ?disabled=${!props.connected || props.voiceProviderSaving}
                @click=${() => props.onVoiceProviderSelect(provider.id)}
              >
                ${provider.label}
              </button>
            `,
          )}
        </div>
      </section>

      <section class="live-config__section">
        <h3 class="live-config__heading">Distância da voz</h3>
        <p class="live-config__hint">
          Controla o quanto o volume da voz cai conforme você se afasta da esfera no espaço 3D da
          página "Vivo". Aplica-se na próxima vez que você clicar em "Falar".
        </p>
        <div class="live-config__spatial-fields">
          <div class="live-config__spatial-field">
            <label class="live-config__picker-label" for="live-config-spatial-ref"
              >Distância cheia (m)</label
            >
            <span class="live-config__hint live-config__hint--tight"
              >Até aqui, o volume fica no máximo.</span
            >
            <input
              id="live-config-spatial-ref"
              type="number"
              class="live-config__add-input"
              min=${SPATIAL_AUDIO_FIELD_LIMITS.refDistance.min}
              max=${SPATIAL_AUDIO_FIELD_LIMITS.refDistance.max}
              step=${SPATIAL_AUDIO_FIELD_LIMITS.refDistance.step}
              .value=${String(props.spatialAudioDraft.refDistance)}
              @input=${(event: Event) =>
                props.onSpatialAudioInput(
                  "refDistance",
                  Number((event.target as HTMLInputElement).value),
                )}
            />
          </div>
          <div class="live-config__spatial-field">
            <label class="live-config__picker-label" for="live-config-spatial-rolloff"
              >Queda de volume</label
            >
            <span class="live-config__hint live-config__hint--tight"
              >Maior = cai mais rápido depois da distância cheia. Menor = voz mais alta de
              longe.</span
            >
            <input
              id="live-config-spatial-rolloff"
              type="number"
              class="live-config__add-input"
              min=${SPATIAL_AUDIO_FIELD_LIMITS.rolloffFactor.min}
              max=${SPATIAL_AUDIO_FIELD_LIMITS.rolloffFactor.max}
              step=${SPATIAL_AUDIO_FIELD_LIMITS.rolloffFactor.step}
              .value=${String(props.spatialAudioDraft.rolloffFactor)}
              @input=${(event: Event) =>
                props.onSpatialAudioInput(
                  "rolloffFactor",
                  Number((event.target as HTMLInputElement).value),
                )}
            />
          </div>
          <div class="live-config__spatial-field">
            <label class="live-config__picker-label" for="live-config-spatial-max"
              >Distância máxima (m)</label
            >
            <span class="live-config__hint live-config__hint--tight"
              >Além daqui, o afastamento não é mais levado em conta.</span
            >
            <input
              id="live-config-spatial-max"
              type="number"
              class="live-config__add-input"
              min=${SPATIAL_AUDIO_FIELD_LIMITS.maxDistance.min}
              max=${SPATIAL_AUDIO_FIELD_LIMITS.maxDistance.max}
              step=${SPATIAL_AUDIO_FIELD_LIMITS.maxDistance.step}
              .value=${String(props.spatialAudioDraft.maxDistance)}
              @input=${(event: Event) =>
                props.onSpatialAudioInput(
                  "maxDistance",
                  Number((event.target as HTMLInputElement).value),
                )}
            />
          </div>
        </div>
        <button
          type="button"
          class="btn btn--subtle btn--sm"
          ?disabled=${!props.connected || props.spatialAudioSaving}
          @click=${() => props.onSpatialAudioSave()}
        >
          ${props.spatialAudioSaving ? "Salvando..." : "Salvar distância"}
        </button>
      </section>

      <section class="live-config__section">
        <h3 class="live-config__heading">Conhecimento básico da IA</h3>
        <p class="live-config__hint">
          Quem ela é e o que ela deve sempre saber sobre você — injetado em toda sessão.
        </p>
        ${props.personaError
          ? html`<div class="live-config__error">${props.personaError}</div>`
          : null}
        <div class="live-config__persona-fields">
          <div class="live-config__persona-field">
            <label class="live-config__picker-label" for="live-config-soul">Personalidade</label>
            <textarea
              id="live-config-soul"
              class="live-config__textarea"
              rows="6"
              placeholder="Quem ela é, tom de voz, limites..."
              .value=${props.soulDraft}
              ?disabled=${props.soulLoading}
              @input=${(event: Event) => props.onSoulInput((event.target as HTMLTextAreaElement).value)}
            ></textarea>
            <button
              type="button"
              class="btn btn--subtle btn--sm"
              ?disabled=${!props.connected || props.soulSaving || props.soulLoading}
              @click=${() => props.onSoulSave()}
            >
              ${props.soulSaving ? "Salvando..." : "Salvar personalidade"}
            </button>
          </div>
          <div class="live-config__persona-field">
            <label class="live-config__picker-label" for="live-config-user">
              O que ela sabe sobre você
            </label>
            <textarea
              id="live-config-user"
              class="live-config__textarea"
              rows="6"
              placeholder="Fatos básicos que ela deve sempre lembrar..."
              .value=${props.userDraft}
              ?disabled=${props.userLoading}
              @input=${(event: Event) => props.onUserInput((event.target as HTMLTextAreaElement).value)}
            ></textarea>
            <button
              type="button"
              class="btn btn--subtle btn--sm"
              ?disabled=${!props.connected || props.userSaving || props.userLoading}
              @click=${() => props.onUserSave()}
            >
              ${props.userSaving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </section>
    </div>
  `;
}
