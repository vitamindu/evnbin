import * as THREE from 'three';
import type { Quality } from '../state/settings';

/** 화면 하나가 쓰는 3D 장면 */
export interface View {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  update(t: number, dt: number): void;
  resize?(w: number, h: number): void;
}

/**
 * WebGL 렌더러는 앱 전체에 하나만 두고, 화면이 바뀔 때 View만 바꿔 끼운다.
 * 캔버스는 투명해서 뒤의 CSS 배경이 보인다.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private view: View | null = null;
  private w = 1;
  private h = 1;
  private last = 0;
  private t = 0;
  private running = false;
  private frames = 0;
  private fpsAt = 0;
  fps = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.renderer.setAnimationLoop(null);
      else if (this.running) this.start();
    });
  }

  setQuality(q: Quality) {
    const pr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.applyCamera();
  }

  setView(v: View | null) {
    this.view = v;
    this.applyCamera();
    if (!v) this.renderer.clear();
  }

  private applyCamera() {
    const v = this.view;
    if (!v) return;
    v.camera.aspect = this.w / this.h;
    v.camera.updateProjectionMatrix();
    v.resize?.(this.w, this.h);
  }

  start() {
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    this.frames++;
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    const v = this.view;
    if (!v) return;
    v.update(this.t, dt);
    this.renderer.render(v.scene, v.camera);
  };
}

/** 카메라 정면 기준으로, 화면 가로 위치(ndcX: -1 왼쪽 ~ 1 오른쪽)에 해당하는 월드 x 좌표 */
export function worldXForNdc(camera: THREE.PerspectiveCamera, distance: number, ndcX: number): number {
  const halfH = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return ndcX * halfH * camera.aspect;
}
