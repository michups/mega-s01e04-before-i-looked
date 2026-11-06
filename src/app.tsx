import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { createDigestApi } from './digest/api.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';
import { registerDigestRoutes } from './digest/routes.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));
  app.route('/api/digest', createDigestApi(config));

  app.get('/', async (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={await readStatus(config)} />
      </Layout>,
    ),
  );

  registerDigestRoutes(app, config);

  return app;
}
