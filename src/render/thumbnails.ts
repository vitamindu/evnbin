import * as THREE from 'three';
import { FIGHTERS, getFighter, type FighterId } from '../data/fighters';
import { SKINS } from '../data/skins';
import { buildFighterModel } from './fighterModel';
import { addStandardLights } from './toon';

/**
 * 캐릭터 카드용 초상화 이미지를 미리 렌더링한다.
 * 별도의 작은 WebGL 컨텍스트로 한 번 그리고 바로 정리한다.
 */
export function renderPortraits(size = 384): { fighters: Record<FighterId, string>; skins: Record<string, string> } {
  const out = {} as Record<FighterId, string>;
  const skins: Record<string, string> = {};
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
  const draw = (m: ReturnType<typeof buildFighterModel>): string => {
    m.root.rotation.y = -0.35;
    m.update(0.4, 0);
    scene.add(m.root);
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');
    m.dispose();
    return url;
  };
  for (const def of FIGHTERS) out[def.id] = draw(buildFighterModel(def, { shadow: false }));
  // 스킨 초상화(상점·시즌 패스 카드): 그 스킨 모델로 그린다
  for (const s of SKINS) skins[s.id] = draw(buildFighterModel(getFighter(s.fighterId), { shadow: false, skin: s.id }));
  renderer.dispose();
  renderer.forceContextLoss();
  return { fighters: out, skins };
}
