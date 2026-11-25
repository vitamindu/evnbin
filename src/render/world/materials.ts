import * as THREE from 'three';
import { OUTLINE_COLOR, toon } from '../toon';

/**
 * 맵 전용 재질. World 담당.
 * - 기본은 toon()과 같은 3단 명암(같은 gradientMap을 공유하도록 toon()을 복제해서 쓴다).
 * - InstancedMesh용 외곽선(toon.ts의 part() 외곽선은 instanceMatrix를 모름).
 * - 수풀 흔들림, 물결은 정점·조각 셰이더로 처리(매 프레임 CPU 작업 없음, 시간 uniform 하나만 바뀜).
 */

/** 맵 셰이더들이 같이 쓰는 시간(초) */
export type TimeUniform = { value: number };

/**
 * 흔들림: 높이에 비례해 좌우로 살짝. 인스턴스 위치로 위상을 바꿔 덩어리마다 다르게 흔들린다.
 * p: 인스턴스 로컬 좌표, ph: 인스턴스 월드 위치(xz).
 */
const SWAY_GLSL = /* glsl */ `
  vec3 worldSway(vec3 p, vec2 ph, float t) {
    float h = clamp(p.y, 0.0, 1.2);
    float a = sin(t * 1.55 + ph.x * 0.83 + ph.y * 0.61) + 0.35 * sin(t * 3.1 + ph.x * 1.7);
    float b = sin(t * 1.21 + ph.x * 0.47 - ph.y * 0.92);
    return vec3(a * 0.045 * h, 0.0, b * 0.03 * h);
  }
`;

const INSTANCE_PHASE_GLSL = /* glsl */ `
  #ifdef USE_INSTANCING
    vec2 swayPhase = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  #else
    vec2 swayPhase = vec2(0.0);
  #endif
`;

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  sway?: TimeUniform;
}

/** toon()과 같은 명암 단계를 쓰는 맵 전용 재질(복제본이라 마음대로 바꾸고 dispose해도 됨) */
export function worldToon(opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = toon('#ffffff').clone();
  m.color.set(opts.color ?? '#ffffff');
  m.map = opts.map ?? null;
  m.vertexColors = opts.vertexColors ?? false;
  const time = opts.sway;
  if (time) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\n${SWAY_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n${INSTANCE_PHASE_GLSL}\ntransformed += worldSway(transformed, swayPhase, uTime);`,
        );
    };
    m.customProgramCacheKey = () => 'world-sway';
  }
  return m;
}

/** InstancedMesh(또는 일반 Mesh)용 외곽선. 법선을 따라 부풀린 뒷면을 남색으로 그린다 */
export function outlineMaterial(thickness: number, sway?: TimeUniform): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      color: { value: new THREE.Color(OUTLINE_COLOR) },
      uTime: sway ?? { value: 0 },
      uSway: { value: sway ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      uniform float thickness;
      uniform float uTime;
      uniform float uSway;
      ${SWAY_GLSL}
      void main() {
        ${INSTANCE_PHASE_GLSL}
        vec3 p = position + normalize(normal) * thickness;
        p += worldSway(position, swayPhase, uTime) * uSway;
        vec4 wp = vec4(p, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      void main() { gl_FragColor = vec4(color, 1.0); }
    `,
    side: THREE.BackSide,
  });
}

/**
 * 물 표면. 조명을 쓰지 않는 셰이더(색은 sRGB 값 그대로).
 * mask: 맵 크기 W×H, 물 타일 = 255. 선형 보간으로 물가까지의 거리를 근사해서 물가 거품을 그린다.
 */
export function waterMaterial(time: TimeUniform, mask: THREE.Texture, size: THREE.Vector2, frozen = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uMask: { value: mask }, uSize: { value: size }, uIce: { value: frozen ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uMask;
      uniform vec2 uSize;
      uniform float uIce;
      varying vec2 vXZ;
      void main() {
        vec2 p = vXZ;
        float m = texture2D(uMask, p / uSize).r;
        float depth = smoothstep(0.6, 1.0, m);
        vec3 shallow = vec3(0.35, 0.76, 0.95);
        vec3 deep = vec3(0.16, 0.5, 0.86);
        vec3 col = mix(shallow, deep, depth);
        // 두 방향으로 흘러가는 물결 띠(툰 하이라이트)
        float w1 = sin(p.x * 2.1 + uTime * 1.15 + sin(p.y * 1.6 + uTime * 0.7) * 1.5);
        float w2 = sin(p.y * 2.9 - uTime * 0.85 + sin(p.x * 1.25 - uTime * 0.45) * 1.3);
        float band = w1 + w2;
        col = mix(col, vec3(0.5, 0.83, 0.99), step(1.15, band) * 0.6);
        col = mix(col, vec3(0.78, 0.94, 1.0), step(1.7, band) * 0.75);
        // 드문드문 움직이는 반짝임
        float sp = sin(p.x * 7.3 + uTime * 1.7) * sin(p.y * 6.1 - uTime * 1.3) * sin((p.x + p.y) * 4.7 + uTime * 2.9);
        col = mix(col, vec3(1.0), step(0.72, sp) * 0.8);
        // 물가 거품(출렁이는 가는 선)
        float edge = 0.585 + 0.025 * sin(uTime * 2.2 + p.x * 4.7 + p.y * 3.9);
        float foam = 1.0 - smoothstep(edge - 0.012, edge + 0.012, m);
        col = mix(col, vec3(0.93, 0.98, 1.0), foam * 0.9);
        // 겨울: 꽁꽁 언 얼음(밝은 하늘색 + 금 간 무늬, 물결은 거의 안 보이게)
        if (uIce > 0.5) {
          float crack = step(0.97, abs(sin(p.x * 3.1 + p.y * 1.7)) ) + step(0.985, abs(sin(p.x * -2.3 + p.y * 2.9)));
          vec3 ice = mix(vec3(0.78, 0.92, 0.99), vec3(0.62, 0.84, 0.97), depth);
          ice = mix(ice, vec3(1.0), clamp(crack, 0.0, 1.0) * 0.7);
          col = mix(col, ice, 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
