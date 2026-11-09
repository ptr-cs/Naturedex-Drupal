import { all, fromTemplate, one } from '../lib/dom';
import type { SpeciesSummary } from '../lib/types';

const storageKey = 'naturedex.seen.v1';

export interface Collection {
  ids: () => string[];
  sync: (root?: ParentNode) => void;
  onChange: (listener: () => void) => void;
}

function load(species: SpeciesSummary[]): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (id): id is string =>
        typeof id === 'string' && species.some((entry) => entry.id === id),
    );
  } catch {
    return [];
  }
}

/** The visitor's discoveries. They stay in this browser and never reach Drupal. */
export function initCollection(species: SpeciesSummary[]): Collection {
  let seen = load(species);
  const listeners: Array<() => void> = [];

  function syncToggle(button: HTMLElement, id: string, name: string) {
    const isSeen = seen.includes(id);
    const wasSeen = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(isSeen));
    if (button.hasAttribute('data-seen-detail')) {
      const label = isSeen ? 'Marked as seen' : 'Mark as seen';
      button.setAttribute('aria-label', `${label}: ${name}`);
      button.classList.toggle('is-seen', isSeen);
      one('[data-seen-label]', button).textContent = label;
      if (isSeen !== wasSeen)
        one('[data-seen-icon]', button).replaceChildren(
          fromTemplate(
            isSeen ? '[data-seen-icon-check]' : '[data-seen-icon-eye]',
          ),
        );
      return;
    }
    button.setAttribute(
      'aria-label',
      `${isSeen ? 'Unmark' : 'Mark'} ${name} as seen`,
    );
    if (isSeen !== wasSeen)
      button.replaceChildren(
        isSeen
          ? fromTemplate('[data-seen-card-check]')
          : document.createElement('span'),
      );
  }

  function sync(root: ParentNode = document) {
    for (const button of all('[data-seen-toggle]', root)) {
      const id = speciesIdFor(button);
      const name = species.find((entry) => entry.id === id)?.name;
      if (id && name) syncToggle(button, id, name);
    }
    for (const card of all('[data-species-card]', root))
      card.classList.toggle(
        'species-seen',
        seen.includes(card.dataset.speciesCard ?? ''),
      );
    one('[data-collection-count]').textContent = String(seen.length).padStart(
      2,
      '0',
    );
    one('[data-collection-progress]').style.width =
      `${species.length ? (seen.length / species.length) * 100 : 0}%`;
  }

  function toggle(id: string) {
    seen = seen.includes(id)
      ? seen.filter((entry) => entry !== id)
      : [...seen, id];
    try {
      localStorage.setItem(storageKey, JSON.stringify(seen));
    } catch {
      one('[data-site-notice]').textContent =
        'Your collection is available for this visit, but browser storage is unavailable.';
    }
    sync();
    listeners.forEach((listener) => listener());
  }

  document.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>(
      '[data-seen-toggle]',
    );
    const id = button && speciesIdFor(button);
    if (id) toggle(id);
  });

  sync();
  return {
    ids: () => seen,
    sync,
    onChange: (listener) => listeners.push(listener),
  };
}

function speciesIdFor(button: HTMLElement) {
  return (
    button.dataset.speciesId ??
    button.closest<HTMLElement>('[data-species-card]')?.dataset.speciesCard
  );
}
