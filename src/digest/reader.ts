import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

interface RunRecord {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isCalendarDate(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return 'at' in value && typeof value.at === 'string' && isTimestamp(value.at)
    && 'job' in value && typeof value.job === 'string' && value.job.trim().length > 0
    && 'status' in value && (value.status === 'ok' || value.status === 'retry' || value.status === 'fail')
    && 'owner' in value && (value.owner === null || typeof value.owner === 'string')
    && (!('error' in value) || typeof value.error === 'string');
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!isCalendarDate(night)) return { found: false, night };

  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { found: false, night };
    }
    throw error;
  }

  const records: RunRecord[] = [];
  let badLines = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isRunRecord(value)) records.push(value);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }

  // Stable sort uses input order for simultaneous events, even with different offsets.
  records.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const jobs = new Map<string, DigestRow>();
  for (const record of records) {
    let row = jobs.get(record.job);
    if (!row) {
      row = {
        job: record.job,
        owner: record.owner,
        runs: 0,
        retries: 0,
        lastStatus: record.status,
        lastError: null,
        firstAt: record.at,
        lastAt: record.at,
      };
      jobs.set(record.job, row);
    }
    row.runs += 1;
    if (record.status === 'retry') row.retries += 1;
    row.owner = record.owner;
    row.lastStatus = record.status;
    if (record.error !== undefined) row.lastError = record.error;
    row.lastAt = record.at;
  }

  const rows = [...jobs.values()].sort((left, right) => left.job < right.job ? -1 : left.job > right.job ? 1 : 0);
  return { found: true, night, rows, badLines };
};
