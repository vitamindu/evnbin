import * as THREE from 'three';
import { getFighter, type FighterId } from '../../data/fighters';
import { buildFighterModel, type FighterModel } from '../fighterModel';
import { worldXForNdc, type View } from '../stage';
import { addStandardLights, toon } from '../toon';

export interface ShowcaseOptions {
  fov: number;
  camPos: [number, number, number];
  lookAtY: number;
  /** 캐릭터를 놓을 화면 가로 위치(-1~1) */
  ndcX: number;
  /** 기본 몸 방향(라디안) */
  baseYaw: number;
  /** 손을 떼면 기본 방향으로 돌아오는지(false면 천천히 계속 회전) */
  returnToBase: boolean;
}

/** 캐릭터 한 명을 받침대 위에 세워 보여주는 장면(로비, 캐릭터 상세). */
export class ShowcaseView implements View {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly opts: ShowcaseOptions;
  private readonly stand = new THREE.Group();
  private readonly models = new Map<FighterId, FighterModel>();
  private current: FighterModel | null = null;
  private yaw: number;
  private dragging = false;
  private ring!: THREE.Mesh;

  constructor(opts: ShowcaseOptions) {
    this.opts = opts;
    this.yaw = opts.baseYaw;
    this.camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.1, 100);
    this.camera.position.set(...opts.camPos);
    this.camera.lookAt(0, opts.lookAtY, 0);
    addStandardLights(this.scene);
    this.scene.add(this.stand);
    this.buildPedestal();
  }

  private buildPedestal() {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.88, 0.18, 56), toon('#18246a'));
    base.position.y = -0.09;
    this.stand.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.02, 56), toon('#2a3c9c'));
    top.position.y = 0.0;
    this.stand.add(top);
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.78, 0.022, 8, 72),
      new THREE.MeshBasicMaterial({ color: '#7fe9ff' }),
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.005;
    this.stand.add(this.ring);
  }

  setFighter(id: FighterId) {
    if (this.current?.id === id) return;
    if (this.current) this.stand.remove(this.current.root);
    let m = this.models.get(id);
    if (!m) {
      m = buildFighterModel(getFighter(id));
      this.models.set(id, m);
    }
    this.current = m;
    this.stand.add(m.root);
    this.yaw = this.opts.baseYaw;
  }

  celebrate() {
    this.current?.celebrate();
  }

  setDragging(on: boolean) {
    this.dragging = on;
  }

  rotateBy(dxDesignPx: number) {
    this.yaw += dxDesignPx * 0.012;
  }

  resize() {
    const dist = this.camera.position.z;
    this.stand.position.x = worldXForNdc(this.camera, dist, this.opts.ndcX);
  }

  update(t: number, dt: number) {
    if (!this.dragging) {
      if (this.opts.returnToBase) {
        // 가장 가까운 방향으로 기본 각도에 돌아온다
        const twoPi = Math.PI * 2;
        let diff = (this.opts.baseYaw - this.yaw) % twoPi;
        if (diff > Math.PI) diff -= twoPi;
        if (diff < -Math.PI) diff += twoPi;
        this.yaw += diff * (1 - Math.exp(-dt * 2.5));
      } else {
        this.yaw += dt * 0.35;
      }
    }
    if (this.current) {
      this.current.root.rotation.y = this.yaw;
      this.current.update(t, dt);
    }
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.2);
    (this.ring.material as THREE.MeshBasicMaterial).color.setRGB(0.5 + 0.2 * pulse, 0.85 + 0.1 * pulse, 1);
  }
}
