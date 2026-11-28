import { walkthrough } from '../../../src/proof/walkthrough';
import type { Seed } from '../../../src/proof/world';
import seed from '../../../test/fixtures/seed-team.json';

export const { invoke: runWalkthrough } = walkthrough(seed as Seed);
