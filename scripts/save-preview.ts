import { access, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PreviewOptions {
  output: string;
  mode: 'marked' | 'clean';
  port?: number;
}

async function outputOutsideCheckout(output: string): Promise<string> {
  const path = resolve(output);
  const parent = await realpath(dirname(path));
  for (let directory = parent; ; directory = dirname(directory)) {
    try {
      const metadata = join(directory, '.git');
      if ((await stat(metadata)).isDirectory()) await access(join(metadata, 'HEAD'));
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
      if (directory === dirname(directory)) break;
      continue;
    }
    throw new Error('Preview output must be outside Git checkouts.');
  }
  return join(parent, basename(path));
}

// Deliberately accept only the static markup used by the digest, not arbitrary HTML.
function validateHtml(html: string, mode: PreviewOptions['mode']): void {
  if (!/^<!doctype html>/i.test(html) || !/<html\b/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('Response is not a complete HTML document.');
  }
  const allowedTags = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'header', 'strong',
    'span', 'main', 'h1', 'p', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
  for (const tag of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    if (!allowedTags.has(tag[1].toLowerCase())) throw new Error('Preview contains unsupported or active markup.');
    const attributes = tag[2].replace(/\/?\s*$/, '');
    const remaining = attributes.replace(/\s+(class|lang|charset)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (remaining.trim()) throw new Error('Preview contains unsupported attributes or external assets.');
  }
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  if (styles.length !== 1) throw new Error('Preview must contain one inline stylesheet.');
  const css = styles[0][1].replace(/\/\*[\s\S]*?\*\//g, '');
  if (/url\s*\(|@import|expression\s*\(|\\/i.test(css)) throw new Error('Preview stylesheet must be self-contained.');
  const marker = html.match(/<header>[\s\S]*?<span class="marker">([^<]*)<\/span>[\s\S]*?<\/header>/)?.[1].trim();
  if (!marker || (mode === 'clean' ? marker !== 'no marker set' : marker === 'no marker set')) {
    throw new Error('Lane banner does not match the requested preview mode.');
  }
}

export async function savePreview(options: PreviewOptions, fetchPage: typeof fetch = fetch): Promise<void> {
  const port = options.port ?? 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
  if (options.mode !== 'marked' && options.mode !== 'clean') throw new Error('PREVIEW_MODE must be marked or clean.');
  const output = await outputOutsideCheckout(options.output);
  const response = await fetchPage(`http://127.0.0.1:${port}/digest/2026-10-28`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Digest request was unsuccessful.');
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Digest response must have an HTML content type.');
  }
  const html = await response.text();
  validateHtml(html, options.mode);

  const temporary = await mkdtemp(join(dirname(output), '.rig-preview-'));
  try {
    const staged = join(temporary, 'preview.html');
    await writeFile(staged, html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(staged, output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, ...extra] = process.argv.slice(2);
  const mode = process.env.PREVIEW_MODE ?? 'marked';
  if (!output || extra.length || (mode !== 'marked' && mode !== 'clean')) {
    console.error('Usage: PREVIEW_MODE=marked|clean pnpm preview:save /outside/repo/preview.html');
    process.exitCode = 1;
  } else {
    try {
      await savePreview({ output, mode, port: Number(process.env.PORT ?? 8787) });
      console.log('Preview saved privately. Nothing was published.');
    } catch {
      // Do not echo response bodies, environment values, or potentially sensitive paths.
      console.error('Preview was not saved. Check the server, HTML, banner mode and output directory.');
      process.exitCode = 1;
    }
  }
}
