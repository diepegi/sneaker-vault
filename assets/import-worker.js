import { validateVault } from './storage.js';

const MAX_BYTES = 100 * 1024 * 1024;
let reading = false;

self.onmessage = async event => {
  if (reading) return;
  reading = true;
  try {
    const file = event.data;
    if (!file || !Number.isFinite(file.size) || file.size < 0 || typeof file.text !== 'function') {
      throw new Error('Scegli un file di backup JSON.');
    }
    if (file.size > MAX_BYTES) throw new Error('Il file supera 100 MB. Usa un archivio più piccolo.');
    const text = await file.text();
    let vault;
    try { vault = JSON.parse(text); }
    catch {
      const error = new Error('Il file non contiene un archivio JSON leggibile.');
      error.code = 'ARCHIVE_INVALID_JSON';
      throw error;
    }
    validateVault(vault);
    self.postMessage({ vault });
  } catch (error) {
    self.postMessage({ error: {
      message: error?.message || 'Impossibile leggere il backup.',
      code: error?.code || 'ARCHIVE_INVALID'
    } });
  }
};

// Signals that the module and schema validator loaded successfully. The caller
// sends the file only afterwards, distinguishing initialization from parse errors.
self.postMessage({ ready: true });
