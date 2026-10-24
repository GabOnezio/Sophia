import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { state } from "lit/decorators.js";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import {
  applicationContext,
  type ApplicationContext,
  type ApplicationGatewaySnapshot,
} from "../../app/context.ts";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { currentConfigObject } from "../../lib/config/index.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { resolveUiDefaultAgentId } from "../../lib/sessions/session-key.ts";
import { loadAgentFileContent, saveAgentFile } from "../agents/files.ts";
import type { AgentsFilesListResult } from "../../api/types.ts";
import {
  addRosterEntry,
  buildRatingsMergePatchFragment,
  buildRosterPatch,
  parseRoster,
  readAgentToolModelField,
  readRosterAutoFailover,
  readRosterRatings,
  removeRosterEntry,
  setRosterStars,
  type RosterEntry,
} from "./model-roster.ts";
import {
  LIVE_CONFIG_CATEGORY_CONFIG_FIELD,
  providersForCategory,
  type LiveConfigCategory,
} from "./provider-catalog.ts";
import {
  readSpatialAudioSettings,
  SPATIAL_AUDIO_DEFAULTS,
  type SpatialAudioSettings,
} from "./spatial-audio.ts";
import {
  createRosterAddDraft,
  renderLiveConfig,
  resolveDraftProviderId,
  type LiveConfigProviderId,
  type RosterAddDraft,
  type RosterSectionProps,
} from "./view.ts";

const CATEGORIES: LiveConfigCategory[] = ["thinking", "voice", "image", "video", "music"];

function readToolModelConfig(
  configObject: Record<string, unknown> | null,
  category: LiveConfigCategory,
) {
  return readAgentToolModelField(configObject, LIVE_CONFIG_CATEGORY_CONFIG_FIELD[category]);
}

function readConfiguredTtsProvider(configObject: Record<string, unknown> | null): string {
  const messages = configObject?.messages as Record<string, unknown> | undefined;
  const tts = messages?.tts as Record<string, unknown> | undefined;
  return typeof tts?.provider === "string" ? tts.provider : "openai";
}

