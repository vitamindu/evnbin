import * as THREE from 'three';
import type { DummyBehavior } from '../../game/types';
import { blobShadow, part, toon } from '../toon';

/**
 * 연습장 더미: 스프링 받침 위의 둥근 과녁 로봇(오리지널 디자인).
 * 행동별로 색이 다르다: idle 빨강, patrol 주황, turret 보라(작은 포신).
 */
export interface DummyModel {
  readonly root: THREE.Group;
  update(t: number, dt: number): void;
  setMoving(m: boolean): void;
  attack(): void;
  hit(): void;
  dispose(): void;
}

const COLORS: Record<DummyBehavior, string> = { idle: '#e84a4a', patrol: '#ff9a2a', turret: '#9b5cf0' };

export function buildDummyModel(behavior: DummyBehavior): DummyModel {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => (geos.push(g), g);
  const color = COLORS[behavior];

  const base = part(G(new THREE.CylinderGeometry(0.42, 0.48, 0.16, 24)), toon('#4a4f63'));
  base.position.y = 0.08;
  root.add(base);
  const spring = part(G(new THREE.TorusGeometry(0.16, 0.05, 8, 18)), toon('#c9cedb'));
  const spring2 = spring.clone();
  spring.rotation.x = spring2.rotation.x = Math.PI / 2;
  spring.position.y = 0.24;
  spring2.position.y = 0.34;
  root.add(spring, spring2);

  const top = new THREE.Group();
  top.position.y = 0.42;
  root.add(top);
  const body = part(G(new THREE.CapsuleGeometry(0.34, 0.42, 8, 18)), toon(color));
  body.position.y = 0.55;
  top.add(body);
  // 정면 과녁 무늬
  const ringW = part(G(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 24)), toon('#ffffff'), { outline: false });
  ringW.rotation.x = Math.PI / 2;
  ringW.position.set(0, 0.55, 0.32);
  top.add(ringW);
  const ringR = part(G(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 24)), toon(color), { outline: false });
  ringR.rotation.x = Math.PI / 2;
  ringR.position.set(0, 0.55, 0.335);
  top.add(ringR);
  const bull = part(G(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16)), toon('#ffffff'), { outline: false });
  bull.rotation.x = Math.PI / 2;
  bull.position.set(0, 0.55, 0.35);
  top.add(bull);
  // 눈 두 개(화면) + 안테나
  const visor = part(G(new THREE.CapsuleGeometry(0.07, 0.28, 4, 10)), toon('#222740'));
  visor.rotation.z = Math.PI / 2;
  visor.position.set(0, 0.92, 0.27);
  top.add(visor);
  const ant = part(G(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6)), toon('#c9cedb'));
  ant.position.y = 1.22;
  top.add(ant);
  const tip = new THREE.Mesh(G(new THREE.SphereGeometry(0.06, 10, 8)), new THREE.MeshBasicMaterial({ color: '#ffe066' }));
  tip.position.y = 1.38;
  top.add(tip);
  if (behavior === 'turret') {
    const barrel = part(G(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 12)), toon('#4a4f63'));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.3, 0.6, 0.25);
    top.add(barrel);
  }
  root.add(blobShadow(0.55));

  let wobble = 0;
  let moving = false;
  return {
    root,
    update(t, dt) {
      wobble = Math.max(0, wobble - dt * 2.5);
      const w = Math.sin(t * 24) * wobble * 0.35;
      top.rotation.x = w;
      top.position.y = 0.42 + (moving ? Math.abs(Math.sin(t * 10)) * 0.05 : 0);
      (tip.material as THREE.MeshBasicMaterial).color.setHSL(0.13, 1, 0.55 + 0.15 * Math.sin(t * 5));
    },
    setMoving(m) {
      moving = m;
    },
    attack() {
      wobble = Math.max(wobble, 0.3);
    },
    hit() {
      wobble = 1;
    },
    dispose() {
      for (const g of geos) g.dispose();
      root.removeFromParent();
    },
  };
}
