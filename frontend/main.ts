import { readJson } from './lib/dom';
import type { SiteData } from './lib/types';
import { initCollection } from './modules/collection';
import { initDesk } from './modules/desk';
import { initGuide } from './modules/guide';
import { initMotion } from './modules/motion';
import { initSpeciesDialogs } from './modules/species-dialogs';

const data = readJson<SiteData>('naturedex-data');
const motion = initMotion();
const collection = initCollection(data.species);
initSpeciesDialogs(data.species, collection, motion);
initGuide(data, collection);
initDesk();
