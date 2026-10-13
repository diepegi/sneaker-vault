const DATABASE = 'sneaker-vault-mobile-v1';
const STORE = 'documents';
let databasePromise = null;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isTimestamp = value => isNumber(value) && Number.isFinite(new Date(value).getTime());

function invalid(message) {
  throw new Error(`Archivio non valido: ${message}. I dati esistenti non sono stati modificati.`);
}

// Archives are portable JSON documents. Unknown fields are checked for JSON
// compatibility, then kept as supplied; validation never rewrites a document.
function validateJSON(value, ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (isNumber(value)) return;
  if (typeof value !== 'object' || depth > 200) invalid('contenuto non compatibile con JSON');
  if (ancestors.has(value)) invalid('riferimento circolare');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid('tipo di dato non supportato');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) invalid('elemento di elenco mancante');
      validateJSON(value[index], ancestors, depth + 1);
    }
  } else {
    for (const child of Object.values(value)) validateJSON(child, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

export function validateVault(snapshot) {
  if (!isObject(snapshot) || !Array.isArray(snapshot.items)) invalid('elenco delle sneaker mancante');
  if (snapshot.snaps !== undefined && !Array.isArray(snapshot.snaps)) invalid('storico del portfolio');
  const ids = new Set();
  for (const [index, item] of snapshot.items.entries()) {
    const fieldError = field => invalid(`scheda ${index + 1}, campo ${field}`);
    if (!isObject(item)) fieldError('scheda');
    if (!((typeof item.id === 'string' && item.id) || isNumber(item.id))) fieldError('id');
    if (ids.has(String(item.id))) fieldError('id duplicato');
    ids.add(String(item.id));
    for (const field of ['brand', 'model']) if (typeof item[field] !== 'string') fieldError(field);
    if (item.watch != null && typeof item.watch !== 'boolean') fieldError('watch');
    for (const field of ['size', 'current', 'paid', 'retail', 'qty']) {
      if (!isNumber(item[field])) fieldError(field);
    }
    for (const field of ['sku', 'colorway', 'category', 'condition', 'notes', 'image', 'added', 'release']) {
      if (item[field] != null && typeof item[field] !== 'string') fieldError(field);
    }
    if (item.hist != null && (!Array.isArray(item.hist) || item.hist.some(point => !isObject(point) || !isTimestamp(point.t) || !isNumber(point.p)))) {
      fieldError('hist');
    }
    if (item.palette != null && (!Array.isArray(item.palette) || item.palette.some(color => typeof color !== 'string'))) fieldError('palette');
    if (item.market != null && (!isObject(item.market) || (item.market.url != null && typeof item.market.url !== 'string'))) fieldError('market');
  }
  if (snapshot.snaps?.some(point => !isObject(point) || !isTimestamp(point.t) || !isNumber(point.value) || (point.spent !== undefined && !isNumber(point.spent)))) {
    invalid('rilevazione del portfolio');
  }
  validateJSON(snapshot);
  return snapshot;
}

function validateSettings(settings) {
  if (!isObject(settings)) throw new Error('Preferenze non valide.');
  validateJSON(settings);
  return settings;
}

function sameDocument(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(right, key) && sameDocument(left[key], right[key]));
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Questo browser non permette il salvataggio locale del vault.'));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error || new Error('Impossibile aprire il salvataggio locale.'));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('Chiudi le altre schede di Sneaker Vault e riprova.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      database.onversionchange = () => { database.close(); databasePromise = null; };
      database.onclose = () => { databasePromise = null; };
      resolve(database);
    };
  }).catch(error => { databasePromise = null; throw error; });
  return databasePromise;
}

