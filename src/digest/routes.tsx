import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';

export function registerDigestRoutes(app: Hono, config: RigConfig): void {
  app.get('/digest/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));
    if (!digest.found) return c.notFound();

    return c.html(
      <Layout title={`digest · ${digest.night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });
}
