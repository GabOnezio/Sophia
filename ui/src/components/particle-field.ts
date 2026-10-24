// Control UI shell decoration: a living, drifting particle field behind the
// whole app when the "sophia" theme is active. Mounted once in app-host.ts
// (persists across route navigations, unlike page-scoped components) as a
// plain 2D canvas — three.js/WebGL is reserved for the Alive page's scene;
// this only needs a few dozen soft dots and would not justify a WebGL
// context on every single page of the app.
import { html, LitElement } from "lit";

type Particle = {
  x: number;
  y: number;
  radius: number;
  baseAlpha: number;
  driftAngle: number;
  driftSpeed: number;
  wobbleSpeed: number;
  wobblePhase: number;
};

const MIN_PARTICLES = 50;
const MAX_PARTICLES = 130;
const PARTICLES_PER_MEGAPIXEL = 28;

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isSophiaTheme(): boolean {
  return Boolean(document.documentElement.dataset.theme?.startsWith("sophia"));
}

function readAccentColor(): string {
  if (typeof getComputedStyle !== "function") {
    return "#a3e635";
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return value || "#a3e635";
}

function makeParticles(count: number, width: number, height: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 1 + Math.random() * 2.2,
      baseAlpha: 0.15 + Math.random() * 0.35,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: 3 + Math.random() * 8,
      wobbleSpeed: 0.15 + Math.random() * 0.35,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }
  return particles;
}

class ParticleField extends LitElement {
  override createRenderRoot() {
    return this;
  }

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private lastFrameAtMs = 0;
  private width = 0;
  private height = 0;
  private themeObserver: MutationObserver | null = null;

  override firstUpdated() {
    this.canvas = this.querySelector<HTMLCanvasElement>("canvas");
    this.ctx = this.canvas?.getContext("2d") ?? null;
    if (!this.canvas || !this.ctx) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(document.documentElement);
    this.handleResize();
    this.themeObserver = new MutationObserver(() => this.handleResize());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    if (prefersReducedMotion()) {
      this.drawStaticFrame();
      return;
    }
    this.lastFrameAtMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }

  private handleResize(): void {
    if (!this.canvas || !this.ctx) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const megapixels = (this.width * this.height) / 1_000_000;
    const count = Math.round(
      Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, megapixels * PARTICLES_PER_MEGAPIXEL)),
    );
    this.particles = makeParticles(count, this.width, this.height);
    if (prefersReducedMotion()) {
      this.drawStaticFrame();
    }
  }

  private drawStaticFrame(): void {
    this.paint(isSophiaTheme() ? 1 : 0);
  }

  private readonly tick = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const deltaSec = Math.min(0.1, (nowMs - this.lastFrameAtMs) / 1000);
    this.lastFrameAtMs = nowMs;
    if (!isSophiaTheme()) {
      this.paint(0);
      return;
    }
    for (const particle of this.particles) {
      particle.x += Math.cos(particle.driftAngle) * particle.driftSpeed * deltaSec;
      particle.y += Math.sin(particle.driftAngle) * particle.driftSpeed * deltaSec;
      particle.wobblePhase += particle.wobbleSpeed * deltaSec;
      particle.driftAngle += Math.sin(particle.wobblePhase) * 0.01;
      if (particle.x < -10) particle.x = this.width + 10;
      if (particle.x > this.width + 10) particle.x = -10;
      if (particle.y < -10) particle.y = this.height + 10;
      if (particle.y > this.height + 10) particle.y = -10;
    }
    this.paint(1);
  };

  private paint(opacityMultiplier: number): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    if (opacityMultiplier <= 0) {
      return;
    }
    const color = readAccentColor();
    for (const particle of this.particles) {
      const flicker = 0.75 + 0.25 * Math.sin(particle.wobblePhase * 2);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.globalAlpha = particle.baseAlpha * flicker * opacityMultiplier;
      ctx.shadowColor = color;
      ctx.shadowBlur = particle.radius * 4;
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  override render() {
    return html`<canvas
      style="position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;"
    ></canvas>`;
  }
}

if (!customElements.get("openclaw-particle-field")) {
  customElements.define("openclaw-particle-field", ParticleField);
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-particle-field": ParticleField;
  }
}
