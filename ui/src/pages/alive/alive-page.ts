import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import {
  applicationContext,
  type ApplicationContext,
  type ApplicationGatewaySnapshot,
} from "../../app/context.ts";
import { currentConfigObject } from "../../lib/config/index.ts";
import {
  buildAgentMainSessionKey,
  resolveUiDefaultAgentId,
} from "../../lib/sessions/session-key.ts";
import { readAgentToolModelField } from "../live-config/model-roster.ts";
import "./three-scene.ts";
import {
  attachAliveRealtimeActions,
  createInitialAliveRealtimeState,
  type AliveRealtimeState,
} from "./alive-realtime.ts";

const REALTIME_STATUS_LABEL: Record<string, string> = {
  idle: "Parado",
  connecting: "Conectando...",
  listening: "Ouvindo",
  thinking: "Pensando...",
  error: "Erro",
};

/** Read-only — the "Modelo" info line used to be an interactive picker
 * (Claude Opus 4 / Sonnet 5) whose selection was mistakenly forwarded as the
 * realtime *voice* model override (see alive-realtime.ts's header comment),
 * breaking any non-Anthropic voice provider. agent_consult has no per-
 * session model override at all, so the picker never controlled anything
 * real — this just surfaces the actually-configured thinking model instead. */
function describeThinkingModel(configObject: Record<string, unknown> | null): string | null {
  const model = readAgentToolModelField(configObject, "model");
  const primary = typeof model === "string" ? model : model?.primary;
  return primary?.trim() || null;
}

class AlivePage extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @consume({ context: applicationContext, subscribe: false })
  private context!: ApplicationContext;

  private readonly realtime: AliveRealtimeState = {
    ...createInitialAliveRealtimeState(),
    client: null,
    connected: false,
    sessionKey: "agent:main:alive",
    basePath: "",
    getConfigObject: () => currentConfigObject(this.context.runtimeConfig.state),
    requestUpdate: () => this.requestUpdate(),
    toggleAliveVoice: async () => undefined,
    toggleControlsVisible: () => undefined,
    updateListenerPosition: () => undefined,
  };

  private subscriptions: Array<() => void> = [];
  private disposeChatWatcher: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.realtime.basePath = this.context.basePath;
    const { disposeChatWatcher } = attachAliveRealtimeActions(this.realtime);
    this.disposeChatWatcher = disposeChatWatcher;
    this.applyGatewaySnapshot(this.context.gateway.snapshot);
    this.subscriptions = [
      this.context.gateway.subscribe((snapshot) => this.applyGatewaySnapshot(snapshot)),
      this.context.agents.subscribe(() => this.applyGatewaySnapshot(this.context.gateway.snapshot)),
    ];
  }

  override disconnectedCallback() {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    this.disposeChatWatcher?.();
    this.disposeChatWatcher = null;
    this.realtime.session?.stop();
    this.realtime.session = null;
    super.disconnectedCallback();
  }

  private applyGatewaySnapshot(snapshot: ApplicationGatewaySnapshot) {
    this.realtime.client = snapshot.client;
    this.realtime.connected = snapshot.connected;
    const agentId = resolveUiDefaultAgentId({
      agentsList: this.context.agents.state.agentsList,
      hello: snapshot.hello,
    });
    this.realtime.sessionKey = buildAgentMainSessionKey({ agentId, mainKey: "alive" });
    this.requestUpdate();
  }

  private handleCameraMove = (event: Event) => {
    const detail = (event as CustomEvent<{ x: number; y: number; z: number }>).detail;
    if (!detail) {
      return;
    }
    this.realtime.updateListenerPosition(detail.x, detail.y, detail.z);
  };

  /** WASD/arrow keys generate real keyboard click noise near an open mic —
   * without this, that noise can get picked up as speech and trigger a
   * false barge-in that cuts her off mid-reply just from moving around. */
  private handleMovementActive = (event: Event) => {
    const detail = (event as CustomEvent<{ active: boolean }>).detail;
    if (!detail) {
      return;
    }
    this.realtime.session?.setMicMuted(detail.active);
  };

  override render() {
    const statusLabel = REALTIME_STATUS_LABEL[this.realtime.realtimeStatus] ?? "Parado";
    const talking = this.realtime.realtimeActive;
    const thinkingModel = describeThinkingModel(
      currentConfigObject(this.context.runtimeConfig.state),
    );

    return html`
      <div class="alive-page">
        <openclaw-alive-scene
          .inputLevel=${this.realtime.inputLevel}
          .outputLevel=${this.realtime.outputLevel}
          .active=${talking}
          .status=${this.realtime.realtimeStatus}
          .latestImageUrl=${this.realtime.latestImageUrl}
          @alive-camera-move=${this.handleCameraMove}
          @alive-movement-active=${this.handleMovementActive}
        ></openclaw-alive-scene>
        <div class="alive-page__controls">
          <div class="alive-page__status notranslate" translate="no">
            <span
              class="alive-page__status-dot alive-page__status-dot--${this.realtime
                .realtimeStatus}"
            ></span>
            ${statusLabel}
            ${this.realtime.realtimeDetail
              ? html`<span class="alive-page__status-detail">${this.realtime.realtimeDetail}</span>`
              : null}
            ${this.realtime.activeVoiceProvider
              ? html`<span class="alive-page__status-detail"
                  >voz: ${this.realtime.activeVoiceProvider}</span
                >`
              : null}
          </div>
          ${this.realtime.controlsVisible
            ? html`
                <div class="alive-page__pickers notranslate" translate="no">
                  <div class="alive-page__picker-group">
                    <span class="alive-page__picker-label">Modelo (pensamento)</span>
                    <span class="alive-page__status-detail"
                      >${thinkingModel ?? "não configurado"}</span
                    >
                  </div>
                </div>
              `
            : null}
          <div class="alive-page__actions">
            <button
              type="button"
              class="alive-page__talk-btn ${talking ? "alive-page__talk-btn--active" : ""}"
              @click=${() => void this.realtime.toggleAliveVoice()}
            >
              ${talking ? "Parar" : "Falar"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("openclaw-alive-page")) {
  customElements.define("openclaw-alive-page", AlivePage);
}
