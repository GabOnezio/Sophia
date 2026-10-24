// Control UI Alive page: orchestrates the realtime voice session (reusing
// RealtimeTalkSession — the same class Chat page's realtime Talk uses),
// routes audio-level callbacks into the two level meters that drive the
// sphere's scale, detects voice-triggered requests to reveal a small
// read-only info panel, watches the session's chat history for generated
// images, and wires up distance-based spatial audio.
//
// launchOptions intentionally never sets `model`: an earlier version of this
// page sent the Alive-only "thinking model" picker's selection (always an
// Anthropic Claude id, e.g. "claude-sonnet-5" — see the removed alive-model-
// picker.ts) through as RealtimeTalkLaunchOptions.model, which the gateway
// applies as the *voice/audio* model override for whichever provider the
// session actually connects to (talk-shared.ts buildRealtimeVoiceLaunch
// Options). Google and OpenAI's realtime APIs both reject a Claude model id
// outright, so any session that wasn't routed to Anthropic (nothing offers
// realtime voice) failed every time with a provider-side "model not found"
// error — the picker never actually influenced agent_consult's thinking
// model (that flow has no per-session override hook at all), so it was
// pure liability with no working upside. Do not reintroduce a `model`
// override here without confirming it targets the voice provider on
// purpose.
//
// Voice provider selection is NOT a per-session choice here anymore — it
// follows the "Voz" roster configured in Settings → Configuração Viva
// (agents.defaults.voiceModel), same as the rest of the app. The first
// attempt never sends an explicit `provider`, so the gateway auto-picks the
// highest-starred configured candidate on its own. If that candidate later
// reports a billing/credit failure, this restarts the session requesting
// the next candidate — see alive-voice-failover.ts for why that retry has
// to happen here instead of inside the gateway relay.
import type { GatewayBrowserClient, GatewayEventFrame } from "../../api/gateway.ts";
import { extractImages, buildAssistantAttachmentUrl } from "../chat/components/chat-message.ts";
import {
  RealtimeTalkSession,
  type RealtimeTalkLaunchOptions,
  type RealtimeTalkStatus,
} from "../chat/realtime-talk.ts";
import type { RealtimeTalkPcmOutputQueue } from "../chat/realtime-talk-audio.ts";
import { createLevelMeter, type LevelMeter } from "./audio-level-meter.ts";
import { detectSettingsIntent } from "./alive-voice-intent.ts";
import {
  isVoiceAutoFailoverEnabled,
  looksLikeVoiceBillingError,
  resolveVoiceFailoverProviderOrder,
} from "./alive-voice-failover.ts";
import { readSpatialAudioSettings } from "../live-config/spatial-audio.ts";

const CONTROLS_AUTO_HIDE_MS = 15_000;

type ChatEventPayload = {
  sessionKey?: string;
  state?: "delta" | "final" | "aborted" | "error";
  message?: unknown;
};

export type AliveRealtimeState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  basePath: string;
  /** Reads the live config snapshot for the "Voz" roster + auto-failover flag. */
  getConfigObject: () => Record<string, unknown> | null;
  /** The provider actually in use for the current/last session — informational
   * only (there is no picker for this anymore; it follows Configuração Viva). */
  activeVoiceProvider: string | null;
  realtimeActive: boolean;
  realtimeStatus: RealtimeTalkStatus;
  realtimeDetail: string | null;
  inputLevel: number;
  outputLevel: number;
  controlsVisible: boolean;
  latestImageUrl: string | null;
  session: RealtimeTalkSession | null;
  requestUpdate: () => void;
  toggleAliveVoice: () => Promise<void>;
  toggleControlsVisible: () => void;
  updateListenerPosition: (x: number, y: number, z: number) => void;
};

export function createInitialAliveRealtimeState() {
  return {
    activeVoiceProvider: null as string | null,
    realtimeActive: false,
    realtimeStatus: "idle" as RealtimeTalkStatus,
    realtimeDetail: null as string | null,
    inputLevel: 0,
    outputLevel: 0,
    controlsVisible: false,
    latestImageUrl: null as string | null,
    session: null as RealtimeTalkSession | null,
  };
}

