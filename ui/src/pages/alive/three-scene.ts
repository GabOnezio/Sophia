// Control UI Alive page: the 3D scene — a living sphere in an ambient space,
// reacting to mic input level (user talking), TTS output level (her
// talking), and her "thinking" status. The user can walk around with
// WASD/arrow keys + mouse-look; the sphere stays fixed at the world origin,
// and a custom "alive-camera-move" event reports the camera's position so
// the page can drive distance-based spatial audio. Raw three.js wrapped in
// a LitElement (this stack is Lit, not React, so no @react-three/fiber) —
// isolated to this page's lazy route chunk so the main app bundle never
// pays for it.
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
import * as THREE from "three";
import type { RealtimeTalkStatus } from "../chat/realtime-talk.ts";

const IDLE_ROTATION_SPEED = 0.08; // radians/sec, paused near-silence fades in/out
const MAX_SCALE_BOOST = 0.42; // sphere grows up to +42% at full audio level
const THINKING_BASE_SCALE = 1.15;
const THINKING_OSC_AMPLITUDE = 0.06;
const THINKING_OSC_FREQUENCY = 0.0035; // rad/ms, ~1.8s breathing cycle
const SPHERE_BASE_RADIUS = 1;
const POINT_COUNT = 260;
const POINT_FIELD_RADIUS = 9;
const GRID_SIZE = 24;
const GRID_DIVISIONS = 24;
const ORB_POSITION = new THREE.Vector3(0, 0.4, 0);
const IDLE_ORBIT_RADIUS = 6.5;
const EYE_HEIGHT = 1.6;
const MOVE_SPEED = 4; // units/sec
const MOVE_BOUND_RADIUS = 14;
const LOOK_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI * 0.47;
const IMAGE_PLANE_MAX_WIDTH = 2.2;
const IMAGE_PLANE_POSITION = new THREE.Vector3(2.6, 1.3, -0.4);
const IMAGE_FADE_DURATION_MS = 500;

export type AliveSceneStatus = RealtimeTalkStatus | "idle";

type MoveState = { forward: boolean; back: boolean; left: boolean; right: boolean };

