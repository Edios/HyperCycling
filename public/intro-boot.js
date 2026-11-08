/*
 * Decides, before the first paint, whether the brand intro (static markup in index.html, animated
 * by CSS) is shown: sets data-intro="full" | "static" on <html>. A separate classic file because the
 * CSP forbids inline scripts. The rules are those of src/client/brand/intro-policy.ts (introMode);
 * a test runs both against the same cases. Storage that cannot be read means "first visit".
 */
(function () {
  var root = document.documentElement;
  try {
    var KEY_LAST = 'hypercycling.intro.last';
    var KEY_PREF = 'hypercycling.intro.pref';
    var KEY_FX = 'hypercycling.intro.fx';
    var WEEK = 7 * 24 * 60 * 60 * 1000;
    var get = function (k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    };
    var pref = get(KEY_PREF);
    if (pref !== 'always' && pref !== 'never') pref = 'rare';
    if (navigator.webdriver === true || get(KEY_FX) === '1' || pref === 'never') return;
    var now = Date.now();
    var last = get(KEY_LAST);
    var lastMs = last === null ? NaN : Number(last);
    if (pref === 'rare' && isFinite(lastMs)) {
      var age = now - lastMs;
      if (age >= 0 && age < WEEK) return;
    }
    var reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.setAttribute('data-intro', reduced ? 'static' : 'full');
    try {
      localStorage.setItem(KEY_LAST, String(now));
    } catch {
      // Cannot remember: it will play again next time.
    }
  } catch {
    // Never block the app because of the intro.
  }
})();
