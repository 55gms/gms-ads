// Storage interface: put(key, buffer), get(key), delete(key), exists(key).
// Only the local-disk driver ships; another backend can implement the same
// four methods and be returned here.

import { config } from '../config.js';
import { createLocalStorage } from './local.js';

export const storage = createLocalStorage(config.mediaDir);
