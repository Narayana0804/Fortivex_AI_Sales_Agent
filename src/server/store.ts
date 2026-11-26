import fs from 'fs';
import path from 'path';
import type { AppStatePayload } from '../types';
import { createSeedState } from './seedData';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'cadence-store.json');

let memoryState: AppStatePayload | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(): AppStatePayload {
  if (memoryState) {
    return memoryState;
  }

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as AppStatePayload;
      if (parsed && Array.isArray(parsed.leads) && Array.isArray(parsed.knowledge)) {
        memoryState = parsed;
        return memoryState;
      }
    }
  } catch (err) {
    console.warn('Failed to parse persisted store, initializing fresh seed state:', err);
  }

  memoryState = createSeedState();
  saveState(memoryState);
  return memoryState;
}

export function saveState(state: AppStatePayload): void {
  memoryState = state;
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist cadence store to disk:', err);
  }
}

export function resetState(): AppStatePayload {
  const fresh = createSeedState();
  saveState(fresh);
  return fresh;
}
