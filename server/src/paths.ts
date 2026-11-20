import path from 'node:path';
import { env } from './env.js';

/** Where each bot's Library files and browser profile live. */
export const libraryRoot = () => path.join(env.dataDir, 'files');
export const profilesRoot = () => path.join(env.dataDir, 'profiles');
