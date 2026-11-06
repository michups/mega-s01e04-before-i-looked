import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

export function createDigestApi(config: RigConfig) {
  const api = new Hono();

  api.get('/:night', async (c) => {
    const digest = await readNight(config.runsDir, c.req.param('night'));

    if (!digest.found) return c.notFound();

    return c.json({
      night: digest.night,
      rows: digest.rows,
      badLines: digest.badLines,
    });
  });

  return api;
}