class LiveConfigPage extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @consume({ context: applicationContext, subscribe: false })
  private context!: ApplicationContext;

  @state() private client: GatewayBrowserClient | null = null;
  @state() private connected = false;
  @state() private agentId = "main";

  @state() private rosterDrafts: Record<LiveConfigCategory, RosterAddDraft> = {
    thinking: createRosterAddDraft(),
    voice: createRosterAddDraft(),
    image: createRosterAddDraft(),
    video: createRosterAddDraft(),
    music: createRosterAddDraft(),
  };

  @state() private rosterError: string | null = null;

  @state() private voiceProvider = "openai";
  @state() private voiceProviderSaving = false;

  @state() private voiceAutoFailover = true;
  @state() private voiceAutoFailoverSaving = false;

  @state() private spatialAudioDraft: SpatialAudioSettings = { ...SPATIAL_AUDIO_DEFAULTS };
  @state() private spatialAudioSaving = false;

  @state() private soulDraft = "";
  @state() private soulLoading = false;
  @state() private soulSaving = false;
  @state() private userDraft = "";
  @state() private userLoading = false;
  @state() private userSaving = false;
  @state() private personaError: string | null = null;

  /** The spatial-audio draft is free-typed, so it's only seeded from the
   * config snapshot once (like the SOUL/USER persona drafts) — otherwise an
   * unrelated save elsewhere on this page (which also refreshes the
   * snapshot) would clobber in-progress edits here. */
  private spatialAudioSeeded = false;

  private subscriptions: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.applyGatewaySnapshot(this.context.gateway.snapshot);
    this.syncFromConfig();
    this.subscriptions = [
      this.context.gateway.subscribe((snapshot) => this.applyGatewaySnapshot(snapshot)),
      this.context.agents.subscribe(() => this.applyGatewaySnapshot(this.context.gateway.snapshot)),
      this.context.runtimeConfig.subscribe(() => this.syncFromConfig()),
    ];
    void this.loadPersonaFiles();
  }

  override disconnectedCallback() {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    super.disconnectedCallback();
  }

  private applyGatewaySnapshot(snapshot: ApplicationGatewaySnapshot) {
    this.client = snapshot.client;
    this.connected = snapshot.connected;
    this.agentId = resolveUiDefaultAgentId({
      agentsList: this.context.agents.state.agentsList,
      hello: snapshot.hello,
    });
  }

  private syncFromConfig() {
    const configObject = currentConfigObject(this.context.runtimeConfig.state);
    if (!configObject) {
      return;
    }
    this.voiceProvider = readConfiguredTtsProvider(configObject);
    this.voiceAutoFailover = readRosterAutoFailover(readToolModelConfig(configObject, "voice"));
    if (!this.spatialAudioSeeded) {
      this.spatialAudioSeeded = true;
      this.spatialAudioDraft = readSpatialAudioSettings(configObject);
    }
    this.requestUpdate();
  }

  private currentEntries(category: LiveConfigCategory): RosterEntry[] {
    const configObject = currentConfigObject(this.context.runtimeConfig.state);
    const toolModel = readToolModelConfig(configObject, category);
    return parseRoster(toolModel, readRosterRatings(toolModel));
  }

  /** Builds the {agents: {defaults: {<field>: {...}}}} merge-patch fragment
   * for an edited entry list — always includes a ratings merge-fragment
   * (with explicit nulls for dropped keys) so stale per-provider ratings
   * don't linger after a remove. Pure — does not talk to the gateway. */
  private buildRosterRawFragment(
    category: LiveConfigCategory,
    nextEntries: RosterEntry[],
  ): Record<string, unknown> {
    const configObject = currentConfigObject(this.context.runtimeConfig.state);
    const previousToolModel = readToolModelConfig(configObject, category);
    const previousRatings = readRosterRatings(previousToolModel);
    const patch = buildRosterPatch(nextEntries);
    const ratingsFragment = buildRatingsMergePatchFragment(previousRatings, patch.ratings);
    const field = LIVE_CONFIG_CATEGORY_CONFIG_FIELD[category];
    const categoryRaw: Record<string, unknown> = {
      primary: patch.primary ?? null,
      fallbacks: patch.fallbacks,
    };
    if (ratingsFragment !== null) {
      categoryRaw.ratings = ratingsFragment;
    }
    return { agents: { defaults: { [field]: categoryRaw } } };
  }

  /** Config paths this category's roster patch may shrink (e.g. removing an
   * entry drops one from `fallbacks[]`) — config.patch rejects any patch
   * that would drop array entries unless the path is explicitly allow-listed
   * here, to guard against accidental data loss from other callers. */
  private rosterReplacePaths(category: LiveConfigCategory): string[] {
    const field = LIVE_CONFIG_CATEGORY_CONFIG_FIELD[category];
    return [`agents.defaults.${field}.fallbacks`];
  }

  /** Writes an edited entry list back for one category as its own patch,
   * then force-refreshes the snapshot so the roster re-renders with the
   * new state (patch() itself doesn't update local config state). Surfaces
   * a failure (e.g. rate limit, validation error) via `rosterError` instead
   * of silently leaving the UI unchanged. */
  private async writeRoster(category: LiveConfigCategory, nextEntries: RosterEntry[]): Promise<boolean> {
    const ok = await this.context.runtimeConfig.patch({
      raw: this.buildRosterRawFragment(category, nextEntries),
      note: `Configuração Viva: ${LIVE_CONFIG_CATEGORY_CONFIG_FIELD[category]}`,
      replacePaths: this.rosterReplacePaths(category),
    });
    if (ok) {
      this.rosterError = null;
      await this.context.runtimeConfig.refresh();
    } else {
      this.rosterError = this.context.runtimeConfig.state.lastError;
    }
    return ok;
  }

  private updateDraft(category: LiveConfigCategory, patch: Partial<RosterAddDraft>) {
    this.rosterDrafts = {
      ...this.rosterDrafts,
      [category]: { ...this.rosterDrafts[category], ...patch },
    };
  }

  private toggleAdd(category: LiveConfigCategory) {
    const current = this.rosterDrafts[category];
    this.rosterDrafts = {
      ...this.rosterDrafts,
      [category]: current.open ? createRosterAddDraft() : { ...createRosterAddDraft(), open: true },
    };
  }

  private async submitAdd(category: LiveConfigCategory) {
    const draft = this.rosterDrafts[category];
    const providerId = resolveDraftProviderId(draft);
    const apiKey = draft.apiKey.trim();
    if (!this.client || !this.connected || !providerId || !apiKey) {
      return;
    }
    this.updateDraft(category, { saving: true });
    try {
      // A blank "modelo" field must not end up stored as a bare provider id
      // (e.g. "openai") — OpenClaw's provider/model ref parser requires
      // "provider/model" everywhere it reads fallbacks[], so a bare id is
      // silently dropped and the entry never actually takes effect despite
      // showing as configured. Fall back to the catalog's known default
      // model for curated providers; a custom-typed provider with no known
      // default is stored as-is (best effort, matching prior behavior).
      const model =
        draft.model.trim() ||
        providersForCategory(category).find((provider) => provider.id === providerId)
          ?.defaultModel;
      const nextEntries = addRosterEntry(this.currentEntries(category), {
        provider: providerId,
        model,
        stars: 0,
      });
      // One atomic patch for both the credential and the roster entry —
      // two separate round-trips risk a baseHash mismatch if the second
      // patch is built against config that the first one already changed.
      const raw = {
        models: { providers: { [providerId]: { apiKey } } },
        ...this.buildRosterRawFragment(category, nextEntries),
      };
      const ok = await this.context.runtimeConfig.patch({
        raw,
        note: `Configuração Viva: ${providerId}`,
        replacePaths: this.rosterReplacePaths(category),
      });
      if (ok) {
        this.rosterError = null;
        await this.context.runtimeConfig.refresh();
        this.rosterDrafts = { ...this.rosterDrafts, [category]: createRosterAddDraft() };
      } else {
        this.rosterError = this.context.runtimeConfig.state.lastError;
      }
    } finally {
      this.updateDraft(category, { saving: false });
      this.requestUpdate();
    }
  }

  private async handleSetStars(category: LiveConfigCategory, key: string, stars: number) {
    const nextEntries = setRosterStars(this.currentEntries(category), key, stars);
    await this.writeRoster(category, nextEntries);
    this.requestUpdate();
  }

  private async handleRemove(category: LiveConfigCategory, key: string) {
    const nextEntries = removeRosterEntry(this.currentEntries(category), key);
    await this.writeRoster(category, nextEntries);
    this.requestUpdate();
  }

  private async loadPersonaFiles() {
    this.soulLoading = true;
    this.userLoading = true;
    this.requestUpdate();
    const filesState = {
      client: this.client,
      connected: this.connected,
      agentFilesLoading: false,
      agentFilesError: null as string | null,
      agentFilesList: null as AgentsFilesListResult | null,
      agentFileContents: {} as Record<string, string>,
      agentFileDrafts: {} as Record<string, string>,
      agentFileActive: null as string | null,
      agentFileSaving: false,
    };
    await Promise.all([
      loadAgentFileContent(filesState, this.agentId, "SOUL.md"),
      loadAgentFileContent(filesState, this.agentId, "USER.md"),
    ]);
    this.soulDraft = filesState.agentFileContents["SOUL.md"] ?? "";
    this.userDraft = filesState.agentFileContents["USER.md"] ?? "";
    this.personaError = filesState.agentFilesError;
    this.soulLoading = false;
    this.userLoading = false;
    this.requestUpdate();
  }

  private async saveVoiceProvider(providerId: LiveConfigProviderId) {
    if (!this.client || !this.connected || providerId === this.voiceProvider) {
      return;
    }
    this.voiceProviderSaving = true;
    this.requestUpdate();
    try {
      const ok = await this.context.runtimeConfig.patch({
        raw: { messages: { tts: { provider: providerId } } },
        note: "Configuração Viva: provedor de voz padrão",
      });
      if (ok) {
        this.voiceProvider = providerId;
      }
    } finally {
      this.voiceProviderSaving = false;
      this.requestUpdate();
    }
  }

  private async saveVoiceAutoFailover(enabled: boolean) {
    if (!this.client || !this.connected || enabled === this.voiceAutoFailover) {
      return;
    }
    this.voiceAutoFailoverSaving = true;
    this.requestUpdate();
    try {
      // agents.defaults.voiceModel may still be a bare "provider/model" string
      // (never touched by the roster editor) — merge-patch only merges when
      // both sides are objects, so a string value must be upgraded to
      // {primary: <string>, autoFailover} here or the patch would replace it
      // outright and drop the configured model.
      const configObject = currentConfigObject(this.context.runtimeConfig.state);
      const current = readToolModelConfig(configObject, "voice");
      const voiceModelPatch =
        typeof current === "string"
          ? { primary: current, autoFailover: enabled }
          : { autoFailover: enabled };
      const ok = await this.context.runtimeConfig.patch({
        raw: { agents: { defaults: { voiceModel: voiceModelPatch } } },
        note: "Configuração Viva: troca automática de voz por crédito",
      });
      if (ok) {
        this.voiceAutoFailover = enabled;
      }
    } finally {
      this.voiceAutoFailoverSaving = false;
      this.requestUpdate();
    }
  }

  private updateSpatialAudioDraft(field: keyof SpatialAudioSettings, value: number) {
    if (!Number.isFinite(value)) {
      return;
    }
    this.spatialAudioDraft = { ...this.spatialAudioDraft, [field]: value };
  }

  private async saveSpatialAudio() {
    if (!this.client || !this.connected) {
      return;
    }
    this.spatialAudioSaving = true;
    this.requestUpdate();
    try {
      const ok = await this.context.runtimeConfig.patch({
        raw: { talk: { realtime: { spatialAudio: { ...this.spatialAudioDraft } } } },
        note: "Configuração Viva: distância da voz (áudio espacial)",
      });
      if (ok) {
        await this.context.runtimeConfig.refresh();
      }
    } finally {
      this.spatialAudioSaving = false;
      this.requestUpdate();
    }
  }

  private async savePersonaFile(name: "SOUL.md" | "USER.md", content: string) {
    if (!this.client || !this.connected) {
      return;
    }
    const setSaving = (value: boolean) => {
      if (name === "SOUL.md") {
        this.soulSaving = value;
      } else {
        this.userSaving = value;
      }
    };
    setSaving(true);
    this.requestUpdate();
    const filesState = {
      client: this.client,
      connected: this.connected,
      agentFilesLoading: false,
      agentFilesError: null as string | null,
      agentFilesList: null as AgentsFilesListResult | null,
      agentFileContents: {} as Record<string, string>,
      agentFileDrafts: {} as Record<string, string>,
      agentFileActive: null as string | null,
      agentFileSaving: false,
    };
    await saveAgentFile(filesState, this.agentId, name, content);
    this.personaError = filesState.agentFilesError;
    setSaving(false);
    this.requestUpdate();
  }

  private rosterSectionProps(category: LiveConfigCategory): RosterSectionProps {
    return {
      category,
      connected: this.connected,
      entries: this.currentEntries(category),
      draft: this.rosterDrafts[category],
      onToggleAdd: () => this.toggleAdd(category),
      onDraftProviderChange: (value) => this.updateDraft(category, { provider: value }),
      onDraftCustomProviderChange: (value) => this.updateDraft(category, { customProvider: value }),
      onDraftModelChange: (value) => this.updateDraft(category, { model: value }),
      onDraftApiKeyChange: (value) => this.updateDraft(category, { apiKey: value }),
      onAddSubmit: () => void this.submitAdd(category),
      onSetStars: (key, stars) => void this.handleSetStars(category, key, stars),
      onRemove: (key) => void this.handleRemove(category, key),
    };
  }

  override render() {
    const roster = Object.fromEntries(
      CATEGORIES.map((category) => [category, this.rosterSectionProps(category)]),
    ) as Record<LiveConfigCategory, RosterSectionProps>;

    return html`
      <section class="content-header content-header--page">
        <div>
          <div class="page-title">${titleForRoute("live-config")}</div>
          <div class="page-sub">${subtitleForRoute("live-config")}</div>
        </div>
      </section>
      ${renderSettingsWorkspace(
        this.context.basePath,
        renderLiveConfig({
          connected: this.connected,
          rosterError: this.rosterError,
          roster,
          voiceAutoFailover: this.voiceAutoFailover,
          voiceAutoFailoverSaving: this.voiceAutoFailoverSaving,
          onVoiceAutoFailoverToggle: (enabled) => void this.saveVoiceAutoFailover(enabled),
          voiceProvider: this.voiceProvider,
          voiceProviderSaving: this.voiceProviderSaving,
          soulDraft: this.soulDraft,
          soulLoading: this.soulLoading,
          soulSaving: this.soulSaving,
          userDraft: this.userDraft,
          userLoading: this.userLoading,
          userSaving: this.userSaving,
          personaError: this.personaError,
          onVoiceProviderSelect: (providerId) => void this.saveVoiceProvider(providerId),
          onSoulInput: (value) => {
            this.soulDraft = value;
          },
          onSoulSave: () => void this.savePersonaFile("SOUL.md", this.soulDraft),
          onUserInput: (value) => {
            this.userDraft = value;
          },
          onUserSave: () => void this.savePersonaFile("USER.md", this.userDraft),
          spatialAudioDraft: this.spatialAudioDraft,
          spatialAudioSaving: this.spatialAudioSaving,
          onSpatialAudioInput: (field, value) => this.updateSpatialAudioDraft(field, value),
          onSpatialAudioSave: () => void this.saveSpatialAudio(),
        }),
        "live-config",
        (routeId) => this.context.navigate(routeId),
        (routeId) => this.context.preload(routeId),
      )}
    `;
  }
}

if (!customElements.get("openclaw-live-config-page")) {
  customElements.define("openclaw-live-config-page", LiveConfigPage);
}
