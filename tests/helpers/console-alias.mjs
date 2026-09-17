import { register } from 'node:module';

// Registers the '@/' resolution hook used by the console unit tests.
register('./console-alias-hooks.mjs', import.meta.url);
