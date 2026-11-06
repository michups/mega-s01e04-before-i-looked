import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporaryDirectories: string[] = [];

async function runsWith(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rig-reader-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, '2026-10-28.jsonl'), contents);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('readNight', () => {
  it('aggregates the read-only plan fixture into five sorted jobs and one bad line', async () => {
    const result = await readNight(fileURLToPath(new URL('../runs/', import.meta.url)), '2026-10-28');
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('Expected fixture night');
    expect(result.badLines).toBe(1);
    expect(result.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
  });

  it('distinguishes missing nights, empty files and files with only invalid lines', async () => {
    const directory = await runsWith(' \r\n\n');
    expect(await readNight(directory, '2026-10-27')).toEqual({ found: false, night: '2026-10-27' });
    expect(await readNight(directory, '2026-10-28')).toEqual({ found: true, night: '2026-10-28', rows: [], badLines: 0 });
    await writeFile(join(directory, '2026-10-28.jsonl'), 'not json\nnull\n');
    expect(await readNight(directory, '2026-10-28')).toEqual({ found: true, night: '2026-10-28', rows: [], badLines: 2 });
  });

  it('counts malformed JSON and invalid fields without losing valid records', async () => {
    const valid = { at: '2026-10-28T01:00:00+01:00', job: 'job', status: 'ok', owner: null };
    const invalid: unknown[] = [null, [], 42, 'text', {},
      { ...valid, at: 'yesterday' }, { ...valid, at: '2026-02-30T01:00:00Z' },
      { ...valid, at: '2026-10-28T01:00:00' }, { ...valid, job: ' ' },
      { ...valid, job: 123 }, { ...valid, status: 'unknown' }, { ...valid, owner: 123 },
      { ...valid, owner: undefined }, { ...valid, error: null }, { ...valid, error: {} },
    ];
    const directory = await runsWith(['{bad json', ...invalid.map(value => JSON.stringify(value)), JSON.stringify(valid)].join('\r\n'));
    const result = await readNight(directory, '2026-10-28');
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('Expected temporary night');
    expect(result.badLines).toBe(invalid.length + 1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });

  it('uses chronological instants across offsets and input order for ties', async () => {
    const events = [
      { at: '2026-10-28T01:15:00Z', job: 'job', status: 'ok', owner: 'new-owner' },
      { at: '2026-10-28T02:00:00+02:00', job: 'job', status: 'retry', owner: 'old-owner', error: 'old error' },
      { at: '2026-10-28T01:00:00Z', job: 'job', status: 'fail', owner: 'old-owner', error: 'latest error' },
      { at: '2026-10-28T02:15:00+01:00', job: 'job', status: 'ok', owner: null },
    ];
    const directory = await runsWith(events.map(event => JSON.stringify(event)).join('\n'));
    const result = await readNight(directory, '2026-10-28');
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('Expected temporary night');
    expect(result.rows).toEqual([{ job: 'job', owner: null, runs: 4, retries: 1, lastStatus: 'ok',
      lastError: 'latest error', firstAt: '2026-10-28T02:00:00+02:00', lastAt: '2026-10-28T02:15:00+01:00' }]);
  });

  it('sorts by job consistently and handles object-property names as ordinary jobs', async () => {
    const directory = await runsWith(['z', '__proto__', 'A', 'a', 'constructor'].map(job => JSON.stringify({
      at: '2026-10-28T00:00:00Z', job, status: 'ok', owner: null,
    })).join('\n'));
    const result = await readNight(directory, '2026-10-28');
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('Expected temporary night');
    expect(result.rows.map(row => row.job)).toEqual(['A', '__proto__', 'a', 'constructor', 'z']);
  });

  it.each(['../2026-10-28', '/2026-10-28', '..\\2026-10-28', '2026-10-28/..', '2026-10-28\0',
    '2026-10-28.jsonl', '2026-02-29', '2026-13-01', '', '%2e%2e%2f2026-10-28'])('rejects unsafe or invalid night %j', async night => {
    const directory = await runsWith('');
    expect(await readNight(directory, night)).toEqual({ found: false, night });
  });

  it('accepts leap dates and preserves fractional timestamps', async () => {
    const directory = await runsWith('');
    await writeFile(join(directory, '2028-02-29.jsonl'), JSON.stringify({
      at: '2028-02-29T12:34:56.789-05:30', job: 'leap', status: 'ok', owner: null,
    }));
    const result = await readNight(directory, '2028-02-29');
    expect(result.found).toBe(true);
    if (!result.found) throw new Error('Expected leap night');
    expect(result.rows[0].lastAt).toBe('2028-02-29T12:34:56.789-05:30');
  });

  it('does not hide I/O failures as missing or empty nights', async () => {
    const directory = await runsWith('');
    await mkdir(join(directory, '2026-10-27.jsonl'));
    await expect(readNight(directory, '2026-10-27')).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
