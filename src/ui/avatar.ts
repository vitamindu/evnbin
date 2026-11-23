import { el } from '../core/dom';

/** 프로필 사진 동그라미: 사진이 있으면 사진, 없으면 닉네임 첫 글자(배경 = --c) */
export function avatarEl(name: string, avatar: string | undefined, className = ''): HTMLElement {
  const box = el('span', `avatar ${className}`.trim());
  fillAvatar(box, name, avatar);
  return box;
}

export function fillAvatar(box: HTMLElement, name: string, avatar: string | undefined) {
  box.classList.toggle('has-photo', !!avatar);
  if (avatar) {
    const img = el('img');
    img.src = avatar;
    img.alt = '';
    img.draggable = false;
    box.replaceChildren(img);
  } else {
    box.replaceChildren(el('span', 't-outline', [name.charAt(0)]));
  }
}

/**
 * 고른 이미지 파일을 가운데 정사각형으로 잘라 128×128 작은 이미지(data URL)로 만든다.
 * webp가 되면 webp, 아니면 jpeg. 서버 한도(6만 자)를 넘으면 품질을 낮춰 다시 만든다.
 */
export async function imageFileToAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 128, 128);
  bmp.close();
  for (const q of [0.85, 0.7, 0.5]) {
    let url = c.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', q);
    if (url.length <= 60_000) return url;
  }
  throw new Error('too_big');
}