function stopAliveSession(state: AliveRealtimeState): void {
  state.session?.stop();
  state.session = null;
  state.realtimeActive = false;
  state.realtimeStatus = "idle";
  state.realtimeDetail = null;
  state.activeVoiceProvider = null;
  state.inputLevel = 0;
  state.outputLevel = 0;
}

export function attachAliveRealtimeActions(
  state: AliveRealtimeState,
): { disposeChatWatcher: () => void } {
  const inputMeter: LevelMeter = createLevelMeter();
  const outputMeter: LevelMeter = createLevelMeter();

  let controlsHideTimer: ReturnType<typeof setTimeout> | null = null;
  let outputAudioContext: AudioContext | null = null;
  let outputQueue: RealtimeTalkPcmOutputQueue | null = null;
  let pannerNode: PannerNode | null = null;
  let chatUnsubscribe: (() => void) | null = null;
  let chatWatchSessionKey: string | null = null;

  // Ordered "Voz" roster candidates for the *current* talk activation (reset
  // on every fresh "Falar" click, not on an automatic retry) plus how many
  // we've already tried, so a persistent billing failure doesn't loop.
  let voiceFailoverCandidates: string[] = [];
  let voiceFailoverIndex = 0;

  const showControlsWithAutoHide = () => {
    state.controlsVisible = true;
    if (controlsHideTimer !== null) {
      clearTimeout(controlsHideTimer);
    }
    controlsHideTimer = setTimeout(() => {
      state.controlsVisible = false;
      controlsHideTimer = null;
      state.requestUpdate();
    }, CONTROLS_AUTO_HIDE_MS);
    state.requestUpdate();
  };

  state.toggleControlsVisible = () => {
    if (controlsHideTimer !== null) {
      clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
    state.controlsVisible = !state.controlsVisible;
    state.requestUpdate();
  };

  const maybeAttachSpatialAudio = () => {
    if (!outputAudioContext || !outputQueue || pannerNode) {
      return;
    }
    const spatialAudio = readSpatialAudioSettings(state.getConfigObject());
    const panner = outputAudioContext.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = spatialAudio.refDistance;
    panner.maxDistance = spatialAudio.maxDistance;
    panner.rolloffFactor = spatialAudio.rolloffFactor;
    // The orb never moves — it's fixed at the scene's world origin, so the
    // sound source position is set once and never updated per frame.
    if (panner.positionX) {
      panner.positionX.value = 0;
      panner.positionY.value = 0.4;
      panner.positionZ.value = 0;
    } else if (typeof panner.setPosition === "function") {
      panner.setPosition(0, 0.4, 0);
    }
    panner.connect(outputAudioContext.destination);
    pannerNode = panner;
    outputQueue.spatialDestination = panner;
  };

  state.updateListenerPosition = (x: number, y: number, z: number) => {
    const ctx = outputAudioContext;
    if (!ctx) {
      return;
    }
    const listener = ctx.listener;
    if (listener.positionX) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
    } else if (typeof listener.setPosition === "function") {
      listener.setPosition(x, y, z);
    }
  };

  const watchChatForImages = (client: GatewayBrowserClient, sessionKey: string) => {
    if (chatWatchSessionKey === sessionKey && chatUnsubscribe) {
      return;
    }
    chatUnsubscribe?.();
    chatWatchSessionKey = sessionKey;
    chatUnsubscribe = client.addEventListener((evt: GatewayEventFrame) => {
      if (evt.event !== "chat") {
        return;
      }
      const payload = evt.payload as ChatEventPayload | undefined;
      if (!payload || payload.sessionKey !== sessionKey || payload.state !== "final") {
        return;
      }
      const images = extractImages(payload.message);
      const last = images.at(-1);
      if (!last) {
        return;
      }
      state.latestImageUrl = buildAssistantAttachmentUrl(last.url, state.basePath);
      state.requestUpdate();
    });
  };

  // `explicitProvider` is only ever set for an automatic failover retry —
  // the normal path leaves it unset so the gateway auto-picks the
  // highest-starred configured candidate itself.
  const startSession = (explicitProvider?: string) => {
    if (!state.client) {
      return;
    }
    watchChatForImages(state.client, state.sessionKey);
    const launchOptions: RealtimeTalkLaunchOptions = {
      ...(explicitProvider ? { provider: explicitProvider } : {}),
    };
    state.activeVoiceProvider = explicitProvider ?? null;
    state.realtimeActive = true;
    state.realtimeStatus = "connecting";
    state.realtimeDetail = null;
    const session = new RealtimeTalkSession(
      state.client,
      state.sessionKey,
      {
        onStatus: (status, detail) => {
          if (status === "error" && maybeRetryOnBillingFailure(detail)) {
            return;
          }
          state.realtimeStatus = status;
          state.realtimeDetail = detail ?? null;
          state.realtimeActive = status !== "idle";
          if (status === "idle" || status === "error") {
            inputMeter.reset();
            outputMeter.reset();
            state.inputLevel = 0;
            state.outputLevel = 0;
          }
          state.requestUpdate();
        },
        onTranscript: (entry) => {
          if (entry.role === "user" && entry.final && detectSettingsIntent(entry.text)) {
            showControlsWithAutoHide();
          }
        },
        onAudioLevel: (level) => {
          const meter = level.source === "input" ? inputMeter : outputMeter;
          const published = meter.push(level.rms);
          if (published === null) {
            return;
          }
          if (level.source === "input") {
            state.inputLevel = published;
          } else {
            state.outputLevel = published;
          }
          state.requestUpdate();
        },
        onOutputContextReady: (ctx) => {
          outputAudioContext = ctx;
          maybeAttachSpatialAudio();
        },
        onOutputQueueReady: (queue) => {
          outputQueue = queue;
          maybeAttachSpatialAudio();
        },
      },
      launchOptions,
    );
    state.session = session;
    void session.start().catch((error: unknown) => {
      if (maybeRetryOnBillingFailure(error instanceof Error ? error.message : String(error))) {
        return;
      }
      session.stop();
      state.session = null;
      state.realtimeActive = false;
      state.realtimeStatus = "error";
      state.realtimeDetail = error instanceof Error ? error.message : String(error);
      state.requestUpdate();
    });
  };

  /** Returns true (and has already kicked off a retry) when a failure looks
   * credit-related, auto-failover is on, and an untried starred candidate
   * remains — callers should treat the failure as handled and not surface
   * it as a terminal error. */
  const maybeRetryOnBillingFailure = (detail: string | null | undefined): boolean => {
    if (!isVoiceAutoFailoverEnabled(state.getConfigObject()) || !looksLikeVoiceBillingError(detail)) {
      return false;
    }
    const nextIndex = voiceFailoverIndex + 1;
    if (nextIndex >= voiceFailoverCandidates.length) {
      return false;
    }
    voiceFailoverIndex = nextIndex;
    state.session?.stop();
    state.session = null;
    startSession(voiceFailoverCandidates[voiceFailoverIndex]);
    return true;
  };

  state.toggleAliveVoice = async () => {
    if (state.session) {
      stopAliveSession(state);
      inputMeter.reset();
      outputMeter.reset();
      state.requestUpdate();
      return;
    }
    if (!state.client || !state.connected) {
      state.realtimeStatus = "error";
      state.realtimeDetail = "Gateway not connected";
      state.requestUpdate();
      return;
    }
    voiceFailoverCandidates = resolveVoiceFailoverProviderOrder(state.getConfigObject());
    voiceFailoverIndex = 0;
    startSession();
  };

  return {
    disposeChatWatcher: () => {
      chatUnsubscribe?.();
      chatUnsubscribe = null;
      if (controlsHideTimer !== null) {
        clearTimeout(controlsHideTimer);
        controlsHideTimer = null;
      }
    },
  };
}
