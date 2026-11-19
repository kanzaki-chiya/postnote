/**
 * Runtime capabilities PostNote's core needs from its host environment
 * (userscript manager or browser extension).
 */
export type Platform = {
  /** Fetch a media URL as a data URL; return null on failure, timeout, or abort. */
  fetchImage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null>;
  /** Save the produced PNG blob. */
  download(blob: Blob, fileName: string): void;
};
