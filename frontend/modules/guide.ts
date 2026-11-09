import { filterSpecies, sortSpecies } from '../lib/domain';
import { all, one } from '../lib/dom';
import type { SiteData } from '../lib/types';
import type { Collection } from './collection';

/** Filters and orders the server-rendered cards. Cards are moved, never rebuilt. */
export function initGuide(data: SiteData, collection: Collection) {
  const found = document.querySelector<HTMLElement>('[data-guide]');
  if (!found) return;
  const root: HTMLElement = found;

  const search = one<HTMLInputElement>('[data-guide-search]', root);
  const group = one<HTMLSelectElement>('[data-guide-group]', root);
  const sort = one<HTMLSelectElement>('[data-guide-sort]', root);
  const seenButton = one('[data-guide-seen]', root);
  const grid = one('[data-guide-grid]', root);
  const cards = new Map(
    all('[data-species-card]', grid).map((card) => [
      card.dataset.speciesCard ?? '',
      card,
    ]),
  );
  const regionButtons = all('[data-region]', root);

  let region = 'all';
  let seenOnly =
    new URLSearchParams(window.location.search).get('collection') === '1';

  function render() {
    const visible = sortSpecies(
      filterSpecies(
        data.species,
        search.value,
        group.value,
        region,
        seenOnly,
        collection.ids(),
      ),
      sort.value,
    );
    const shown = new Set(visible.map((entry) => entry.id));
    for (const [id, card] of cards) card.hidden = !shown.has(id);
    for (const entry of visible) {
      const card = cards.get(entry.id);
      if (card) grid.append(card);
    }

    one('[data-guide-title]', root).textContent = seenOnly
      ? 'YOUR DISCOVERIES'
      : group.value === 'All'
        ? 'THE VIRGINIA DEX'
        : group.value.toUpperCase();
    one('[data-guide-count]', root).textContent =
      `${visible.length} ${visible.length === 1 ? 'entry' : 'entries'}`;
    one('[data-guide-empty]', root).hidden = visible.length > 0;

    seenButton.classList.toggle('active', seenOnly);
    seenButton.setAttribute('aria-pressed', String(seenOnly));

    const active = data.regions.find((item) => item.id === region);
    one('[data-guide-region-chip]', root).hidden = !active;
    one('[data-guide-region-note]', root).hidden = !active;
    if (active) {
      one('[data-guide-region-name]', root).textContent = active.shortName;
      one('[data-guide-region-title]', root).textContent = active.name;
      one('[data-guide-region-description]', root).textContent =
        active.description;
    }
    for (const button of regionButtons) {
      const selected = button.dataset.region === region;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle(
        button.classList.contains('map-marker') ? 'is-active' : 'active',
        selected,
      );
    }
  }

  search.addEventListener('input', render);
  group.addEventListener('change', render);
  sort.addEventListener('change', render);
  seenButton.addEventListener('click', () => {
    seenOnly = !seenOnly;
    render();
  });
  for (const button of regionButtons)
    button.addEventListener('click', () => {
      region = region === button.dataset.region ? 'all' : (button.dataset.region ?? 'all');
      render();
    });
  one('[data-guide-region-clear]', root).addEventListener('click', () => {
    region = 'all';
    render();
  });
  one('[data-guide-reset]', root).addEventListener('click', () => {
    search.value = '';
    group.value = 'All';
    region = 'all';
    seenOnly = false;
    render();
  });
  collection.onChange(render);
  render();
}
