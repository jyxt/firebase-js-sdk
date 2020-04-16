/**
 * @license
 * Copyright 2019 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DB, openDb } from 'idb';
import { AppConfig } from '../interfaces/app-config';
import { InstallationEntry } from '../interfaces/installation-entry';
import { getKey } from '../util/get-key';
import { fidChanged } from './fid-changed';

const DATABASE_NAME = 'firebase-installations-database';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'firebase-installations-store';

let dbPromise: Promise<DB> | null = null;
function getDbPromise(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = openDb(DATABASE_NAME, DATABASE_VERSION, upgradeDB => {
      // We don't use 'break' in this switch statement, the fall-through
      // behavior is what we want, because if there are multiple versions between
      // the old version and the current version, we want ALL the migrations
      // that correspond to those versions to run, not only the last one.
      // eslint-disable-next-line default-case
      switch (upgradeDB.oldVersion) {
        case 0:
          upgradeDB.createObjectStore(OBJECT_STORE_NAME);
      }
    });
  }
  return dbPromise;
}

let rawDbPromise: Promise<IDBDatabase> | null = null;
function getRawDbPromise(): Promise<IDBDatabase> {
  if (!rawDbPromise) {
    rawDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onerror = function() {
        reject(request.error);
      };
      request.onsuccess = function() {
        resolve(request.result);
      };
    });
  }
  return rawDbPromise;
}

/** Gets record(s) from the objectStore that match the given key. */
export async function get(
  appConfig: AppConfig
): Promise<InstallationEntry | undefined> {
  const key = getKey(appConfig);
  const db = await getDbPromise();
  return db
    .transaction(OBJECT_STORE_NAME)
    .objectStore(OBJECT_STORE_NAME)
    .get(key);
}

/** Assigns or overwrites the record for the given key with the given value. */
export async function set<ValueType extends InstallationEntry>(
  appConfig: AppConfig,
  value: ValueType
): Promise<ValueType> {
  const key = getKey(appConfig);
  // const db = await getDbPromise();
  // const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  // const objectStore = tx.objectStore(OBJECT_STORE_NAME);
  // const oldValue = await objectStore.get(key);
  // await objectStore.put(value, key);
  // await tx.complete;
  const db = await getRawDbPromise();
  const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  const store = tx.objectStore(OBJECT_STORE_NAME);

  const getAndPut = new Promise<ValueType>((resolve, reject) => {
    const getRequest = store.get(key);
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = function() {
      const oldValue: InstallationEntry | undefined = getRequest.result;
      const putRequest = store.put(value, key);
      putRequest.onerror = () => reject(putRequest.error);
      putRequest.onsuccess = function() {
        if (!oldValue || oldValue.fid !== value.fid) {
          fidChanged(appConfig, value.fid);
        }
        resolve(value);
      };
    };
  });
  const result = await getAndPut;
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Removes record(s) from the objectStore that match the given key. */
export async function remove(appConfig: AppConfig): Promise<void> {
  const key = getKey(appConfig);
  const db = await getDbPromise();
  const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  await tx.objectStore(OBJECT_STORE_NAME).delete(key);
  await tx.complete;
}

/**
 * Atomically updates a record with the result of updateFn, which gets
 * called with the current value. If newValue is undefined, the record is
 * deleted instead.
 * @return Updated value
 */
export async function update<ValueType extends InstallationEntry | undefined>(
  appConfig: AppConfig,
  updateFn: (previousValue: InstallationEntry | undefined) => ValueType
): Promise<ValueType> {
  const key = getKey(appConfig);
  // const db = await getDbPromise();
  // const getTx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  // const oldValue: InstallationEntry | undefined = await getTx.objectStore(OBJECT_STORE_NAME).get(key);
  // const newValue = updateFn(oldValue);

  const db = await getRawDbPromise();
  const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  const store = tx.objectStore(OBJECT_STORE_NAME);

  const getAndDeleteOrPut = new Promise<ValueType>((resolve, reject) => {
    const getRequest = store.get(key);
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = function() {
      const oldValue: InstallationEntry | undefined = getRequest.result;
      const newValue = updateFn(oldValue);
      if (newValue === undefined) {
        const deleteRequest = store.delete(key);
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => resolve(newValue);
      } else {
        const putRequest = store.put(newValue, key);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => {
          if (newValue && (!oldValue || oldValue.fid !== newValue.fid)) {
            fidChanged(appConfig, newValue.fid);
          }
          resolve(newValue);
        };
      }
    };
  });
  const result = await getAndDeleteOrPut;
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clear(): Promise<void> {
  const db = await getDbPromise();
  const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
  await tx.objectStore(OBJECT_STORE_NAME).clear();
  await tx.complete;
}
