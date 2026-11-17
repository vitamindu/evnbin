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
    const xs = [-1.9, 0, 1.9];
    const yaws = [0.4, 0, -0.4];
    FIGHTERS.forEach((def, i) => {
      const m = buildFighterModel(def);
      m.root.position.set(xs[i] ?? 0, 0, i === 1 ? 0.4 : 0);
      m.root.rotation.y = yaws[i] ?? 0;
      this.scene.add(m.root);
      this.models.push(m);
    });
  }

  update(t: number, dt: number) {
    for (const m of this.models) m.update(t, dt);
  }
}
