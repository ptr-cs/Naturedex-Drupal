/** The compact species record printed into every page for filtering. */
export interface SpeciesSummary {
  id: string;
  dexNumber: number;
  name: string;
  scientificName: string;
  group: string;
  habitats: string[];
  regionIds: string[];
}

export interface Region {
  id: string;
  name: string;
  shortName: string;
  x: number;
  y: number;
  color: string;
  description: string;
}

export interface SiteData {
  species: SpeciesSummary[];
  regions: Region[];
}

/** A field note as returned by /api/naturedex/posts. */
export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  status: 'draft' | 'published';
  category: string;
  relatedSpeciesIds: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  url: string;
  editUrl?: string;
}

export interface DeskConfig {
  root: string;
  csrfToken: string;
  tokenUrl: string;
}
