/* Privacy-aware logger: never pass request bodies, passwords, tokens or receipt contents here. */
const quiet = process.env.NODE_ENV === 'test';

export const log = {
  info: (msg: string) => !quiet && console.log(`[sharespace] ${msg}`),
  warn: (msg: string) => console.warn(`[sharespace] ${msg}`),
  error: (msg: string) => console.error(`[sharespace] ${msg}`),
  debug: (msg: string) => process.env.DEBUG && console.debug(`[sharespace] ${msg}`),
};
