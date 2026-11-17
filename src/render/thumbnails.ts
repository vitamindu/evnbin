import * as THREE from 'three';
import { FIGHTERS, type FighterId } from '../data/fighters';
import { buildFighterModel } from './fighterModel';
import { addStandardLights } from './toon';

/**
 * 캐릭터 카드용 초상화 이미지를 미리 렌더링한다.
 * 별도의 작은 WebGL 컨텍스트로 한 번 그리고 바로 정리한다.
 */
export function renderPortraits(size = 384): Record<FighterId, string> {
  const out = {} as Record<FighterId, string>;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  addStandardLights(scene);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0.2, 1.35, 3.6);
  camera.lookAt(0, 1.08, 0);
  for (const def of FIGHTERS) {
    const m = buildFighterModel(def, { shadow: false });
    m.root.rotation.y = -0.35;
    m.update(0.4, 0);
    scene.add(m.root);
    renderer.render(scene, camera);
    out[def.id] = canvas.toDataURL('image/png');
    m.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
