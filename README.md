# Sneaker Vault

La tua collezione su iPhone e nel browser: schede, immagini, ricerca, filtri, watchlist e modifiche manuali. Il sito funziona senza un server da gestire e si può aggiungere alla schermata Home.

## Pubblicazione su GitHub Pages

1. Apri il repository **[diepegi/sneaker-vault](https://github.com/diepegi/sneaker-vault)**.
2. Estrai lo ZIP del sito e carica **il contenuto nella radice del repository**. `index.html`, `sw.js`, `manifest.webmanifest` e `vault.enc.json` devono essere subito visibili, accanto alle cartelle `assets` e `icons`. Non caricare lo ZIP o una cartella contenitore.
3. Conferma i file sul ramo `main`.
4. Apri **Settings → Pages**. In **Build and deployment**, scegli **Deploy from a branch**, quindi **main** e **/ (root)**. Premi **Save**.
5. Attendi che GitHub confermi la pubblicazione. L'indirizzo previsto è **[diepegi.github.io/sneaker-vault/](https://diepegi.github.io/sneaker-vault/)**. Prima della configurazione e del primo completamento può comparire una pagina 404. [Istruzioni ufficiali GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

I successivi caricamenti su `main` aggiornano il sito. Mantieni anche il file `.nojekyll`, incluso nel pacchetto.

### Alternativa: workflow manuale

Il file `.github/workflows/pages.yml` è un'alternativa al metodo precedente. Per usarlo, cambia **Settings → Pages → Source** in **GitHub Actions**, poi apri **Actions → Pubblica Sneaker Vault con GitHub Actions → Run workflow**, selezionando `main`. Ripeti **Run workflow** per pubblicare ogni aggiornamento. Con il metodo consigliato **main / (root)** non serve eseguire questo workflow. [Configurazione ufficiale GitHub Actions per Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#publishing-with-a-custom-github-actions-workflow).

## Aprila su iPhone

Quando il sito è pubblicato, apri in **Safari** il collegamento privato oppure scansiona il **QR privato** consegnato separatamente. Il collegamento ha la forma `https://diepegi.github.io/sneaker-vault/#key=…`: la parte finale contiene la chiave per aprire l'archivio. Non pubblicare né condividere quel collegamento o il QR.

**Prima di installarla, copia il codice di accesso** dal file privato `ACCESSO-PRIVATO.html`, consegnato insieme a `QR-privato-iPhone.png` fuori dal pacchetto pubblico.

In Safari usa **Condividi → Aggiungi alla schermata Home**. Se richiesto, attiva **Apri come app web**, poi tocca **Aggiungi**. Avvia Sneaker Vault dalla nuova icona. [Guida ufficiale Apple](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios).

Al primo avvio dall'icona può essere richiesto di nuovo l'accesso: **incolla il codice o il collegamento privato** nell'app. Safari e l'app aggiunta alla Home possono conservare i dati separatamente; aprire il collegamento in Safari non garantisce quindi che l'app dalla Home sia già sbloccata. La chiave non viene messa in un cookie né caricata su un server.

Conserva la chiave privata anche dopo il primo accesso: può servire su un nuovo dispositivo o se i dati del sito vengono cancellati.

## Archivio, prezzi e backup

- **Prezzi:** vedi l'ultima quotazione presente nell'archivio importato, con il collegamento a StockX per consultare il prodotto. La versione web non esegue ricerche automatiche o aggiornamenti dei prezzi in background. La ricerca prezzi dell'app sul PC rimane separata.
- **Modifiche:** quelle fatte sul telefono restano nel browser o nell'app web di quel dispositivo. Non vengono sincronizzate automaticamente con il PC, GitHub o altri telefoni.
- **Backup e importazione:** usa il backup completo JSON per conservare tutti i campi, la cronologia e i riferimenti alle immagini, anche quelli non mostrati nelle schede. Il CSV è utile come tabella, ma non sostituisce il backup completo. Importa un backup completo quando vuoi trasferire l'archivio; conserva prima una copia delle modifiche locali.
- **Offline:** dopo un primo caricamento completo online, l'interfaccia e l'archivio cifrato sono disponibili offline. Le foto remote richiedono una prima apertura online; soltanto quelle che il browser permette di verificare e memorizzare sono disponibili anche offline. La cache contiene al massimo 120 immagini. Nessuna immagine originale viene modificata.

## File privati e aggiornamenti

`vault.enc.json` contiene l'archivio cifrato con **AES-GCM**. La chiave e il QR privato sono consegnati **separatamente** dal sito e non devono essere inseriti nel repository. Il collegamento pubblico senza chiave non basta per decifrare l'archivio.

**Non caricare file `ACCESSO-PRIVATO`, chiavi, QR privati, `vault.json` in chiaro o backup personali.** `.gitignore` esclude diversi nomi comuni quando usi Git, ma non protegge dai file trascinati manualmente nell'interfaccia web di GitHub.

Per aggiornare l'archivio iniziale pubblicato occorre generare e caricare una nuova versione cifrata. Non sostituire `vault.enc.json` con un backup in chiaro. Le modifiche locali del telefono non vengono pubblicate dal sito.

Per chi mantiene il codice: incrementa `VERSION` in `sw.js` ogni volta che cambi un file dell'app o `vault.enc.json`. Il service worker installa l'intero gruppo di file solo se tutti i download riescono; un aggiornamento incompleto non sostituisce la versione offline precedente. La nuova versione si attiva quando chiudi tutte le finestre dell'app e la riapri. Il service worker gestisce soltanto file statici e una cache limitata delle immagini: non modifica l'archivio locale e non invia modifiche al PC.
