import { closeFixtures } from "./fixtures";

/**
 * e2e/fixtures.ts exports one module-level `postgres` connection shared by
 * every spec file (Node's module cache means they all get the same
 * instance). Closing it from an individual spec file's own `afterAll` broke
 * whichever OTHER spec file's `beforeAll` ran next (`CONNECTION_ENDED`) —
 * this runs exactly once, after every test file has finished, instead.
 */
export default async function globalTeardown() {
  await closeFixtures();
}
