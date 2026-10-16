import type { Engine } from './types';
export type SemanticAggregate = {
  ownBrand: string;
  brands: { name: string; domain: string }[];
  cells: {
    brand: string;
    attribute: string;
    score: number | null;
    samples: number;
    observedScore: number | null;
    observedSamples: number;
    observations: number;
    insufficient: number;
    ambiguous: number;
  }[];
  prompts: number;
  engines: Engine[];
  date: string | null;
};
