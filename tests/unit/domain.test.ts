import { describe, expect, it } from 'vitest';
import {
  filterSpecies,
  parseBody,
  slugify,
  sortSpecies,
} from '../../frontend/lib/domain';
import type { SpeciesSummary } from '../../frontend/lib/types';

const base: SpeciesSummary = {
  id: 'deer',
  dexNumber: 1,
  name: 'White-tailed Deer',
  scientificName: 'Odocoileus virginianus',
  group: 'Mammals',
  habitats: ['Woodland'],
  regionIds: ['valley', 'piedmont'],
};
const entries: SpeciesSummary[] = [
  base,
  {
    ...base,
    id: 'trout',
    dexNumber: 2,
    name: 'Brook Trout',
    scientificName: 'Salvelinus fontinalis',
    group: 'Fish',
    habitats: ['Cold stream'],
    regionIds: ['mountains'],
  },
  {
    ...base,
    id: 'cardinal',
    dexNumber: 3,
    name: 'Northern Cardinal',
    scientificName: 'Cardinalis cardinalis',
    group: 'Birds',
    habitats: ['Woodland edge'],
    regionIds: ['valley', 'coastal'],
  },
];

describe('field-guide discovery', () => {
  it('finds animals through common names, scientific names, and habitats regardless of case', () => {
    expect(
      filterSpecies(entries, '  BROOK TROUT  ').map((entry) => entry.id),
    ).toEqual(['trout']);
    expect(
      filterSpecies(entries, 'Odocoileus').map((entry) => entry.id),
    ).toEqual(['deer']);
    expect(filterSpecies(entries, 'woodland').map((entry) => entry.id)).toEqual(
      ['deer', 'cardinal'],
    );
  });

  it('combines group, geographic association, and collection membership', () => {
    expect(
      filterSpecies(entries, '', 'Birds', 'valley', true, [
        'deer',
        'cardinal',
      ]).map((entry) => entry.id),
    ).toEqual(['cardinal']);
    expect(filterSpecies(entries, '', 'Fish', 'valley')).toEqual([]);
    expect(filterSpecies(entries, '', 'All', 'all', true, [])).toEqual([]);
  });

  it('returns all animals after filters are cleared and leaves source records untouched', () => {
    const original = JSON.stringify(entries);
    filterSpecies(entries, 'missing', 'Fish', 'coastal');
    expect(filterSpecies(entries).map((entry) => entry.id)).toEqual([
      'deer',
      'trout',
      'cardinal',
    ]);
    expect(JSON.stringify(entries)).toBe(original);
  });
});

describe('editorial identifiers and article text', () => {
  it('normalizes human titles to stable readable slugs', () => {
    expect(slugify('  Café: Frogs & Field Notes!  ')).toBe(
      'cafe-frogs-field-notes',
    );
    expect(slugify('---')).toBe('');
  });

  it('reads headings and paragraphs and leaves raw HTML as plain text', () => {
    expect(
      parseBody('## Look closer\n\nA <b>bold</b> claim.\n\n\n# Top\n\n'),
    ).toEqual([
      { type: 'heading', text: 'Look closer' },
      { type: 'paragraph', text: 'A <b>bold</b> claim.' },
      { type: 'heading', text: 'Top' },
    ]);
    expect(parseBody('   ')).toEqual([]);
  });

  it('sorts by dex number or name without changing the source order', () => {
    const byName = sortSpecies(entries, 'name').map((entry) => entry.id);
    expect(byName).toEqual(['trout', 'cardinal', 'deer']);
    expect(sortSpecies(entries, 'number')[0].id).toBe('deer');
    expect(entries[0].id).toBe('deer');
  });
});
