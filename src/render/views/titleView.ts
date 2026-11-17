import * as THREE from 'three';
import { FIGHTERS } from '../../data/fighters';
import { buildFighterModel, type FighterModel } from '../fighterModel';
import type { View } from '../stage';
import { addStandardLights } from '../toon';

/** 타이틀 화면: 캐릭터 3명이 나란히 서 있다. */
export class TitleView implements View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly models: FighterModel[] = [];

  constructor() {
    addStandardLights(this.scene);
    this.camera.position.set(0, 1.5, 9.5);
    this.camera.lookAt(0, 1.8, 0);
    // 캐릭터 수에 맞춰 가로로 나란히(가운데 쪽이 조금 앞으로)
    const n = FIGHTERS.length;
    const gap = n > 3 ? 1.75 : 1.9;
    FIGHTERS.forEach((def, i) => {
      const m = buildFighterModel(def);
      const k = i - (n - 1) / 2;
      m.root.position.set(k * gap, 0, 0.4 - Math.abs(k) * 0.25);
      m.root.rotation.y = -k * 0.28;
      this.scene.add(m.root);
      this.models.push(m);
    });
  }

  update(t: number, dt: number) {
    for (const m of this.models) m.update(t, dt);
  }
}
