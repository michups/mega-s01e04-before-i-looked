import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RigConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

const temporaryDirectories: string[] = [];
const night = '2026-10-28';

async function runsWith(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, `${night}.jsonl`), contents);
  return directory;
}

function appFor(runsDir: string) {
  const config: RigConfig = {
    adapter: 'test',
    installed: 'test',
    beatEverySeconds: 60,
    runsDir,
  };
  return createApp(config);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('digest routes', () => {
  it('serves the same sorted digest in HTML and JSON, preserving offsets and highlighting retries and failures', async () => {
    const runsDir = await runsWith([
      JSON.stringify({ at: '2026-10-29T05:41:09+01:00', job: 'z-<script>&', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-29T01:30:00+01:00', job: 'a-retried', status: 'retry', owner: 'first', error: 'temporary' }),
      JSON.stringify({ at: '2026-10-29T01:32:00+01:00', job: 'a-retried', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-29T01:34:00+01:00', job: 'a-retried', status: 'retry', owner: 'runner' }),
      JSON.stringify({ at: '2026-10-29T04:00:01+01:00', job: 'm-failed', status: 'fail', owner: null, error: '<disk & quota>' }),
      '{broken json',
    ].join('\n'));
    const app = appFor(runsDir);

    const pageResponse = await app.request(`/digest/${night}`);
    expect(pageResponse.status).toBe(200);
    const page = await pageResponse.text();
    expect(page).toContain('malformed lines: 1');
    expect(page).toContain('—');
    expect(page).toContain('class="warn"><strong>3</strong>');
    expect(page).toContain('class="warn"><strong>fail</strong>');
    expect(page).toContain('&lt;disk &amp; quota&gt;');
    expect(page).toContain('z-&lt;script&gt;&amp;');
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('<disk & quota>');
    expect(page).toContain('2026-10-29T01:30:00+01:00');
    expect(page).toContain('2026-10-29T05:41:09+01:00');

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const payload: unknown = await jsonResponse.json();
    expect(payload).toMatchObject({
      night,
      badLines: 1,
      rows: [
        { job: 'a-retried', owner: 'runner', runs: 3, retries: 3, lastStatus: 'retry', firstAt: '2026-10-29T01:30:00+01:00' },
        { job: 'm-failed', owner: null, runs: 1, retries: 0, lastStatus: 'fail' },
        { job: 'z-<script>&', owner: null, runs: 1, retries: 0, lastStatus: 'ok' },
      ],
    });
    const pageJobIndexes = ['a-retried', 'm-failed', 'z-&lt;script&gt;&amp;'].map(job => page.indexOf(job));
    expect(pageJobIndexes.every(index => index >= 0)).toBe(true);
    expect(pageJobIndexes).toEqual([...pageJobIndexes].sort((left, right) => left - right));
  });

  it('returns 404 for a missing night and for invalid or traversal-like night names', async () => {
    const app = appFor(await runsWith(''));

    for (const path of ['/digest/2026-10-27', '/api/digest/2026-10-27', '/digest/2026-02-30', '/api/digest/%2e%2e%2f2026-10-28']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('renders an empty file as nothing ran and returns an empty JSON digest', async () => {
    const app = appFor(await runsWith(' \n\r\n'));

    const pageResponse = await app.request(`/digest/${night}`);
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.text()).toContain('nothing ran');

    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    await expect(jsonResponse.json()).resolves.toEqual({ night, rows: [], badLines: 0 });
  });
});
