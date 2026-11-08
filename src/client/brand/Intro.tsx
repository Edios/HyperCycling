import { useEffect } from 'react';
import { useSettings } from '../data/useSettings';
import { useT } from '../i18n';
import { writeIntroEffectsOff } from './intro-policy';

const INTRO_ID = 'boot-intro';
/** Safety net: the CSS finishes the intro in 1.5 s; this removes the element if it never reports. */
const REMOVE_AFTER_MS = 2500;
const SKIP_MS = 220;

function remove(): void {
  document.getElementById(INTRO_ID)?.remove();
  document.documentElement.removeAttribute('data-intro');
}

/**
 * Controller of the brand intro. The intro itself is static markup in index.html, animated by CSS
 * and switched on before the first paint by public/intro-boot.js (frequency rules live in
 * intro-policy.ts), so it shows at once and never waits for Settings or fonts. This component only
 * makes it skippable (tap or any key), removes the element when it is over, drops it for e2e
 * builds and remembers "Effects: off" for the next load. Not played for automation; reduced motion
 * gets a still logo (decided by the boot script).
 */
export function Intro() {
  const t = useT();
  const { settings, loaded } = useSettings();
  const effectsOff = loaded && settings.effectsIntensity <= 0;

  useEffect(() => {
    if (loaded) writeIntroEffectsOff(effectsOff);
  }, [loaded, effectsOff]);

  useEffect(() => {
    const el = document.getElementById(INTRO_ID);
    if (!el) return undefined;
    const e2e = import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true';
    if (!document.documentElement.hasAttribute('data-intro') || e2e || effectsOff) {
      remove();
      return undefined;
    }
    const hint = el.querySelector('.hint');
    if (hint) hint.textContent = t('intro.skip');

    let timer = window.setTimeout(remove, REMOVE_AFTER_MS);
    const skip = (): void => {
      if (el.classList.contains('skip')) return;
      el.classList.add('skip');
      window.clearTimeout(timer);
      timer = window.setTimeout(remove, SKIP_MS);
    };
    const onEnd = (e: AnimationEvent): void => {
      if (e.target === el) remove();
    };
    el.addEventListener('pointerdown', skip);
    el.addEventListener('click', skip);
    el.addEventListener('animationend', onEnd);
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', skip);
      el.removeEventListener('click', skip);
      el.removeEventListener('animationend', onEnd);
      window.removeEventListener('keydown', skip);
    };
  }, [effectsOff, t]);

  return null;
}
