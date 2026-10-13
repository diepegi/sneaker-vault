import {loadVault, saveVault, recoverVault, loadPreviousVault, validateVault, decryptVault, getSettings, setSettings} from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR', maximumFractionDigits:0});
const money = n => fmt.format(Number(n) || 0);
const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('it-IT', {day:'numeric', month:'short', year:'numeric'}) : 'Non disponibile'; };
const qty = item => Number(item.qty) || 1;
const num = n => Number(n) || 0;
const title = item => [item.brand, item.model].filter(Boolean).join(' ');
const total = items => items.reduce((a, i) => ({value:a.value + num(i.current) * qty(i), spent:a.spent + num(i.paid) * qty(i), pairs:a.pairs + qty(i)}), {value:0, spent:0, pairs:0});
const icons = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  chart:'M3 3v18h18 M6 15l5-5 4 3 6-8',
  heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  settings:'M4 7h16 M4 17h16 M9 4v6 M16 14v6',
  search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  close:'M6 6l12 12 M6 18 18 6',
  arrow:'M7 17 17 7 M7 7h10v10',
  download:'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
  upload:'M12 16V4 m-5 5 5-5 5 5 M4 17v4h16v-4',
  plus:'M12 5v14 M5 12h14',
  copy:'M8 8h13v13H8z M16 8V3H3v13h5',
  shoe:'M3 14c4 0 5-6 5-6l5 4 6 2c2 1 2 3 2 4H3v-4Z M3 18v3h18v-3 M10 10l-2 3 M13 12l-2 3',
  check:'M4 12l5 5L20 6',
  back:'M19 12H5 m7-7-7 7 7 7'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.grid}"/></svg>`;
const state = {vault:null, view:'collection', query:'', brand:'', sort:'original', limit:24, busy:false, accessKey:null, pendingImport:null, editingId:null, editSnapshot:null, editValues:null, readError:false};
const dialog = $('#dialog');
let toastTimer, searchTimer;
let importSource = '';

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, error ? 8500 : 4200);
}
function failure(error, prefix = '') {
  console.error(error?.name || 'Errore', prefix || 'Operazione non riuscita');
  toast(prefix || error?.message || 'Operazione non riuscita. I dati precedenti restano al sicuro.', true);
}
function imageSource(value) {
  if (typeof value !== 'string') return '';
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i.test(value)) return value;
  try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}
