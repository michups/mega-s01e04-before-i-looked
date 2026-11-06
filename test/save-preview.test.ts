import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { savePreview } from '../scripts/save-preview.js';

const directories: string[] = [];
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'rig-preview-test-'));
  directories.push(directory);
  return directory;
}

async function digestHtml(marker = 'SYNTHETIC-PREVIEW-TEST'): Promise<string> {
  vi.stubEnv('LANE_MARKER', marker);
  return (await createApp(config).request('/digest/2026-10-28')).text();
}

function htmlFetch(html: string): typeof fetch {
  return async () => new Response(html, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('savePreview', () => {
  it('saves the exact digest response privately and atomically outside the checkout', async () => {
    const directory = await tempDirectory();
    const output = join(directory, 'preview.html');
    const html = await digestHtml();
    await writeFile(output, 'previous preview', { mode: 0o644 });
    const fetchPage = vi.fn<typeof fetch>(htmlFetch(html));
    await savePreview({ output, mode: 'marked', port: 9999 }, fetchPage);
    expect(fetchPage).toHaveBeenCalledWith('http://127.0.0.1:9999/digest/2026-10-28', {
      redirect: 'error', signal: expect.any(AbortSignal),
    });
    expect(await readFile(output, 'utf8')).toBe(html);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['preview.html']);
  });

  it('validates marked and clean banners without overwriting an existing file on failure', async () => {
    const output = join(await tempDirectory(), 'preview.html');
    const clean = await digestHtml('');
    await writeFile(output, 'keep this');
    await expect(savePreview({ output, mode: 'marked' }, htmlFetch(clean))).rejects.toThrow('banner');
    expect(await readFile(output, 'utf8')).toBe('keep this');
    await savePreview({ output, mode: 'clean' }, htmlFetch(clean));
    expect(await readFile(output, 'utf8')).toBe(clean);
    await expect(savePreview({ output, mode: 'clean' }, htmlFetch(await digestHtml()))).rejects.toThrow('banner');
    expect(await readFile(output, 'utf8')).toBe(clean);
  });

  it('rejects failed responses and non-HTML without writing output', async () => {
    const directory = await tempDirectory();
    const output = join(directory, 'preview.html');
    await expect(savePreview({ output, mode: 'marked' }, async () => new Response('missing', { status: 404 })))
      .rejects.toThrow('unsuccessful');
    await expect(savePreview({ output, mode: 'marked' }, async () => new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }))).rejects.toThrow('content type');
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    '<script>alert(1)</script>', '<img src="https://example.invalid/a.png">',
    '<link rel="stylesheet" href="/style.css">', '<iframe src="/other"></iframe>',
    '<p onclick="alert(1)">active</p>', '<meta http-equiv="refresh" content="0;url=/other">',
  ])('rejects active markup and dependent assets: %s', async addition => {
    const directory = await tempDirectory();
    const html = (await digestHtml()).replace('</body>', `${addition}</body>`);
    await expect(savePreview({ output: join(directory, 'preview.html'), mode: 'marked' }, htmlFetch(html)))
      .rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(['@import "https://example.invalid/style.css";', 'body { background: url(/image.png); }'])
    ('rejects stylesheet dependencies: %s', async css => {
      const output = join(await tempDirectory(), 'preview.html');
      const html = (await digestHtml()).replace('</style>', `${css}</style>`);
      await expect(savePreview({ output, mode: 'marked' }, htmlFetch(html))).rejects.toThrow('self-contained');
    });

  it('rejects output within Git checkouts, including worktrees and symlinked parents', async () => {
    const directory = await tempDirectory();
    const checkout = join(directory, 'checkout');
    await mkdir(checkout);
    await writeFile(join(checkout, '.git'), 'gitdir: /unused/test/worktree');
    const link = join(directory, 'linked-checkout');
    await symlink(checkout, link, 'dir');
    const fetchPage = vi.fn<typeof fetch>();
    for (const parent of [checkout, link, process.cwd()]) {
      await expect(savePreview({ output: join(parent, 'never-written-preview.html'), mode: 'marked' }, fetchPage))
        .rejects.toThrow('outside Git checkouts');
    }
    expect(fetchPage).not.toHaveBeenCalled();
    expect(await readdir(checkout)).toEqual(['.git']);
  });
});
