import { validateVault } from './storage.js';

const MAX_BYTES = 100 * 1024 * 1024;
const WORKER_THRESHOLD = 1024 * 1024;
const INITIALIZATION_TIMEOUT = 10000;
const IMPORT_TIMEOUT = 60000;

function importError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function checkFile(file) {
  if (!file || !Number.isFinite(file.size) || file.size < 0 || typeof file.text !== 'function') {
    throw importError('Scegli un file di backup JSON.', 'ARCHIVE_FILE_INVALID');
  }
  if (file.size > MAX_BYTES) {
    throw importError('Il file supera 100 MB. Usa un archivio più piccolo.', 'ARCHIVE_TOO_LARGE');
  }
}

async function readOnMainThread(file) {
  const text = await file.text();
  let vault;
  try { vault = JSON.parse(text); }
  catch { throw importError('Il file non contiene un archivio JSON leggibile.', 'ARCHIVE_INVALID_JSON'); }
  return validateVault(vault);
}

function readInWorker(file) {
  return new Promise((resolve, reject) => {
    let worker, timer, ready = false, settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (!worker) return;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const finish = (error, vault) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve(vault);
    };
    const fallback = () => {
      if (settled) return;
      settled = true;
      cleanup();
      readOnMainThread(file).then(resolve, reject);
    };

    try {
      worker = new Worker(new URL('./import-worker.js', import.meta.url), {
        type: 'module', name: 'sneaker-vault-import'
      });
    } catch { fallback(); return; }

    worker.onmessage = event => {
      const result = event.data;
      if (!ready) {
        if (!result || result.ready !== true) { fallback(); return; }
        ready = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(importError(
          'La lettura del backup ha impiegato troppo tempo. I dati esistenti non sono stati modificati.',
          'ARCHIVE_IMPORT_TIMEOUT'
        )), IMPORT_TIMEOUT);
        try { worker.postMessage(file); }
        catch { finish(importError('Impossibile inviare il file per la lettura.', 'ARCHIVE_WORKER_FAILED')); }
        return;
      }
      if (result?.error) {
        const detail = result.error;
        finish(importError(typeof detail.message === 'string' ? detail.message : 'Backup non valido.', detail.code));
      } else if (result && Object.hasOwn(result, 'vault')) {
        // The worker already validates before posting. Avoid another full scan
        // of a large archive on the UI thread; structured cloning preserves it.
        finish(null, result.vault);
      } else {
        finish(importError('La lettura del backup non ha restituito un risultato valido.', 'ARCHIVE_WORKER_FAILED'));
      }
    };
    worker.onerror = event => {
      event.preventDefault?.();
      if (!ready) fallback();
      else finish(importError('La lettura del backup è stata interrotta. Riprova con un file più piccolo.', 'ARCHIVE_WORKER_FAILED'));
    };
    worker.onmessageerror = () => {
      if (!ready) fallback();
      else finish(importError('Impossibile ricevere il backup letto. I dati esistenti non sono stati modificati.', 'ARCHIVE_WORKER_FAILED'));
    };
    timer = setTimeout(fallback, INITIALIZATION_TIMEOUT);
  });
}

export async function readArchiveFile(file) {
  checkFile(file);
  if (file.size <= WORKER_THRESHOLD || typeof Worker !== 'function') return readOnMainThread(file);
  return readInWorker(file);
}
