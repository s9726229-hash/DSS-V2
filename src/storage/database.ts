import { openDB, type IDBPDatabase } from 'idb';
import type { DssDatabase } from './types';

export const DATABASE_NAME = 'dss-v2';
/** v2：新增 researchRuns，保存每次候選搜尋的完整結果。 */
export const DATABASE_VERSION = 2;

export function openDssDatabase(): Promise<IDBPDatabase<DssDatabase>> {
  return openDB<DssDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('holdingsSnapshots')) {
        db.createObjectStore('holdingsSnapshots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('marketCache')) {
        db.createObjectStore('marketCache', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('researchRuns')) {
        db.createObjectStore('researchRuns', { keyPath: 'id' });
      }
    },
  });
}
