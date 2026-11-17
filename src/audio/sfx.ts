/**
 * 효과음. 지금은 WebAudio로 합성한 임시 소리이며, Visual & Audio 단계에서 실제 음원으로 교체한다.
 * 브라우저는 첫 터치 전에는 소리를 막기 때문에 타이틀 화면의 첫 탭에서 unlockAudio()를 부른다.
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

type Sfx =
  | 'tap'
  | 'back'
  | 'select'
  | 'start'
  | 'deny'
  // 전투
  | 'shoot'
  | 'blast'
  | 'hit'
  | 'hurt'
  | 'empty'
  | 'charged'
  | 'ko';

const PRESETS: Record<Sfx, { f0: number; f1: number; dur: number; type: OscillatorType; vol: number }> = {
  tap: { f0: 660, f1: 880, dur: 0.07, type: 'triangle', vol: 0.18 },
  back: { f0: 520, f1: 330, dur: 0.08, type: 'triangle', vol: 0.16 },
  select: { f0: 520, f1: 1240, dur: 0.18, type: 'square', vol: 0.08 },
  start: { f0: 300, f1: 900, dur: 0.25, type: 'sawtooth', vol: 0.07 },
  deny: { f0: 220, f1: 180, dur: 0.12, type: 'square', vol: 0.06 },
  // 전투: 내 공격 발사, 궁극기 발사, 내가 맞힘, 내가 맞음, 탄 없음, 궁극기 충전 완료, 쓰러짐
  shoot: { f0: 820, f1: 240, dur: 0.07, type: 'square', vol: 0.045 },
  blast: { f0: 260, f1: 55, dur: 0.32, type: 'sawtooth', vol: 0.09 },
  hit: { f0: 1500, f1: 950, dur: 0.045, type: 'triangle', vol: 0.07 },
  hurt: { f0: 320, f1: 150, dur: 0.1, type: 'square', vol: 0.06 },
  empty: { f0: 170, f1: 130, dur: 0.06, type: 'square', vol: 0.05 },
  charged: { f0: 560, f1: 1680, dur: 0.32, type: 'triangle', vol: 0.12 },
  ko: { f0: 520, f1: 80, dur: 0.55, type: 'sawtooth', vol: 0.08 },
};

export function sfx(kind: Sfx) {
  if (!ctx || ctx.state !== 'running') return;
  const p = PRESETS[kind];
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = p.type;
  osc.frequency.setValueAtTime(p.f0, t);
  osc.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur);
  gain.gain.setValueAtTime(p.vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + p.dur + 0.02);
}