async function transaction(mode, work) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    try {
      if (mode === 'readwrite') {
        try { tx = database.transaction(STORE, mode, { durability: 'strict' }); }
        catch (error) {
          if (!(error instanceof TypeError) && error.name !== 'NotSupportedError') throw error;
          tx = database.transaction(STORE, mode);
        }
      } else tx = database.transaction(STORE, mode);
    } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => { failure ||= tx.error; };
    tx.onabort = () => reject(failure || tx.error || new Error('Salvataggio interrotto: il vault precedente è rimasto intatto.'));
    const fail = error => {
      failure = error;
      try { tx.abort(); } catch { reject(error); }
    };
    try { work(tx.objectStore(STORE), value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

function readDocument(key, validate) {
  return transaction('readonly', (store, done, fail) => {
    const request = store.get(key);
    request.onsuccess = () => {
      try { done(request.result === undefined ? null : validate(request.result)); }
      catch (error) { fail(error); }
    };
  });
}

export function loadVault() {
  return readDocument('vault', validateVault);
}

export function loadPreviousVault() {
  return readDocument('previous', validateVault);
}

function conflict() {
  const error = new Error('La collezione è stata aggiornata in un’altra scheda. Riapri la scheda e riprova.');
  error.code = 'VAULT_CONFLICT';
  return error;
}

export async function saveVault(snapshot, options = {}) {
  validateVault(snapshot);
  // Capture now, before awaiting IndexedDB: later caller mutations must not alter
  // the document that this save promises to commit.
  const next = structuredClone(snapshot);
  const checkExpected = Object.hasOwn(options, 'expected');
  const expected = checkExpected ? structuredClone(options.expected) : null;
  return transaction('readwrite', (store, done, fail) => {
    const request = store.get('vault');
    request.onsuccess = () => {
      try {
        const previous = request.result;
        if (previous !== undefined) {
          validateVault(previous);
          if (options.onlyIfMissing) {done(previous);return;}
        }
        if (checkExpected && !sameDocument(previous === undefined ? null : previous, expected)) throw conflict();
        if (sameDocument(previous, next)) {done(previous);return;}
        if (previous !== undefined) store.put(previous, 'previous');
        store.put(next, 'vault');
        done(next);
      } catch (error) { fail(error); }
    };
  });
}

export async function recoverVault(snapshot) {
  validateVault(snapshot);
  const next = structuredClone(snapshot);
  return transaction('readwrite', (store, done, fail) => {
    const request = store.get('vault');
    request.onsuccess = () => {
      try {
        const raw = request.result;
        if (raw === undefined) throw conflict();
        let valid = true;
        try { validateVault(raw); } catch { valid = false; }
        if (valid) throw conflict();
        store.put(raw, 'recovery');
        store.put(next, 'vault');
        done(next);
      } catch(error) {fail(error);}
    };
  });
}

export async function getSettings() {
  return (await readDocument('settings', validateSettings)) || {};
}

export async function setSettings(settings) {
  validateSettings(settings);
  const changes = structuredClone(settings);
  await transaction('readwrite', (store, _done, fail) => {
    const request = store.get('settings');
    request.onsuccess = () => {
      try {
        const existing = request.result === undefined ? {} : validateSettings(request.result);
        const merged = { ...existing, ...changes };
        if (!sameDocument(existing, merged)) store.put(merged, 'settings');
      } catch (error) { fail(error); }
    };
  });
}

function decodeBase64Url(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${name} non valida.`);
  }
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch { throw new Error(`${name} non valida.`); }
}

export async function decryptVault(bundle, keyBase64Url) {
  if (!isObject(bundle) || bundle.format !== 'sneaker-vault-encrypted-v1') throw new Error('Formato dell’archivio cifrato non riconosciuto.');
  if (!globalThis.crypto?.subtle) throw new Error('Apri Sneaker Vault tramite una connessione HTTPS per leggere l’archivio cifrato.');
  const rawKey = decodeBase64Url(keyBase64Url, 'Chiave');
  try {
    if (rawKey.length !== 32) throw new Error('La chiave dell’archivio deve contenere 32 byte.');
    const iv = decodeBase64Url(bundle.iv, 'Impronta dell’archivio');
    const encrypted = decodeBase64Url(bundle.data, 'Copia cifrata');
    if (iv.length !== 12 || encrypted.length < 16) throw new Error('La copia cifrata è incompleta o danneggiata.');
    let decrypted;
    try {
      const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
      decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encrypted);
    } catch { throw new Error('Impossibile aprire l’archivio: chiave non corretta o copia danneggiata.'); }
    let snapshot;
    try { snapshot = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted)); }
    catch { throw new Error('La copia decifrata non contiene un archivio JSON leggibile.'); }
    return validateVault(snapshot);
  } finally { rawKey.fill(0); }
}

export async function getStorageStatus() {
  const storage = globalThis.navigator?.storage;
  let persistent = null, usageBytes = null, quotaBytes = null;
  if (storage) {
    const [persistence, estimate] = await Promise.allSettled([
      storage.persisted ? storage.persisted() : Promise.resolve(null),
      storage.estimate ? storage.estimate() : Promise.resolve(null)
    ]);
    if (persistence.status === 'fulfilled') persistent = persistence.value;
    if (estimate.status === 'fulfilled' && estimate.value) {
      usageBytes = estimate.value.usage ?? null;
      quotaBytes = estimate.value.quota ?? null;
    }
  }
  return { available: !!globalThis.indexedDB, database: DATABASE, persistent, usageBytes, quotaBytes };
}
