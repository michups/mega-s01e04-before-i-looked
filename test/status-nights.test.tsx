import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('status-board digest links', () => {
  it('counts source events even when the final job status recovers', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
    temporary.push(runsDir);
    const events = ['fail', 'retry', 'ok'].map((status, i) => JSON.stringify({ at: `2026-10-29T01:0${i}:00+01:00`, job: 'recovered', owner: null, status }));
    await writeFile(join(runsDir, '2026-10-28.jsonl'), [...events, '{broken'].join('\n'));
    await writeFile(join(runsDir, '2026-10-27.jsonl'), '');
    const config = { adapter: 'test', installed: '2026-10-29T00:00:00+01:00', beatEverySeconds: 60, runsDir };
    const status = await readStatus(config);
    expect(status.nights).toEqual([
      { night: '2026-10-28', counts: { ok: 1, retry: 1, fail: 1 }, badLines: 1 },
      { night: '2026-10-27', counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 },
    ]);
    const app = createApp(config);
    const html = await (await app.request('/')).text();
    expect(html).toContain('ok 1 / retry 1 / fail 1');
    expect(html).toContain('malformed lines: 1');
    for (const night of ['2026-10-28', '2026-10-27']) {
      expect(html).toContain(`href="/digest/${night}"`);
      expect((await app.request(`/digest/${night}`)).status).toBe(200);
    }
    expect(html).not.toContain('<script');
  });

  it('keeps both read-only fixture nights linked with their raw event counts', async () => {
    const config = { adapter: 'test', installed: '2026-10-29T00:00:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
    const status = await readStatus(config);
    expect(status.nights.map(n => n.night)).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nights[0].counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(status.nights[1].counts).toEqual({ ok: 7, retry: 0, fail: 0 });
    const app = createApp(config);
    for (const night of status.nights) expect((await app.request(`/digest/${night.night}`)).status).toBe(200);
  });
});
