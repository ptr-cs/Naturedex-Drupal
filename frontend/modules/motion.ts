import { all, one } from '../lib/dom';

const preferenceKey = 'naturedex.motion.v1';
const pauseIcon = 'M2 2h3v8H2zM7 2h3v8H7z';
const playIcon = 'M3 1v10l7-5z';

export interface Motion {
  apply: (root?: ParentNode) => void;
}

/**
 * Swaps sprites between resting and animated art. The device's reduced-motion
 * setting always wins, and a deliberate pause survives that setting changing.
 */
export function initMotion(): Motion {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = one<HTMLButtonElement>('[data-motion-toggle]');
  const explanation = one('#sprite-motion-explanation');
  let paused = false;
  try {
    paused = localStorage.getItem(preferenceKey) === 'paused';
  } catch {
    /* The preference still works for this visit. */
  }

  const enabled = () => !media.matches && !paused;

  function apply(root: ParentNode = document) {
    for (const image of all<HTMLImageElement>('img[data-sprite]', root)) {
      const resting = (image.dataset.restingSrc ??= image.getAttribute('src') ?? '');
      const animated = enabled() ? image.dataset.animatedSrc : undefined;
      const next = animated ?? resting;
      if (image.getAttribute('src') !== next) image.setAttribute('src', next);
      image.dataset.animated = animated ? 'true' : 'false';
    }
  }

  function render() {
    const reduced = media.matches;
    one('[data-motion-label]', toggle).textContent = reduced
      ? 'Reduced motion'
      : enabled()
        ? 'Pause sprites'
        : 'Animate sprites';
    one('[data-motion-icon]', toggle).setAttribute(
      'd',
      enabled() ? pauseIcon : playIcon,
    );
    toggle.disabled = reduced;
    toggle.setAttribute('aria-pressed', String(enabled()));
    explanation.hidden = !reduced;
    if (reduced)
      toggle.setAttribute('aria-describedby', 'sprite-motion-explanation');
    else toggle.removeAttribute('aria-describedby');
    apply();
  }

  toggle.addEventListener('click', () => {
    paused = !paused;
    try {
      localStorage.setItem(preferenceKey, paused ? 'paused' : 'on');
    } catch {
      /* Keep the in-memory preference. */
    }
    render();
  });
  media.addEventListener('change', render);
  render();
  return { apply };
}
