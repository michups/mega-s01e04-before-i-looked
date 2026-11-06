export type RunStatus = 'ok' | 'retry' | 'fail';

/** One job, aggregated by timestamp; equal timestamps keep their input order. */
export interface DigestRow {
  job: string;
  /** Owner on the latest run, including an explicit null. */
  owner: string | null;
  /** All valid log entries for this job, including retries and failures. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error, retained after recovery; null if none. */
  lastError: string | null;
  /** Original log strings, with their timezone offsets preserved. */
  firstAt: string;
  lastAt: string;
}

export interface NightDigest {
  found: true;
  night: string;
  /** Sorted by job using case-sensitive code-unit order, independent of locale. */
  rows: DigestRow[];
  /** Malformed JSON and invalid records; blank lines are ignored. */
  badLines: number;
  /** Counts of valid source entries, including failures followed by recovery. */
  counts: Record<RunStatus, number>;
}

export interface MissingNight {
  found: false;
  night: string;
}

export type NightDigestResult = NightDigest | MissingNight;

/**
 * Implemented and exported as readNight from ./reader.
 * Reads runsDir/<night>.jsonl; night must be a YYYY-MM-DD calendar date.
 * Missing files and invalid night names return found:false; other I/O errors reject.
 * Empty files return found:true, rows:[], badLines:0 and zero status counts.
 * Both HTTP routes use this result: found:false maps to 404; the page renders
 * rows and badLines, while JSON returns { night, rows, badLines } on success.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigestResult>;