function photo(item, lazy = true) {
  const src = imageSource(item.image);
  return src ? `<img src="${esc(src)}" alt="${esc(title(item))}" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async" referrerpolicy="no-referrer">` : `<span class="photo-missing">${icon('shoe')}<span>Foto non disponibile</span></span>`;
}
function stockx(item) {
  try { const u = new URL(item.market?.url); if (u.protocol === 'https:' && (u.hostname === 'stockx.com' || u.hostname.endsWith('.stockx.com'))) return u.href; } catch {}
  return 'https://stockx.com/search?s=' + encodeURIComponent(item.sku || title(item));
}
function currentObservation(item) {
  const hist = Array.isArray(item.hist) ? item.hist : [];
  const last = hist.at(-1);
  if (last && num(last.t) > num(item.market?.at) && last.src !== 'stockx' && num(last.p) === num(item.current)) return {at:last.t, label:last.src === 'sim' ? 'Stima storica salvata' : 'Valore inserito a mano'};
  if (item.market?.at) return {at:item.market.at, label:'Quotazione salvata'};
  return {at:last?.t, label:'Valore salvato'};
}
function latestQuote() {
  return Math.max(0, ...state.vault.items.map(i => num(i.market?.at)));
}
function itemById(id) { return state.vault?.items.find(i => String(i.id) === String(id)); }
function empty(message, description, action = '') { return `<div class="empty-state">${icon('shoe')}<h2>${message}</h2><p>${description}</p>${action}</div>`; }
function nav() {
  $('#navigation').innerHTML = [['collection','grid','Collezione'],['portfolio','chart','Portfolio'],['favorites','heart','Watchlist'],['settings','settings','Il mio vault']].map(([view, symbol, label]) => `<button class="nav-button ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></button>`).join('');
}
function head(eyebrow, heading, description = '') { return `<div class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1>${description ? `<p>${description}</p>` : ''}</div></div>`; }
function card(item) {
  const cost = num(item.paid), gain = num(item.current) - cost;
  return `<article class="shoe-card"><div class="shoe-photo"><button class="photo-open" data-detail="${esc(item.id)}" aria-label="Apri ${esc(title(item))}">${photo(item)}</button><button class="icon-button ${item.watch ? 'active' : ''}" data-watch="${esc(item.id)}" aria-pressed="${Boolean(item.watch)}" aria-label="${item.watch ? 'Rimuovi dalla' : 'Aggiungi alla'} watchlist: ${esc(title(item))}">${icon('heart')}</button></div><div class="shoe-info"><div class="shoe-brand"><span>${esc(item.brand)}</span><span>EU ${esc(item.size ?? '—')}</span></div><button class="shoe-name" data-detail="${esc(item.id)}">${esc(item.model || 'Sneaker')}</button><div class="shoe-meta"><span>${esc(item.condition || 'Condizione n.d.')}</span><span>·</span><span>${qty(item)} ${qty(item) === 1 ? 'paio' : 'paia'}</span></div><div class="shoe-price"><span>${money(item.current)} <small>/ paio</small></span>${cost > 0 ? `<span class="change ${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${Math.round(gain / cost * 100)}%</span>` : '<span class="badge">Valore salvato</span>'}</div></div></article>`;
}
function filtered() {
  let items = state.vault.items.filter(i => state.view !== 'favorites' || i.watch);
  if (state.brand) items = items.filter(i => i.brand === state.brand);
  const query = state.query.trim().toLocaleLowerCase('it');
  if (query) items = items.filter(i => [i.brand, i.model, i.sku, i.colorway, i.size, i.notes].join(' ').toLocaleLowerCase('it').includes(query));
  if (state.sort === 'value-desc') items.sort((a,b) => num(b.current)*qty(b) - num(a.current)*qty(a));
  if (state.sort === 'value-asc') items.sort((a,b) => num(a.current)*qty(a) - num(b.current)*qty(b));
  if (state.sort === 'name') items.sort((a,b) => title(a).localeCompare(title(b), 'it'));
  if (state.sort === 'recent') items.sort((a,b) => (Date.parse(b.added)||0) - (Date.parse(a.added)||0));
  return items;
}
function collectionResults() {
  const items = filtered(), stats = total(items);
  return `<div class="collection-summary"><div><span class="eyebrow">${items.length} modelli · ${stats.pairs} paia</span><strong>${money(stats.value)}</strong></div><div>Quotazioni salvate<br><small>${latestQuote() ? date(latestQuote()) : 'Nessun aggiornamento registrato'}</small></div></div><div class="shoe-grid">${items.slice(0,state.limit).map(card).join('')}</div>${items.length === 0 ? empty('Nessuna sneaker qui', state.vault.items.length ? 'Prova un’altra ricerca o aggiungi un modello alla watchlist.' : 'Importa un backup oppure aggiungi la tua prima sneaker.', '<button class="button primary" data-action="add">Aggiungi sneaker</button>') : ''}${items.length > state.limit ? `<button class="button secondary full load-more" data-action="more">Mostra altre · ${items.length - state.limit} rimaste</button>` : ''}`;
}
function collection() {
  const brands = [...new Set(state.vault.items.map(i => i.brand).filter(Boolean))].sort();
  return head('Ogni paio, una storia', state.view === 'favorites' ? 'La tua watchlist' : 'La tua collezione') + `<label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Modello, SKU, taglia…" aria-label="Cerca nella collezione" value="${esc(state.query)}" autocomplete="off"></label><div class="filters" aria-label="Filtra e ordina"><button class="filter-chip ${!state.brand ? 'active' : ''}" data-brand="" aria-pressed="${!state.brand}">Tutti</button>${brands.map(b => `<button class="filter-chip ${state.brand === b ? 'active' : ''}" data-brand="${esc(b)}" aria-pressed="${state.brand === b}">${esc(b)}</button>`).join('')}<select id="sort" aria-label="Ordina la collezione">${[['original','Il mio ordine'],['value-desc','Valore più alto'],['value-asc','Valore più basso'],['name','Nome A–Z'],['recent','Aggiunte recenti']].map(([v,l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div id="collection-results">${collectionResults()}</div>`;
}
function chart(points, label) {
  const safe = points.filter(p => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.p))).sort((a,b)=>a.t-b.t);
  if (safe.length < 2) return '<p class="muted">Servono almeno due rilevazioni per mostrare l’andamento.</p>';
  const min = Math.min(...safe.map(p => num(p.p))), max = Math.max(...safe.map(p => num(p.p)));
  const start = num(safe[0].t), end = num(safe.at(-1).t);
  const coords = safe.map(p => `${(12 + (num(p.t)-start)/(end-start||1)*496).toFixed(2)},${(150 - (num(p.p)-min)/(max-min||1)*126).toFixed(2)}`).join(' ');
  return `<div class="chart"><svg viewBox="0 0 520 182" role="img" aria-label="${esc(label)}: da ${esc(money(safe[0].p))} a ${esc(money(safe.at(-1).p))}"><path d="M12 150H508 M12 87H508 M12 24H508" stroke="currentColor" opacity=".1"/><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="179" fill="currentColor" font-size="12">${esc(date(safe[0].t))}</text><text x="508" y="179" text-anchor="end" fill="currentColor" font-size="12">${esc(date(safe.at(-1).t))}</text></svg></div>`;
}
function portfolio() {
  const items = state.vault.items, stats = total(items);
  const costed = items.filter(i => num(i.paid) > 0), comparable = total(costed), gain = comparable.value - comparable.spent;
  const top = [...items].sort((a,b)=>num(b.current)*qty(b)-num(a.current)*qty(a)).slice(0,5);
  return head('Il valore delle tue scelte','Portfolio','Una fotografia della collezione, basata sui valori che hai salvato.') + `<section class="panel"><span class="eyebrow">Valore complessivo</span><div class="hero-value">${money(stats.value)}</div><p>${stats.pairs} paia · ${items.length} modelli · ${new Set(items.map(i => i.brand)).size} brand</p>${chart((state.vault.snaps || []).map(s=>({t:s.t,p:s.value})), 'Storico del valore della collezione')}<p>Storico conservato dal tuo archivio. Il totale qui sopra riflette le modifiche attuali.</p></section><div class="stats-grid"><div class="stat"><span>Spesa registrata</span><strong>${money(stats.spent)}</strong><small>${costed.length} modelli con costo inserito</small></div><div class="stat"><span>Differenza sul costo</span><strong>${gain >= 0 ? '+' : ''}${money(gain)}</strong><small>Solo modelli con costo &gt; 0</small></div><div class="stat"><span>Nella watchlist</span><strong>${items.filter(i=>i.watch).length}</strong><small>Modelli che segui</small></div><div class="stat"><span>Da completare</span><strong>${items.length - costed.length}</strong><small>Modelli senza costo d’acquisto</small></div></div><section class="panel"><h2>I pezzi di maggior valore</h2>${top.map(i=>`<button class="recent-row" data-detail="${esc(i.id)}"><span class="shoe-photo">${photo(i)}</span><div><strong>${esc(title(i))}</strong><small>EU ${esc(i.size)} · ${qty(i)} ${qty(i)===1?'paio':'paia'}</small></div><strong>${money(num(i.current)*qty(i))}</strong></button>`).join('') || '<p>La tua collezione è ancora vuota.</p>'}</section><div class="notice">I valori sono quelli salvati, non quotazioni in tempo reale. Dalla scheda di ogni sneaker puoi aprire StockX e consultare il mercato.</div>`;
}
function setting(action, symbol, label, help) { return `<button class="setting-row" data-action="${action}">${icon(symbol)}<div><strong>${label}</strong><small>${help}</small></div>${icon('arrow')}</button>`; }
function settings() {
  return head('Al sicuro, a portata di mano','Il mio vault','La collezione di questo dispositivo. Le modifiche si salvano qui automaticamente.') + `<div class="notice"><strong>iPhone e PC hanno archivi separati.</strong><br>Per trasferire gli aggiornamenti, esporta un backup JSON e importalo sull’altro dispositivo. Le immagini e lo storico sono inclusi come nel file originale.</div><div class="settings-list">${setting('install','plus','Installa su iPhone','Safari → Condividi → Aggiungi alla schermata Home')}${setting('backup','download','Esporta backup completo','Tutti i modelli, foto, note e storico in un file JSON')}${setting('import','upload','Importa un backup','Mostra un’anteprima prima di sostituire l’archivio locale')}${setting('csv','download','Esporta tabella CSV','Apri la collezione in Numbers o Excel')}${setting('previous','back','Recupera versione precedente','Scarica l’archivio prima dell’ultima modifica salvata')}${state.accessKey ? setting('copy-key','copy','Copia codice di accesso','Per il primo avvio dalla schermata Home') : ''}${setting('persistent','check','Proteggi i dati sul dispositivo','Richiedi al browser di conservare lo spazio utilizzato')}</div><section class="panel"><h2>Pronta anche offline</h2><p>L’app e l’archivio locale si aprono anche senza rete dopo il primo caricamento completo. Le foto esterne richiedono internet se non sono già disponibili nella cache.</p><p>Conserva periodicamente un backup: eliminare i dati del sito o rimuovere l’app può cancellare l’archivio locale.</p></section><p class="muted version">Sneaker Vault Mobile · 1.0.0<br>Nessun account, tracciamento o aggiornamento prezzi in background.</p>`;
}
function render() {
  if (!state.vault) return;
  $('#shell').hidden = false; $('#gate').hidden = true;
  nav();
  $('#page').innerHTML = state.view === 'portfolio' ? portfolio() : state.view === 'settings' ? settings() : collection();
}
function modal(heading, body, footer = '') {
  dialog.innerHTML = `<header class="dialog-header"><h2 id="dialog-title">${heading}</h2><button class="icon-button" data-action="close" aria-label="Chiudi">${icon('close')}</button></header><div class="dialog-body">${body}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}`;
  if (!dialog.open) dialog.showModal();
  $('.dialog-body', dialog).scrollTop = 0;
}
function close() { if (state.busy) return; dialog.close(); state.pendingImport = null; }
function detail(id) {
  const i = itemById(id); if (!i) return;
  const obs = currentObservation(i);
  modal('La tua sneaker', `<div class="detail-photo">${photo(i,false)}</div><h1 class="detail-title"><span class="eyebrow">${esc(i.brand)}</span>${esc(i.model)}<small>${esc(i.colorway || '')}</small></h1><div class="hero-value">${money(i.current)} <small>/ paio</small></div><p class="muted">${obs.label}${obs.at ? ' · '+date(obs.at) : ''}${obs.label === 'Quotazione salvata' && i.market?.basis ? ' · '+esc(i.market.basis) : ''}</p><div class="detail-grid">${[['Taglia EU',i.size],['Quantità',qty(i)],['Condizione',i.condition],['Pagato / paio',money(i.paid)],['Retail / paio',money(i.retail)],['SKU',i.sku || '—'],['Categoria',i.category || '—'],['Data uscita',i.release ? date(i.release) : '—'],['Aggiunta il',i.added ? date(i.added) : '—']].map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div><section class="panel"><h3>Storico conservato</h3>${chart(Array.isArray(i.hist)?i.hist:[], 'Storico dei valori salvati')}<p>Rilevazioni presenti nel tuo archivio originale, incluse eventuali stime passate.</p></section>${i.notes ? `<section class="panel"><h3>Note</h3><p class="notes">${esc(i.notes)}</p></section>` : ''}<div class="notice">Consulta il prezzo attuale su StockX. Le quotazioni qui non si aggiornano automaticamente.</div>`, `<button class="button secondary" data-edit="${esc(i.id)}">Modifica</button><a class="button primary" href="${esc(stockx(i))}" target="_blank" rel="noopener noreferrer">StockX ${icon('arrow')}</a>`);
}
function input(name, label, value, type='text', attrs='') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
}
function edit(id) {
  const i = id != null ? itemById(id) : {brand:'',model:'',qty:1,size:'',condition:'Deadstock'};
  if (!i) return;
  state.editingId = id ?? null;
  state.editSnapshot = state.vault;
  modal(id ? 'Modifica sneaker' : 'Aggiungi sneaker', `<form id="shoe-form" class="form-grid">${input('brand','Brand',i.brand,'text','required maxlength="120"')}${input('model','Modello',i.model,'text','required maxlength="240"')}${input('colorway','Colorway',i.colorway,'text','maxlength="500"')}${input('sku','SKU',i.sku,'text','maxlength="120"')}${input('size','Taglia EU',i.size,'number','required min="1" max="80" step="0.5" inputmode="decimal"')}${input('qty','Quantità',i.qty,'number','required min="1" max="9999" step="1" inputmode="numeric"')}${input('condition','Condizione',i.condition,'text','list="conditions" maxlength="120"')}<datalist id="conditions"><option>Deadstock</option><option>VNDS</option><option>Usata</option></datalist>${input('category','Categoria',i.category,'text','maxlength="120"')}${input('paid','Pagato per paio (€)',i.paid ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('retail','Retail per paio (€)',i.retail ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('current','Valore per paio (€)',i.current ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('release','Data uscita',(i.release || '').slice(0,10), 'date')}<label class="field full"><span>Note</span><textarea name="notes" maxlength="20000">${esc(i.notes || '')}</textarea></label><label class="field full"><span>Link immagine (HTTPS)</span><input name="image" value="${esc(i.image || '')}" type="text" autocomplete="off"><small>La foto attuale resta invariata finché non cambi questo campo.</small></label><label class="field full"><span>Oppure scegli una foto dal telefono</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"><small>Viene conservato il file originale, senza compressione. Massimo 12 MB per foto.</small></label><p id="form-error" class="notice error full" role="alert" hidden></p></form>`, `<button class="button secondary" data-action="close">Annulla</button><button class="button primary" type="submit" form="shoe-form">Salva sneaker</button>`);
  state.editValues = Object.fromEntries(new FormData($('#shoe-form')));
}
function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('button').forEach(b => { b.disabled = busy; });
}
async function commit(next, expected = state.vault) {
  if (state.busy) return false;
  setBusy(true);
  try { validateVault(next); await saveVault(next, {expected}); state.vault = next; return true; }
  catch (e) {
    if (e.code === 'VAULT_CONFLICT') {state.vault=await loadVault();render();throw new Error('La collezione è cambiata in un’altra scheda. Chiudi e riapri la scheda della sneaker prima di modificare.');}
    throw e;
  }
  finally { setBusy(false); }
}
async function saveShoe(form) {
  if (state.busy || !form.reportValidity()) return;
  $('#form-error').hidden = true;
  try {
    const f = new FormData(form), old = state.editingId != null ? itemById(state.editingId) : null;
    if (state.editingId && !old) throw new Error('La sneaker non è più presente. Chiudi e riapri la scheda.');
    let img = old && f.get('image') === state.editValues.image ? old.image : String(f.get('image') || '').trim();
    const file = f.get('photo');
    if (file && file.size > 0) {
      if (file.size > 12 * 1024 * 1024) throw new Error('La foto supera 12 MB. Scegli un file più piccolo.');
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) throw new Error('Scegli una foto JPG, PNG, WebP, GIF o AVIF.');
      img = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('La foto non è leggibile.'));r.readAsDataURL(file);});
    }
    if (img && !imageSource(img) && img !== old?.image) throw new Error('Usa un link HTTPS per l’immagine oppure scegli una foto.');
    const record = {...(old || {id:'sv-'+crypto.randomUUID(),added:new Date().toISOString().slice(0,10),watch:false,hist:[],palette:['#233729','#d4e3c2','#15241c']})};
    for (const key of ['brand','model','colorway','sku','condition','category','notes']) if (!old || f.get(key) !== state.editValues[key]) record[key] = key === 'notes' ? String(f.get(key) || '') : String(f.get(key) || '').trim();
    if (!record.brand || !record.model) throw new Error('Inserisci brand e modello.');
    for (const key of ['size','qty','paid','retail','current']) {
      if (!old || f.get(key) !== state.editValues[key]) record[key] = Number(f.get(key));
      if (!Number.isFinite(record[key]) || record[key] < 0) throw new Error('Controlla i valori numerici.');
    }
    if (!old || f.get('release') !== state.editValues.release) record.release = String(f.get('release') || '') || null;
    if (!old || img !== old.image) record.image = img || null;
    if (!old || num(old.current) !== record.current) record.hist = [...(old?.hist || []), {t:Date.now(),p:record.current,src:'manual'}];
    const next = {...state.vault, items:old ? state.vault.items.map(i=>i.id===old.id?record:i) : [record,...state.vault.items]};
    if (await commit(next, state.editSnapshot)) { dialog.close(); render(); detail(record.id); toast('Sneaker salvata su questo dispositivo.'); }
  } catch (e) { if ($('#form-error')) { $('#form-error').textContent=e.message || 'Salvataggio non riuscito. I dati precedenti sono conservati.'; $('#form-error').hidden=false; $('#form-error').scrollIntoView({block:'nearest'}); } else failure(e); }
}
async function watch(id) {
  const i = itemById(id); if (!i || state.busy) return;
  const next = {...state.vault,items:state.vault.items.map(v=>v.id===i.id?{...v,watch:!v.watch}:v)};
  if (await commit(next)) { render(); toast(i.watch ? 'Rimossa dalla watchlist.' : 'Aggiunta alla watchlist.'); }
}
function parseKey(value) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return text;
  try { const url = new URL(text); const key = new URLSearchParams(url.hash.slice(1)).get('key'); if (/^[A-Za-z0-9_-]{43}$/.test(key || '')) return key; } catch {}
  throw new Error('Incolla il codice completo o il link contenuto nel tuo QR privato.');
}
function gate(error = '') {
  $('#shell').hidden = true; $('#gate').hidden = false;
  $('#gate').innerHTML = `<div class="gate-card"><span class="eyebrow">Sneaker Vault · accesso privato</span><h1>Il tuo vault.<br>Sempre con te.</h1><p>Apri il tuo QR privato oppure incolla il codice di accesso per ritrovare la collezione.</p>${error ? `<p class="notice error" role="alert">${esc(error)}</p>` : ''}<form id="unlock-form"><label class="field"><span>Codice o link privato</span><input name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Incolla qui il tuo accesso" required></label><button class="button primary" type="submit">Apri la collezione ${icon('arrow')}</button></form><button class="button secondary" data-action="import">Importa un backup JSON</button>${state.readError ? '<button class="button secondary" data-action="previous">Recupera versione precedente</button>' : '<button class="button secondary" data-action="empty">Crea un vault vuoto</button>'}<small>Primo avvio dalla schermata Home? Incolla lo stesso codice del QR: Safari e l’app installata possono avere archivi separati. Conserva il codice solo per te.</small></div>`;
}
async function unlock(value) {
  if (state.busy) return;
  if (state.readError) {toast('Prima recupera il backup o chiudi e riapri l’app. Il QR non sostituisce un archivio illeggibile.',true);return;}
  let key;
  try { key = parseKey(value); } catch(e) { gate(e.message); return; }
  setBusy(true);
  try {
    const response = await fetch('./vault.enc.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('Archivio non disponibile. Verifica la connessione e la pubblicazione su GitHub Pages.');
    const bundle = await response.json();
    let vault;
    try { vault = await decryptVault(bundle,key); } catch { throw new Error('Codice non valido o archivio danneggiato. Usa il codice nel tuo file di accesso privato.'); }
    // An already open local archive is never replaced by following the original QR.
    if (state.vault) { toast('La collezione locale è già aperta. Le tue modifiche restano conservate.'); return; }
    state.vault=await saveVault(vault, {onlyIfMissing:true}); state.accessKey=key;
    try { await setSettings({accessKey:key}); } catch { /* The collection is durable even if preferences cannot be saved. */ }
    history.replaceState(null,'',location.pathname+location.search);
    render();
    if (!isStandalone()) showInstall();
    toast(`${vault.items.length} modelli trasferiti. Collezione salvata su questo dispositivo.`);
  } catch (e) { gate(e.message || 'Impossibile salvare i dati. Controlla lo spazio disponibile e riprova.'); }
  finally { setBusy(false); }
}
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function showInstall() {
  modal('Sneaker Vault sul tuo iPhone', `<div class="notice"><strong>Apri questa pagina in Safari.</strong><br>Il browser della fotocamera o di altre app potrebbe non mostrare l’opzione di installazione.</div><ol class="install-steps"><li><strong>Copia il codice privato</strong><p>Ti servirà al primo avvio dall’icona sulla Home. È lo stesso codice presente nel tuo file di accesso.</p></li><li><strong>Tocca Condividi in Safari</strong><p>Scegli “Aggiungi alla schermata Home”, attiva “Apri come app web” se compare e tocca Aggiungi.</p></li><li><strong>Apri l’icona Sneaker Vault</strong><p>Se viene richiesto, incolla il codice e apri la collezione. Da quel momento i dati rimangono in questa app.</p></li></ol><p>Le modifiche fatte in Safari potrebbero non comparire nella versione installata. Per trasferirle usa Esporta backup e Importa backup.</p>`, `${state.accessKey ? '<button class="button primary" data-action="copy-key">Copia codice privato</button>' : ''}<button class="button secondary" data-action="close">Ho capito</button>`);
}
async function copyKey() {
  if (!state.accessKey) return;
  try { await navigator.clipboard.writeText(state.accessKey); toast('Codice copiato. Incollalo al primo avvio dalla Home.'); }
  catch { modal('Il tuo codice privato', `<p>Seleziona e copia il codice. Conservalo solo per te: apre la copia iniziale della tua collezione.</p><label class="field"><span>Codice di accesso</span><input id="copy-code" readonly value="${esc(state.accessKey)}"></label>`, '<button class="button primary" data-action="close">Chiudi</button>'); $('#copy-code').select(); }
}
function download(data, filename, type) {
  const blob = new Blob([data],{type}); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function backup(vault=state.vault, suffix='') {
  if (!vault) return;
  download(JSON.stringify(vault,null,2),`sneaker-vault${suffix}-${new Date().toISOString().slice(0,10)}.json`,'application/json');
  toast('Backup preparato. Conservalo nell’app File.');
}
function exportCsv() {
  const cell = value => { let s=String(value??''); if (/^[=+@\-\t\r]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
  const lines = [['Brand','Modello','Colorway','SKU','Taglia EU','Quantità','Condizione','Categoria','Pagato per paio EUR','Valore per paio EUR','Valore totale EUR','Note','Immagine','StockX'], ...state.vault.items.map(i=>[i.brand,i.model,i.colorway,i.sku,i.size,qty(i),i.condition,i.category,i.paid,i.current,num(i.current)*qty(i),i.notes,i.image,stockx(i)])];
  download('\uFEFF'+lines.map(row=>row.map(cell).join(';')).join('\r\n'),'sneaker-vault.csv','text/csv;charset=utf-8');
}
async function importFile(file) {
  if (!file || state.busy) return;
  if (file.size > 100*1024*1024) throw new Error('Il file supera 100 MB. Usa un archivio più piccolo.');
  let incoming;
  try { incoming = JSON.parse(await file.text()); validateVault(incoming); } catch(e) { throw new Error('Backup non valido: '+(e.message||'il file deve essere un archivio Sneaker Vault JSON.')); }
  state.pendingImport = incoming; importSource=file.name;
  const stats = total(incoming.items);
  modal('Controlla il backup', `<span class="eyebrow">${esc(file.name)}</span><h1 class="detail-title">${incoming.items.length} modelli.<br>Pronti da importare.</h1><div class="detail-grid"><div><small>Paia</small><strong>${stats.pairs}</strong></div><div><small>Immagini</small><strong>${incoming.items.filter(i=>i.image).length}</strong></div><div><small>Valore salvato</small><strong>${money(stats.value)}</strong></div></div><div class="notice">${state.readError ? 'Confermando, recuperi la collezione da questo backup. La copia illeggibile viene conservata separatamente e la versione precedente resta intatta.' : state.vault ? 'Confermando, sostituisci la collezione su questo dispositivo. Una copia precedente rimane recuperabile da “Il mio vault” fino alla modifica successiva. Esporta prima un backup per conservarla nel tempo.' : 'La collezione verrà salvata su questo dispositivo.'}<br>Il PC e i file originali restano invariati.</div>`, `${state.vault ? '<button class="button secondary" data-action="backup">Backup attuale</button>' : '<button class="button secondary" data-action="close">Annulla</button>'}<button class="button primary" data-action="confirm-import">Conferma importazione</button>`);
}
async function confirmImport() {
  const next = state.pendingImport; if (!next) return;
  let saved=false;
  if (state.readError) {setBusy(true);try{await recoverVault(next);state.vault=next;state.readError=false;saved=true;}finally{setBusy(false);}}
  else saved=await commit(next);
  if (saved) { dialog.close(); state.pendingImport=null; state.query='';state.brand='';state.limit=24;render();toast(`Importati ${next.items.length} modelli da ${importSource}.`); }
}
async function previous() {
  const old = await loadPreviousVault();
  if (!old) { toast('Nessuna versione precedente ancora disponibile.'); return; }
  modal('Versione precedente', `<p>Disponibile una copia con <strong>${old.items.length} modelli</strong>. Scaricala per conservarla o importarla dopo averla controllata.</p><div class="notice">Questa operazione scarica un backup e mantiene la collezione attuale.</div>`, '<button class="button primary" data-action="download-previous">Scarica versione precedente</button>');
}
async function persistent() {
  if (!navigator.storage?.persist) { toast('Il browser gestisce automaticamente lo spazio. Conserva anche un backup JSON.'); return; }
  const granted = await navigator.storage.persist();
  toast(granted ? 'Il browser ha concesso la conservazione persistente dei dati.' : 'Il browser non ha concesso spazio persistente. I dati restano salvati; conserva anche un backup.');
}
async function action(name) {
  if (state.busy) return;
  if (name === 'close') return close();
  if (name === 'add') return edit();
  if (name === 'more') {state.limit+=24; $('#collection-results').innerHTML=collectionResults(); return;}
  if (name === 'install') return showInstall();
  if (name === 'copy-key') return copyKey();
  if (name === 'backup') return backup();
  if (name === 'csv') return exportCsv();
  if (name === 'import') { $('#import-file').value=''; $('#import-file').click(); return; }
  if (name === 'confirm-import') return confirmImport();
  if (name === 'previous') return previous();
  if (name === 'download-previous') return backup(await loadPreviousVault(),'-precedente');
  if (name === 'persistent') return persistent();
  if (name === 'empty' && !state.vault) {if(await commit({v:1,items:[],snaps:[],ui:{}})) render();}
}
document.addEventListener('click', e => {
  const target=e.target.closest('button,[data-action],[data-detail]');
  if (!target || state.busy) return;
  const d=target.dataset;
  if (d.view) { state.view=d.view;state.limit=24;state.query='';state.brand='';render();window.scrollTo(0,0);$('#page').focus({preventScroll:true});return; }
  if ('brand' in d) {state.brand=d.brand;state.limit=24;render();return;}
  if (d.detail) return detail(d.detail);
  if (d.edit) return edit(d.edit);
  if (d.watch) {watch(d.watch).catch(e=>failure(e));return;}
  if (d.action) action(d.action).catch(e=>failure(e));
});
document.addEventListener('input',e=>{
  if (e.target.id!=='search') return;
  state.query=e.target.value;state.limit=24;
  clearTimeout(searchTimer); searchTimer=setTimeout(()=>{const root=$('#collection-results');if(root)root.innerHTML=collectionResults();},100);
});
document.addEventListener('change',e=>{
  if(e.target.id==='sort'){state.sort=e.target.value;$('#collection-results').innerHTML=collectionResults();}
  if(e.target.id==='import-file')importFile(e.target.files[0]).catch(e=>failure(e));
});
document.addEventListener('submit',e=>{
  if(e.target.id==='unlock-form'){e.preventDefault();unlock(new FormData(e.target).get('key'));}
  if(e.target.id==='shoe-form'){e.preventDefault();saveShoe(e.target);}
});
document.addEventListener('error', e => {
  if (e.target.tagName !== 'IMG') return;
  const img=e.target; const parent=img.parentElement;
  if (parent && !parent.querySelector('.photo-missing')) {const fallback=document.createElement('span');fallback.className='photo-missing';fallback.innerHTML=icon('shoe')+'<span>Foto non disponibile offline</span>';parent.append(fallback);}
  img.hidden=true;
},true);
dialog.addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
window.addEventListener('hashchange',()=>{
  const key=new URLSearchParams(location.hash.slice(1)).get('key');
  if(key && !state.vault) unlock(key);
  else if(key) {history.replaceState(null,'',location.pathname+location.search);toast('Collezione locale conservata: il QR non sostituisce le tue modifiche.');}
});
function connection() { $('#connection').hidden=navigator.onLine; }
window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();

async function start() {
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  try {
    state.vault = await loadVault();
    if (state.vault) {
      try {state.accessKey=(await getSettings()).accessKey || null;}catch{}
      history.replaceState(null,'',location.pathname+location.search);
      render();
    } else if (key) await unlock(key);
    else gate();
  } catch (e) {
    // Do not replace an unreadable local archive with the bundled original.
    state.readError=true;
    gate('Impossibile leggere l’archivio locale. Chiudi e riapri l’app. Per recuperarlo, importa una tua copia di backup.');
    failure(e,'L’archivio locale non è stato modificato.');
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>toast('La modalità offline non è ancora pronta. Riapri l’app con una connessione disponibile.'));
}
start();
