'use strict';

/**
 * 前端与「系统」之间的唯一接口
 *
 * 桌面壳里走 preload 暴露的 window.workmate；
 * 直接双击 index.html 用浏览器打开时，自动降级成「读不到前台应用，就按页面可见性算」，
 * 这样调界面样式不用每次都开 Electron。
 */

window.WM = (function () {
  const native = window.workmate;
  const KEY = 'workmate.web.v1';

  if (native && native.isDesktop) {
    return {
      isDesktop: true,
      load: () => native.load(),
      save: (state) => native.save(state),
      log: (evt) => native.log(evt),
      usage: () => native.usage(),
      openData: () => native.openData(),
      openUrl: (url) => native.openUrl(url),
      reset: () => native.reset(),
      env: () => native.env(),
      onSample: (cb) => native.onSample(cb),
      ready: () => native.ready(),
      petState: (name) => native.petState(name),
      say: (payload) => native.say(payload),
      showMain: () => native.showMain(),
    };
  }

  // ---------- 浏览器降级 ----------
  let timer = null;

  return {
    isDesktop: false,
    load: async () => {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    save: async (state) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    log: async () => true,
    usage: async () => null,
    openData: async () => {},
    openUrl: async (url) => { window.open(url, '_blank', 'noopener'); },
    reset: async () => {
      try { localStorage.removeItem(KEY); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    env: async () => ({ isDesktop: false }),
    onSample: (cb) => {
      clearInterval(timer);
      timer = setInterval(() => {
        cb({
          at: Math.floor(Date.now() / 1000),
          step: 60,
          cat: null,           // 浏览器读不到前台，交给 settings.cat
          app: null,
          self: false,
          title: '',
          known: true,
        });
      }, 60000);
    },
    petState: () => {},
    say: () => {},
    showMain: () => {},
    ready: () => {},
  };
})();