function readCssColor(varName: string, fallbackHex: number): THREE.Color {
  if (typeof getComputedStyle !== "function") {
    return new THREE.Color(fallbackHex);
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) {
    return new THREE.Color(fallbackHex);
  }
  try {
    return new THREE.Color(raw);
  } catch {
    return new THREE.Color(fallbackHex);
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export class AliveScene extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property({ type: Number, attribute: false }) inputLevel = 0;
  @property({ type: Number, attribute: false }) outputLevel = 0;
  @property({ type: Boolean, attribute: false }) active = false;
  @property({ type: String, attribute: false }) status: AliveSceneStatus = "idle";
  @property({ type: String, attribute: false }) latestImageUrl: string | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private sphere: THREE.Mesh | null = null;
  private sphereMaterial: THREE.MeshStandardMaterial | null = null;
  private rimLight: THREE.PointLight | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private lastFrameAtMs = 0;
  private cameraAngle = 0;
  private currentScale = 1;
  private readonly reducedMotion = prefersReducedMotion();

  // Movement/look state.
  private readonly moveState: MoveState = { forward: false, back: false, left: false, right: false };
  private manualControl = false;
  private yaw = 0;
  private pitch = -0.15;
  private dragging = false;
  private pointerLocked = false;
  private lastReportedCameraKey = "";

  // Generated-image plane.
  private imagePlane: THREE.Mesh | null = null;
  private imagePlaneMaterial: THREE.MeshBasicMaterial | null = null;
  private imageTexture: THREE.Texture | null = null;
  private imageFadeStartMs = 0;
  private imageLoadToken = 0;

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (this.applyKeyState(event.code, true)) {
      event.preventDefault();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    this.applyKeyState(event.code, false);
  };

  // Movement keys held right now, cleared if the window loses focus mid-hold
  // (alt-tab, an OS shortcut stealing the key) so a keyup that never fires
  // can't leave the mic permanently muted.
  private movementKeysActive = false;

  private readonly handleWindowBlur = () => {
    if (
      !this.moveState.forward &&
      !this.moveState.back &&
      !this.moveState.left &&
      !this.moveState.right
    ) {
      return;
    }
    this.moveState.forward = false;
    this.moveState.back = false;
    this.moveState.left = false;
    this.moveState.right = false;
    this.reportMovementActiveState();
  };

  private applyKeyState(code: string, pressed: boolean): boolean {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        this.moveState.forward = pressed;
        break;
      case "KeyS":
      case "ArrowDown":
        this.moveState.back = pressed;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.moveState.left = pressed;
        break;
      case "KeyD":
      case "ArrowRight":
        this.moveState.right = pressed;
        break;
      default:
        return false;
    }
    this.reportMovementActiveState();
    return true;
  }

  /** Reports whether any movement key is currently held — the Alive page
   * uses this to gate the realtime session's mic while WASD/arrow keys are
   * down, so keyboard click noise can't get picked up as speech and trigger
   * a false barge-in that cuts her off mid-reply. Only fires on an actual
   * state change (key-down/up transitions), not per animation frame. */
  private reportMovementActiveState(): void {
    const active =
      this.moveState.forward || this.moveState.back || this.moveState.left || this.moveState.right;
    if (active === this.movementKeysActive) {
      return;
    }
    this.movementKeysActive = active;
    this.dispatchEvent(
      new CustomEvent("alive-movement-active", {
        detail: { active },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleWindowBlur);
  }

  override firstUpdated() {
    this.canvas = this.querySelector<HTMLCanvasElement>("canvas.alive-scene__canvas");
    if (!this.canvas) {
      return;
    }
    this.setupScene(this.canvas);
    this.setupPointerControls(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this);
    this.handleResize();
    this.lastFrameAtMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("latestImageUrl")) {
      this.handleImageChange();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sphere?.geometry.dispose();
    this.sphereMaterial?.dispose();
    this.disposeImagePlane();
    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        const material = obj.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose());
        } else {
          material?.dispose();
        }
      }
    });
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.sphere = null;
    this.sphereMaterial = null;
    this.rimLight = null;
  }

  private setupScene(canvas: HTMLCanvasElement): void {
    const accent = readCssColor("--accent", 0xa3e635);
    const bg = readCssColor("--bg", 0x070907);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(bg.getHex(), 0.045);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, EYE_HEIGHT, IDLE_ORBIT_RADIUS);
    camera.lookAt(ORB_POSITION);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    const sphereGeometry = new THREE.IcosahedronGeometry(SPHERE_BASE_RADIUS, 4);
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.55,
      metalness: 0.15,
      roughness: 0.35,
      flatShading: true,
    });
    this.sphereMaterial = sphereMaterial;
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.copy(ORB_POSITION);
    this.sphere = sphere;
    scene.add(sphere);

    const ambient = new THREE.AmbientLight(bg.getHex(), 0.6);
    scene.add(ambient);
    const keyLight = new THREE.PointLight(accent, 12, 20);
    keyLight.position.set(3, 4, 4);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x6fb8ff, 6, 15);
    rimLight.position.set(-3, 1, -2);
    this.rimLight = rimLight;
    scene.add(rimLight);

    const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, accent, accent);
    const gridMaterial = grid.material;
    if (!Array.isArray(gridMaterial)) {
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.08;
    }
    grid.position.y = -1.4;
    scene.add(grid);

    scene.add(this.buildPointField(accent));
  }

  private buildPointField(color: THREE.Color): THREE.Points {
    const positions = new Float32Array(POINT_COUNT * 3);
    for (let i = 0; i < POINT_COUNT; i += 1) {
      const radius = POINT_FIELD_RADIUS * (0.35 + Math.random() * 0.65);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.5;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color,
      size: 0.035,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  private handleResize(): void {
    if (!this.renderer || !this.camera || !this.canvas) {
      return;
    }
    const width = Math.max(1, this.clientWidth);
    const height = Math.max(1, this.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // ---- Movement / look controls ----

  private readonly handlePointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  private setupPointerControls(canvas: HTMLCanvasElement): void {
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    canvas.addEventListener("click", () => {
      canvas.requestPointerLock?.();
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (this.pointerLocked) {
        return;
      }
      this.dragging = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
    });
    const endDrag = (event: PointerEvent) => {
      this.dragging = false;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // No-op if capture was never set.
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointermove", (event) => {
      if (!this.pointerLocked && !this.dragging) {
        return;
      }
      this.applyLookDelta(event.movementX, event.movementY);
    });
  }

  private applyLookDelta(movementX: number, movementY: number): void {
    if (!movementX && !movementY) {
      return;
    }
    this.enterManualControl();
    this.yaw -= movementX * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - movementY * LOOK_SENSITIVITY));
  }

  /** Hands off from idle auto-orbit to manual control, preserving the
   * camera's current facing direction so there's no visual snap. */
  private enterManualControl(): void {
    if (this.manualControl || !this.camera) {
      return;
    }
    this.manualControl = true;
    this.yaw = this.cameraAngle;
    const dy = this.camera.position.y - ORB_POSITION.y;
    this.pitch = -Math.atan2(dy, IDLE_ORBIT_RADIUS);
  }

  private updateMovement(deltaSec: number): void {
    if (!this.camera) {
      return;
    }
    if (
      this.moveState.forward ||
      this.moveState.back ||
      this.moveState.left ||
      this.moveState.right
    ) {
      this.enterManualControl();
    }
    if (!this.manualControl) {
      return;
    }

    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const moveForward = (this.moveState.forward ? 1 : 0) - (this.moveState.back ? 1 : 0);
    const moveRight = (this.moveState.right ? 1 : 0) - (this.moveState.left ? 1 : 0);
    if (moveForward !== 0 || moveRight !== 0) {
      const step = MOVE_SPEED * deltaSec;
      const dx = (forwardX * moveForward + rightX * moveRight) * step;
      const dz = (forwardZ * moveForward + rightZ * moveRight) * step;
      const nextX = this.camera.position.x + dx;
      const nextZ = this.camera.position.z + dz;
      const dist = Math.hypot(nextX, nextZ);
      if (dist <= MOVE_BOUND_RADIUS) {
        this.camera.position.x = nextX;
        this.camera.position.z = nextZ;
      } else {
        const scale = MOVE_BOUND_RADIUS / dist;
        this.camera.position.x = nextX * scale;
        this.camera.position.z = nextZ * scale;
      }
    }

    const lookDir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.camera.lookAt(this.camera.position.clone().add(lookDir));

    this.reportCameraPosition();
  }

  private reportCameraPosition(): void {
    if (!this.camera) {
      return;
    }
    const { x, y, z } = this.camera.position;
    const key = `${x.toFixed(2)}:${y.toFixed(2)}:${z.toFixed(2)}`;
    if (key === this.lastReportedCameraKey) {
      return;
    }
    this.lastReportedCameraKey = key;
    this.dispatchEvent(
      new CustomEvent("alive-camera-move", {
        detail: { x, y, z },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---- Generated-image plane ----

  private disposeImagePlane(): void {
    if (this.imagePlane) {
      this.scene?.remove(this.imagePlane);
      this.imagePlane.geometry.dispose();
    }
    this.imagePlaneMaterial?.dispose();
    this.imageTexture?.dispose();
    this.imagePlane = null;
    this.imagePlaneMaterial = null;
    this.imageTexture = null;
  }

  private handleImageChange(): void {
    const url = this.latestImageUrl;
    this.imageLoadToken += 1;
    const token = this.imageLoadToken;
    if (!url) {
      this.disposeImagePlane();
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        if (token !== this.imageLoadToken || !this.scene) {
          texture.dispose();
          return;
        }
        this.disposeImagePlane();
        const image = texture.image as { width?: number; height?: number } | undefined;
        const aspect =
          image?.width && image.height ? image.width / image.height : 1;
        const width = IMAGE_PLANE_MAX_WIDTH;
        const height = width / Math.max(aspect, 0.2);
        const geometry = new THREE.PlaneGeometry(width, height);
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0,
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.copy(IMAGE_PLANE_POSITION);
        this.imageTexture = texture;
        this.imagePlaneMaterial = material;
        this.imagePlane = plane;
        this.imageFadeStartMs = performance.now();
        this.scene.add(plane);
      },
      undefined,
      () => {
        // Failed to load (e.g. needs an auth ticket this v1 doesn't handle) —
        // silently skip rather than showing a broken plane.
        if (token === this.imageLoadToken) {
          this.imageLoadToken += 1;
        }
      },
    );
  }

  private updateImagePlane(nowMs: number): void {
    if (!this.imagePlane || !this.camera || !this.imagePlaneMaterial) {
      return;
    }
    this.imagePlane.lookAt(this.camera.position);
    const elapsed = nowMs - this.imageFadeStartMs;
    const targetOpacity = Math.min(1, elapsed / IMAGE_FADE_DURATION_MS);
    this.imagePlaneMaterial.opacity = targetOpacity;
  }

  // ---- Render loop ----

  private readonly tick = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const deltaSec = Math.min(0.1, (nowMs - this.lastFrameAtMs) / 1000);
    this.lastFrameAtMs = nowMs;
    if (!this.renderer || !this.scene || !this.camera || !this.sphere || !this.sphereMaterial) {
      return;
    }

    const thinking = this.status === "thinking";
    const level = Math.max(this.inputLevel, this.outputLevel);
    const targetScale = thinking
      ? THINKING_BASE_SCALE + Math.sin(nowMs * THINKING_OSC_FREQUENCY) * THINKING_OSC_AMPLITUDE
      : 1 + level * MAX_SCALE_BOOST;
    const easing = this.reducedMotion ? 0.35 : thinking ? 0.12 : 0.18;
    this.currentScale += (targetScale - this.currentScale) * easing;
    this.sphere.scale.setScalar(this.currentScale);

    // Her voice (output) pushes the core emissive brighter; the user's voice
    // (input) leans the rim light cooler — a cheap way to visually
    // distinguish "you're talking" from "she's talking" without two meshes.
    // While thinking, keep a steady mid-level glow instead of tracking audio
    // (there's no audio yet — she hasn't started speaking).
    this.sphereMaterial.emissiveIntensity = thinking ? 0.75 : 0.5 + this.outputLevel * 0.9;
    if (this.rimLight) {
      this.rimLight.intensity = 6 + this.inputLevel * 14;
    }

    if (this.manualControl) {
      this.updateMovement(deltaSec);
    } else {
      const silence = level < 0.03;
      const rotationSpeed = this.reducedMotion
        ? IDLE_ROTATION_SPEED * 0.25
        : silence
          ? IDLE_ROTATION_SPEED
          : IDLE_ROTATION_SPEED * 0.35;
      this.cameraAngle += rotationSpeed * deltaSec;
      this.camera.position.x = Math.sin(this.cameraAngle) * IDLE_ORBIT_RADIUS;
      this.camera.position.z = Math.cos(this.cameraAngle) * IDLE_ORBIT_RADIUS;
      this.camera.lookAt(ORB_POSITION);
      this.reportCameraPosition();
    }

    this.updateImagePlane(nowMs);

    this.renderer.render(this.scene, this.camera);
  };

  override render() {
    return html`<canvas class="alive-scene__canvas"></canvas>`;
  }
}

if (!customElements.get("openclaw-alive-scene")) {
  customElements.define("openclaw-alive-scene", AliveScene);
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-alive-scene": AliveScene;
  }
}
