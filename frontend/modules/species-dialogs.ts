import { all, create } from '../lib/dom';
import type { SpeciesSummary } from '../lib/types';
import type { Collection } from './collection';
import { openDialog } from './dialog';
import type { Motion } from './motion';

/**
 * Upgrades card titles from links to dialog buttons. The entry itself is the
 * server-rendered <template>, so Twig remains the only renderer of its content.
 */
export function initSpeciesDialogs(
  species: SpeciesSummary[],
  collection: Collection,
  motion: Motion,
) {
  for (const link of all<HTMLAnchorElement>('a.species-title')) {
    const id = link.closest<HTMLElement>('[data-species-card]')?.dataset
      .speciesCard;
    const template = document.querySelector<HTMLTemplateElement>(
      `template[data-species-detail="${id}"]`,
    );
    const entry = species.find((item) => item.id === id);
    if (!template || !entry) continue;

    const button = create('button', 'species-title', entry.name);
    button.type = 'button';
    button.setAttribute('aria-label', `View ${entry.name}`);
    button.addEventListener('click', () => {
      openDialog({
        label: entry.name,
        closeLabel: 'Close entry',
        className: 'species-modal',
        content: template.content.cloneNode(true),
        onOpen: (dialog) => {
          collection.sync(dialog);
          motion.apply(dialog);
        },
      });
    });
    link.replaceWith(button);
  }
}
