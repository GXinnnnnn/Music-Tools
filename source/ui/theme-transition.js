/* Native root snapshots only: no cloned DOM, canvas capture, or per-frame JS. */
(() => {
  'use strict';
  const root = document.documentElement;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scope = 'music-theme-revealing';
  let desiredTheme = null;
  let pending = null;
  let task = null;
  let cancel = null;
  let sequence = 0;
  let lastInteractiveRequest = -Infinity;

  const current = () => root.dataset.theme === 'dark' ? 'dark' : 'light';
  const simple = () => motion.matches || document.hidden;
  const commit = (request) => {
    // A skipped transition still invokes its callback. Never commit a stale request.
    if (request.id !== sequence) return;
    root.dataset.theme = request.theme;
    try { localStorage.setItem('theme', request.theme); } catch { /* Theme works with storage disabled. */ }
  };

  function originPoint(origin) {
    let x, y;
    if (origin && typeof origin.getBoundingClientRect === 'function') {
      const rect = origin.getBoundingClientRect();
      x = rect.left + rect.width / 2;
      y = rect.top + rect.height / 2;
    } else if (origin && (origin.detail !== 0 || !('detail' in origin))) {
      x = origin.clientX ?? origin.x;
      y = origin.clientY ?? origin.y;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const button = document.querySelector('[data-action="theme"]');
      if (button) return originPoint(button);
      x = innerWidth - 96;
      y = 28;
    }
    return { x: Math.max(0, Math.min(innerWidth, x)), y: Math.max(0, Math.min(innerHeight, y)) };
  }

  async function reveal(request) {
    let transition;
    let animation;
    let readinessTimer;
    let animationTimer;
    let interrupted = false;
    const { x, y } = originPoint(request.origin);
    const width = innerWidth, height = innerHeight;
    const stop = () => {
      interrupted = true;
      animation?.cancel();
      transition?.skipTransition();
    };
    const stopIfSimple = () => { if (simple()) stop(); };
    cancel = stop;
    root.classList.add(scope);
    window.addEventListener('resize', stop, { once: true });
    document.addEventListener('visibilitychange', stopIfSimple);
    motion.addEventListener('change', stopIfSimple);
    try {
      if (request.animate === false || !document.startViewTransition || simple()) {
        commit(request);
        // Commit final computed colors before restoring normal hover transitions.
        // A style read avoids waiting on requestAnimationFrame in hidden windows.
        void getComputedStyle(root).color;
        return;
      }
      try {
        transition = document.startViewTransition(() => commit(request));
      } catch {
        commit(request);
        void getComputedStyle(root).color;
        return;
      }
      // Chromium can delay a snapshot in an occluded window or after rapid skips.
      // The theme must settle even if a render frame is unavailable.
      readinessTimer = setTimeout(() => {
        commit(request);
        stop();
      }, 160);
      try {
        await transition.ready;
      } catch {
        await transition.updateCallbackDone.catch(() => {});
        return;
      } finally {
        clearTimeout(readinessTimer);
      }
      if (interrupted || request.id !== sequence || simple() || width !== innerWidth || height !== innerHeight) {
        stop();
        return;
      }
      const radius = Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y))) + 2;
      try {
        animation = root.animate({
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]
        }, {
          duration: 280,
          easing: 'cubic-bezier(.2,0,.2,1)',
          fill: 'both',
          pseudoElement: '::view-transition-new(root)'
        });
        animationTimer = setTimeout(stop, 400);
        await animation.finished.catch(() => {});
      } catch {
        // Unsupported pseudo-element animation still leaves the requested theme applied.
        stop();
      }
    } finally {
      clearTimeout(readinessTimer);
      clearTimeout(animationTimer);
      animation?.cancel();
      if (transition) {
        transition.skipTransition();
        await transition.finished.catch(() => {});
      }
      window.removeEventListener('resize', stop);
      document.removeEventListener('visibilitychange', stopIfSimple);
      motion.removeEventListener('change', stopIfSimple);
      if (cancel === stop) cancel = null;
      root.classList.remove(scope);
    }
  }

  function apply(theme, options = {}) {
    if (theme !== 'dark' && theme !== 'light') return Promise.resolve(current());
    desiredTheme = theme;
    const now = performance.now();
    // A click burst needs immediate state, not repeated costly native snapshots.
    const rapid = options.animate !== false && now - lastInteractiveRequest < 120;
    if (options.animate !== false) lastInteractiveRequest = now;
    pending = { theme, origin: options.origin, animate: rapid ? false : options.animate, id: ++sequence };
    // End current motion immediately; the next snapshot starts after its callback settles.
    cancel?.();
    return drain();
  }

  function drain() {
    if (!task) {
      task = Promise.resolve().then(async () => {
        while (pending) {
          const request = pending;
          pending = null;
          if (current() !== request.theme) await reveal(request);
          else commit(request);
        }
        return current();
      }).finally(() => {
        task = null;
        // A request can arrive between the drain resolving and this cleanup microtask.
        if (pending) return drain();
        desiredTheme = null;
      });
    }
    return task;
  }

  window.MusicTheme = Object.freeze({
    apply,
    toggle: (options) => apply((desiredTheme || current()) === 'dark' ? 'light' : 'dark', options),
    get theme() { return desiredTheme || current(); }
  });
})();
