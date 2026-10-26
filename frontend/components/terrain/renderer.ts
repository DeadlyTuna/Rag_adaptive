// Imperative three.js renderer for the knowledge terrain. React hands it targets
// (items, mode, pings, pulses); it springs everything toward them every frame.

import * as THREE from "three";
import { fragmentShader, MAX_ITEMS, MAX_MARKERS, vertexShader } from "./shaders";
import { EXTENT } from "@/lib/engine/project";

export type TerrainMode = "flat" | "relief" | "hero";

export interface TItem {
  id: string;
  x: number;
  y: number;
  w: number;
  mem: number;
  sigma: number;
  ghost?: boolean;
  kind: "document" | "memory";
  label: string;
  short?: string;
}

interface Body extends TItem {
  tx: number;
  ty: number;
  tw: number;
  tm: number;
  ts: number;
  born: boolean;
}

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
  height: number;
  solid: number;
  flat: number;
  orbit: number;
}

type Ripple = { id: string; start: number; type: number; dur: number };

export interface RendererOptions {
  ambient: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  labelMode: "auto" | "none";
  compactLabels?: boolean;
  interactive: boolean;
}

const PLANE: [number, number] = [EXTENT[0] * 1.32, EXTENT[1] * 1.42];

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function presets(aspect: number): Record<TerrainMode, Pose> {
  const fovFlat = 26;
  const tanF = Math.tan(((fovFlat / 2) * Math.PI) / 180);
  const halfW = EXTENT[0] * 1.07;
  const halfH = EXTENT[1] * 1.12;
  const dist = Math.max(halfH / tanF, halfW / (tanF * aspect));
  const fit = Math.max(1, 1.75 / Math.max(aspect, 0.5));
  return {
    flat: {
      pos: new THREE.Vector3(0, 0, dist),
      target: new THREE.Vector3(0, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      fov: fovFlat,
      height: 0,
      solid: 0,
      flat: 1,
      orbit: 0,
    },
    relief: {
      pos: new THREE.Vector3(0, -2.05 * fit, 1.62 * fit),
      target: new THREE.Vector3(0, 0.1, 0),
      up: new THREE.Vector3(0, 0, 1),
      fov: 34,
      height: 0.42,
      solid: 1,
      flat: 0,
      orbit: 0.06,
    },
    hero: {
      pos: new THREE.Vector3(0.15, -2.55 * Math.max(1, fit * 0.85), 0.66 * Math.max(1, fit * 0.8)),
      target: new THREE.Vector3(0, 0.4, 0.3),
      up: new THREE.Vector3(0, 0, 1),
      fov: 33,
      height: 0.55,
      solid: 1,
      flat: 0,
      orbit: 0.22,
    },
  };
}

function clonePose(p: Pose): Pose {
  return { ...p, pos: p.pos.clone(), target: p.target.clone(), up: p.up.clone() };
}

export type TerrainPalette = "source" | "staleness";
const PALETTES: Record<TerrainPalette, [string, string, string]> = {
  source: ["#8fcbff", "#e6f2ee", "#ff6b93"],
  staleness: ["#5fd0b8", "#e6f2ee", "#ff8a5c"],
};

export class TerrainRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private data = new Float32Array(MAX_ITEMS * 2 * 4);
  private tex: THREE.DataTexture;
  private bodies = new Map<string, Body>();
  private mode: TerrainMode = "flat";
  private pose: Pose;
  private from: Pose | null = null;
  private to: Pose;
  private camT = 1;
  private camDur = 1.6;
  private norm = 1;
  private ambientClock = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private visible = true;
  private disposed = false;
  private size = { w: 1, h: 1 };
  private hoverId: string | null = null;
  private pickedId: string | null = null;
  private highlight: string[] = [];
  private forcedLabels: string[] = [];
  private ripples: Ripple[] = [];
  private pingState: { x: number; y: number; start: number } | null = null;
  private probe = { x: 0, y: 0, s: 0, ts: 0 };
  private labelEls = new Map<string, HTMLDivElement>();
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private reduced: boolean;
  private canvas: HTMLCanvasElement;

  constructor(
    private host: HTMLElement,
    private labelLayer: HTMLDivElement,
    private opts: RendererOptions,
    ariaLabel: string,
  ) {
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // a fresh canvas per renderer: a disposed context can't be reused (StrictMode remounts)
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 block";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", ariaLabel);
    host.prepend(canvas);
    this.canvas = canvas;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (err) {
      canvas.remove();
      throw err;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.tex = new THREE.DataTexture(this.data, MAX_ITEMS, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;

    const markers = Array.from({ length: MAX_MARKERS }, () => new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uItems: { value: this.tex },
        uCount: { value: 0 },
        uNorm: { value: 1 },
        uHeight: { value: 0 },
        uDoc: { value: hex("#8fcbff") },
        uMem: { value: hex("#ff6b93") },
        uNeutral: { value: hex("#e6f2ee") },
        uPingColor: { value: hex("#ffc14d") },
        uFlare: { value: hex("#ff8a7a") },
        uGround: { value: hex("#0b2629") },
        uRaised: { value: hex("#1a464c") },
        uTime: { value: 0 },
        uClock: { value: 0 },
        uLevels: { value: 14 },
        uSolid: { value: 0 },
        uFlat: { value: 1 },
        uLineW: { value: 1.2 },
        uExtent: { value: new THREE.Vector2(PLANE[0], PLANE[1]) },
        uPing: { value: new THREE.Vector4(0, 0, -10, 0) },
        uProbe: { value: new THREE.Vector3(0, 0, 0) },
        uMarkers: { value: markers },
      },
    });
    const geo = new THREE.PlaneGeometry(PLANE[0] * 2, PLANE[1] * 2, 260, 150);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const p = presets(1.6);
    this.pose = clonePose(p.flat);
    this.to = clonePose(p.flat);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.kick();
    });
    this.io.observe(canvas);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (opts.interactive) {
      canvas.addEventListener("pointermove", this.onPointerMove);
      canvas.addEventListener("pointerleave", this.onPointerLeave);
      canvas.addEventListener("click", this.onClick);
    }
    this.resize();
  }

  // ------------------------------------------------------------------ inputs

  /** Colour the map by source (documents → memories) or by staleness (fresh → stale);
   * either way an item's `mem` value in [0, 1] picks the colour. */
  setPalette(palette: TerrainPalette) {
    const p = PALETTES[palette];
    const u = this.material.uniforms;
    u.uDoc.value = hex(p[0]);
    u.uNeutral.value = hex(p[1]);
    u.uMem.value = hex(p[2]);
    this.kick();
  }

  setItems(items: TItem[], instant = false) {
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      const b = this.bodies.get(it.id);
      if (b) {
        Object.assign(b, { ghost: it.ghost, label: it.label, short: it.short, kind: it.kind });
        b.tx = it.x;
        b.ty = it.y;
        b.tw = it.w;
        b.tm = it.mem;
        b.ts = it.sigma;
        if (instant) Object.assign(b, { x: it.x, y: it.y, w: it.w, mem: it.mem, sigma: it.sigma });
      } else {
        const born = !instant && this.bodies.size > 0;
        this.bodies.set(it.id, {
          ...it,
          w: born ? 0 : it.w,
          tx: it.x,
          ty: it.y,
          tw: it.w,
          tm: it.mem,
          ts: it.sigma,
          born,
        });
      }
    }
    for (const [id, b] of this.bodies) if (!seen.has(id)) b.tw = -1; // fade out, then drop
    this.kick();
  }

  private focus: { x: number; y: number; zoom: number } | null = null;

  /** Pose for the current mode, optionally pulled in toward a focus point. */
  private poseFor(mode: TerrainMode): Pose {
    const p = clonePose(presets(this.size.w / this.size.h)[mode]);
    if (this.focus && mode !== "flat") {
      const rel = p.pos.clone().sub(p.target);
      p.target.set(this.focus.x, this.focus.y + 0.05, p.target.z);
      p.pos.copy(p.target).add(rel.multiplyScalar(this.focus.zoom));
      p.orbit *= 0.4;
    }
    return p;
  }

  setFocus(focus: { x: number; y: number; zoom: number } | null) {
    const same = (!focus && !this.focus) || (focus && this.focus && focus.x === this.focus.x && focus.y === this.focus.y && focus.zoom === this.focus.zoom);
    if (same) return;
    this.focus = focus;
    this.from = clonePose(this.pose);
    this.to = this.poseFor(this.mode);
    this.camT = this.reduced ? 1 : 0;
    if (this.reduced) this.pose = clonePose(this.to);
    this.kick();
  }

  setMode(mode: TerrainMode, instant = false) {
    if (mode === this.mode && !instant) return;
    this.mode = mode;
    const target = this.poseFor(mode);
    if (instant || this.reduced) {
      this.pose = clonePose(target);
      this.to = clonePose(target);
      this.camT = 1;
    } else {
      this.from = clonePose(this.pose);
      this.to = clonePose(target);
      this.camT = 0;
    }
    this.kick();
  }

  /** Flatten every peak so the whole terrain rises into place (intro). */
  rise() {
    for (const b of this.bodies.values()) b.w = 0;
    this.kick();
  }

  setHighlight(ids: string[]) {
    this.highlight = ids;
    this.kick();
  }

  setForcedLabels(ids: string[]) {
    this.forcedLabels = ids;
    this.kick();
  }

  setHover(id: string | null) {
    this.hoverId = id;
    this.kick();
  }

  setLabelMode(mode: "auto" | "none") {
    this.opts.labelMode = mode;
    if (mode === "none") {
      for (const el of this.labelEls.values()) el.remove();
      this.labelEls.clear();
    }
    this.kick();
  }

  setAmbient(on: boolean) {
    this.opts.ambient = on;
    this.kick();
  }

  ping(pos: [number, number]) {
    this.pingState = { x: pos[0], y: pos[1], start: this.clock + 0.05 };
    this.kick();
  }

  pulse(ids: string[], kind: string) {
    const type = kind === "flag" ? 5 : kind === "ingest" ? 6 : kind === "expire" ? 7 : 4;
    for (const id of ids.slice(0, 6)) this.ripples.push({ id, start: this.clock + Math.random() * 0.15, type, dur: 2.2 });
    this.kick();
  }

  /** Landing page: the cursor acts as a query probe over the terrain. */
  setProbe(clientX: number, clientY: number, active: boolean) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.12 * this.pose.height);
    const hit = new THREE.Vector3();
    const ok = ray.ray.intersectPlane(plane, hit);
    if (ok && active && Math.abs(hit.x) < PLANE[0] && Math.abs(hit.y) < PLANE[1]) {
      this.probe.x = hit.x;
      this.probe.y = hit.y;
      this.probe.ts = 1;
    } else this.probe.ts = 0;
    this.kick();
  }

  // ------------------------------------------------------------------ loop

  private kick() {
    if (this.running || this.disposed || !this.visible || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private onVisibility = () => {
    if (!document.hidden) this.kick();
  };

  private frame = (now: number) => {
    if (this.disposed) return;
    // real elapsed time (clamped generously) so throttled tabs still finish transitions
    const dt = Math.min(0.25, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    const ambient = this.opts.ambient && !this.reduced;
    if (ambient) this.ambientClock += dt;

    let busy = false;

    // springs: positions quick, weights slower (subsidence reads as a slow sink)
    const kPos = 1 - Math.exp(-dt * 4.2);
    const kW = 1 - Math.exp(-dt * (this.reduced ? 12 : 2.4));
    for (const [id, b] of this.bodies) {
      const tw = Math.max(0, b.tw);
      b.x += (b.tx - b.x) * kPos;
      b.y += (b.ty - b.y) * kPos;
      b.w += (tw - b.w) * kW;
      b.mem += (b.tm - b.mem) * kPos;
      b.sigma += (b.ts - b.sigma) * kPos;
      if (Math.abs(b.tx - b.x) > 1e-4 || Math.abs(b.ty - b.y) > 1e-4 || Math.abs(tw - b.w) > 1e-3) busy = true;
      if (b.tw < 0 && b.w < 0.002) this.bodies.delete(id);
    }

    // normalise heights so the tallest peak sits at 1
    const list = [...this.bodies.values()];
    let maxF = 0;
    for (const a of list) {
      if (a.w < 0.01) continue;
      let f = 0;
      for (const b of list) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        f += b.w * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
      }
      if (f > maxF) maxF = f;
    }
    const targetNorm = 1 / Math.max(maxF, 0.85);
    this.norm += (targetNorm - this.norm) * kPos;
    if (Math.abs(targetNorm - this.norm) > 1e-3) busy = true;

    // camera
    if (this.camT < 1 && this.from) {
      this.camT = Math.min(1, this.camT + dt / this.camDur);
      const e = easeInOut(this.camT);
      this.pose.pos.lerpVectors(this.from.pos, this.to.pos, e);
      this.pose.target.lerpVectors(this.from.target, this.to.target, e);
      this.pose.up.lerpVectors(this.from.up, this.to.up, e).normalize();
      this.pose.fov = this.from.fov + (this.to.fov - this.from.fov) * e;
      this.pose.height = this.from.height + (this.to.height - this.from.height) * e;
      this.pose.solid = this.from.solid + (this.to.solid - this.from.solid) * e;
      this.pose.flat = this.from.flat + (this.to.flat - this.from.flat) * e;
      this.pose.orbit = this.from.orbit + (this.to.orbit - this.from.orbit) * e;
      busy = true;
    }
    const sway = ambient ? Math.sin(this.ambientClock * 0.09) * this.pose.orbit : 0;
    const rel = this.pose.pos.clone().sub(this.pose.target);
    rel.applyAxisAngle(new THREE.Vector3(0, 0, 1), sway);
    this.camera.position.copy(this.pose.target).add(rel);
    this.camera.up.copy(this.pose.up);
    this.camera.fov = this.pose.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.pose.target);
    this.camera.updateMatrixWorld();

    // probe
    this.probe.s += (this.probe.ts - this.probe.s) * (1 - Math.exp(-dt * 6));
    if (Math.abs(this.probe.ts - this.probe.s) > 0.01) busy = true;

    // upload items
    let i = 0;
    for (const b of this.bodies.values()) {
      if (i >= MAX_ITEMS) break;
      const o = i * 4;
      this.data[o] = b.x;
      this.data[o + 1] = b.y;
      this.data[o + 2] = Math.max(0, b.w);
      this.data[o + 3] = b.mem;
      const o2 = (MAX_ITEMS + i) * 4;
      this.data[o2] = b.sigma;
      i++;
    }
    this.tex.needsUpdate = true;

    // markers: hover, retrieved, ripples, ghosts — in that priority
    const u = this.material.uniforms;
    const markers = u.uMarkers.value as THREE.Vector4[];
    let m = 0;
    const put = (b: Body | undefined, type: number, w: number) => {
      if (!b || m >= MAX_MARKERS) return;
      markers[m++].set(b.x, b.y, type, w);
    };
    const hov = this.hoverId ?? this.pickedId;
    if (hov) put(this.bodies.get(hov), 3, 1);
    for (const id of this.highlight.slice(0, 6)) put(this.bodies.get(id), 1, 0.95);
    this.ripples = this.ripples.filter((r) => this.clock - r.start < r.dur);
    for (const r of this.ripples) {
      const p = (this.clock - r.start) / r.dur;
      if (p < 0) continue;
      put(this.bodies.get(r.id), r.type, p);
    }
    if (this.ripples.length) busy = true;
    for (const b of this.bodies.values()) if (b.ghost && b.tw >= 0) put(b, 2, 1);
    for (let k = m; k < MAX_MARKERS; k++) markers[k].set(0, 0, 0, 0);

    u.uCount.value = i;
    u.uNorm.value = this.norm;
    u.uHeight.value = this.pose.height;
    u.uSolid.value = this.pose.solid;
    u.uFlat.value = this.pose.flat;
    u.uTime.value = this.ambientClock;
    u.uClock.value = this.clock;
    u.uLineW.value = 1.15 * this.renderer.getPixelRatio();
    if (this.pingState) {
      const age = this.clock - this.pingState.start;
      (u.uPing.value as THREE.Vector4).set(this.pingState.x, this.pingState.y, this.pingState.start, age < 4.5 ? 1 : 0);
      if (age < 4.5) busy = true;
      else this.pingState = null;
    } else (u.uPing.value as THREE.Vector4).w = 0;
    (u.uProbe.value as THREE.Vector3).set(this.probe.x, this.probe.y, this.probe.s);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();

    if ((ambient || busy) && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };

  // ------------------------------------------------------------------ helpers

  private heightAt(x: number, y: number) {
    let f = 0;
    for (const b of this.bodies.values()) {
      const dx = x - b.x;
      const dy = y - b.y;
      f += Math.max(0, b.w) * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma));
    }
    return f * this.norm * this.pose.height;
  }

  private project(b: Body) {
    const v = new THREE.Vector3(b.x, b.y, this.heightAt(b.x, b.y)).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h, ok: v.z < 1 && v.z > -1 };
  }

  private updateLabels() {
    if (this.opts.labelMode === "none") return;
    // insertion order = priority: hovered first, then ranked hits, changes, forced, probe
    const want = new Map<string, { rank?: number; tone: string }>();
    const hov = this.hoverId ?? this.pickedId;
    const rankOf = (id: string) => {
      const i = this.highlight.indexOf(id);
      return i >= 0 && i < 5 ? i + 1 : undefined;
    };
    if (hov) want.set(hov, { rank: rankOf(hov), tone: rankOf(hov) ? "hit" : "hover" });
    this.highlight.slice(0, 5).forEach((id, i) => !want.has(id) && want.set(id, { rank: i + 1, tone: "hit" }));
    for (const r of this.ripples) if (!want.has(r.id)) want.set(r.id, { tone: "new" });
    for (const id of this.forcedLabels) if (!want.has(id)) want.set(id, { tone: "forced" });
    if (this.probe.s > 0.3) {
      const near = [...this.bodies.values()]
        .filter((b) => b.w > 0.05 && Math.hypot(b.x - this.probe.x, b.y - this.probe.y) < 0.32)
        .sort((a, b) => Math.hypot(a.x - this.probe.x, a.y - this.probe.y) - Math.hypot(b.x - this.probe.x, b.y - this.probe.y))
        .slice(0, 3);
      for (const b of near) if (!want.has(b.id)) want.set(b.id, { tone: "probe" });
    }

    for (const [id, el] of this.labelEls) {
      if (!want.has(id) || !this.bodies.has(id)) {
        if (!el.dataset.leaving) {
          el.dataset.leaving = "1";
          el.style.opacity = "0";
          setTimeout(() => {
            el.remove();
            if (this.labelEls.get(id) === el) this.labelEls.delete(id);
          }, 220);
        }
      }
    }

    const placed: { l: number; t: number; r: number; b: number }[] = [];
    const GAP = 12;
    let order = 0;
    for (const [id, info] of want) {
      const b = this.bodies.get(id);
      if (!b) continue;
      let el = this.labelEls.get(id);
      if (el?.dataset.leaving) {
        el.remove();
        this.labelEls.delete(id);
        el = undefined;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "terrain-label";
        const dot = document.createElement("i");
        const txt = document.createElement("span");
        el.append(dot, txt);
        this.labelLayer.appendChild(el);
        this.labelEls.set(id, el);
        requestAnimationFrame(() => el && (el.style.opacity = "1"));
      }
      el.dataset.tone = info.tone;
      el.dataset.kind = b.ghost ? "ghost" : b.kind;
      const span = el.querySelector("span")!;
      const name = this.opts.compactLabels ? (b.short ?? b.label) : b.label;
      const text = `${info.rank ? `${info.rank} · ` : ""}${b.ghost ? "outdated · " : ""}${name}`;
      if (span.textContent !== text) span.textContent = text;

      const p = this.project(b);
      const w = el.offsetWidth || 120;
      const h = el.offsetHeight || 20;
      // clamp inside the canvas, then stack upward until it no longer overlaps a placed label
      const left = Math.max(4, Math.min(this.size.w - w - 4, p.x - w / 2));
      let lift = 0;
      let ok = false;
      for (let k = 0; k < 3; k++) {
        const top = p.y - GAP - h - lift;
        const box = { l: left, t: top, r: left + w, b: top + h };
        if (top >= 2 && !placed.some((q) => box.l < q.r + 4 && box.r > q.l - 4 && box.t < q.b + 3 && box.b > q.t - 3)) {
          ok = true;
          break;
        }
        lift += h + 6;
      }
      if (!ok && order > 0) {
        el.style.visibility = "hidden";
        order++;
        continue;
      }
      if (!ok) lift = 0;
      const top = Math.max(2, p.y - GAP - h - lift);
      placed.push({ l: left, t: top, r: left + w, b: top + h });
      el.style.visibility = p.ok ? "visible" : "hidden";
      el.style.setProperty("--lx", `${Math.max(6, Math.min(w - 6, p.x - left)).toFixed(1)}px`);
      el.style.setProperty("--lh", `${(GAP - 1 + lift).toFixed(0)}px`);
      el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      order++;
    }
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: string | null = null;
    let bestD = 28;
    for (const b of this.bodies.values()) {
      if (b.w < 0.03 && !b.ghost) continue;
      const p = this.project(b);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent) => {
    const id = this.pick(e.clientX, e.clientY);
    if (id !== this.pickedId) {
      this.pickedId = id;
      this.canvas.style.cursor = id ? "pointer" : "default";
      this.opts.onHover?.(id);
      this.kick();
    }
  };

  private onPointerLeave = () => {
    if (this.pickedId) {
      this.pickedId = null;
      this.opts.onHover?.(null);
      this.kick();
    }
  };

  private onClick = (e: MouseEvent) => {
    const id = this.pick(e.clientX, e.clientY);
    if (id) this.opts.onSelect?.(id);
  };

  setAriaLabel(label: string) {
    this.canvas.setAttribute("aria-label", label);
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    const target = this.poseFor(this.mode);
    if (this.camT >= 1) {
      this.pose = clonePose(target);
      this.to = clonePose(target);
    } else {
      this.to = clonePose(target);
    }
    this.kick();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("click", this.onClick);
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
