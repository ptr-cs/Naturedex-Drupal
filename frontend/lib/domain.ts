import type { SpeciesSummary } from './types';

export function filterSpecies<T extends SpeciesSummary>(
  items: T[],
  search = '',
  group = 'All',
  region = 'all',
  seenOnly = false,
  seen: string[] = [],
): T[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter(
    (s) =>
      (!query ||
        `${s.name} ${s.scientificName} ${s.habitats.join(' ')}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (group === 'All' || s.group === group) &&
      (region === 'all' || s.regionIds.includes(region)) &&
      (!seenOnly || seen.includes(s.id)),
  );
}

export function sortSpecies<T extends SpeciesSummary>(
  items: T[],
  sort: string,
): T[] {
  return [...items].sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) : a.dexNumber - b.dexNumber,
  );
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export type BodyBlock = { type: 'heading' | 'paragraph'; text: string };

/** Mirrors FieldNoteFormat::parse() in naturedex_core for the Writing desk preview. */
export function parseBody(body: string): BodyBlock[] {
  return body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const heading = /^#{1,2} +([\s\S]+)$/.exec(part);
      return heading
        ? { type: 'heading', text: heading[1].replace(/\s*\n\s*/g, ' ').trim() }
        : { type: 'paragraph', text: part };
    });
}
