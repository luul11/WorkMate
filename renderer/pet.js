'use strict';

/**
 * 乐乐 · 序列帧播放器
 *
 * 只有一件事：把 animations.js 里的 rect + durationMs 变成背景定位。
 * 不用 canvas、不用动画库——一张 2.6MB 的图集加一个 setTimeout 链，
 * 换 canvas 只会多一层状态管理，画质还一样。
 *
 * 用法：
 *   const pet = PetSprite.create(el, { width: 132 });
 *   pet.play('idle');          // 循环
 *   pet.play('jumping', { once: true });
 *   pet.look(90);              // 锁在右看；pet.clearLook() 恢复动画
 */

(function () {
  const SHEET = window.PET_SHEET;
  const SRC = './assets/pets/maimai/spritesheet.webp';

  // 应用状态 → 素材动作。素材没有「打盹」和「专心」，只能借用接近的。
  const STATE_MAP = {
    idle: 'idle',
    talk: 'waiting',       // 说话时坐着等回应，比站着一动不动更像在听
    alert: 'waving',       // 提醒时抬爪招呼
    celebrate: 'jumping',
    focus: 'idle',
    sleepy: 'idle',
    hover: 'review',       // 鼠标移上来，歪头看你
    drag: 'running-right',
  };

  function create(el, opts) {
    opts = opts || {};
    if (!SHEET || !el) return null;

    const W = SHEET.cellWidth;
    const H = SHEET.cellHeight;
    const scale = (opts.width || 132) / W;

    el.style.width = W * scale + 'px';
    el.style.height = H * scale + 'px';
    el.style.backgroundImage = 'url("' + SRC + '")';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundSize = (SHEET.atlasWidth * scale) + 'px ' + (SHEET.atlasHeight * scale) + 'px';

    let timer = null;
    let frame = 0;
    let current = 'idle';
    let lookLocked = false;

    function paint(rect) {
      el.style.backgroundPosition = (-rect.x * scale) + 'px ' + (-rect.y * scale) + 'px';
    }

    function frameAt(name, i) {
      const anim = SHEET.animations[name];
      if (!anim || !anim.frames.length) return null;
      return anim.frames[i % anim.frames.length];
    }

    function tick() {
      const anim = SHEET.animations[current];
      if (!anim) return;
      const f = anim.frames[frame % anim.frames.length];
      paint(f.rect);
      timer = setTimeout(function () {
        frame += 1;
        if (frame >= anim.frames.length) frame = 0;
        tick();
      }, f.durationMs);
    }

    function play(name, o) {
      o = o || {};
      if (!SHEET.animations[name]) name = 'idle';
      lookLocked = false;
      clearTimeout(timer);
      current = name;
      frame = 0;
      tick();
    }

    function look(deg) {
      const list = SHEET.lookDirections || [];
      if (!list.length) return;
      let best = list[0];
      let bestDiff = 999;
      for (const d of list) {
        let diff = Math.abs(((d.angleDegrees - deg + 540) % 360) - 180);
        if (diff < bestDiff) { bestDiff = diff; best = d; }
      }
      lookLocked = true;
      clearTimeout(timer);
      paint(best.rect);
    }

    function clearLook() {
      if (!lookLocked) return;
      lookLocked = false;
      play(current);
    }

    play('idle');

    return {
      play: play,
      look: look,
      clearLook: clearLook,
      isLooking: () => lookLocked,
      current: () => current,
      mapState: (state) => STATE_MAP[state] || 'idle',
    };
  }

  window.PetSprite = { create: create, STATE_MAP: STATE_MAP };
})();
