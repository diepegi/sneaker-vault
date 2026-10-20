import {loadVault, saveVault, recoverVault, loadPreviousVault, validateVault, decryptVault, getSettings, setSettings} from './storage.js';
import {queryItems, collectionStats, brandBreakdown} from './insights.js';
import {readArchiveFile} from './importer.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = new Intl.NumberFormat('it-IT', {style:'currency', currency:'EUR', maximumFractionDigits:0});
const money = n => fmt.format(Number(n) || 0);
const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('it-IT', {day:'numeric', month:'short', year:'numeric'}) : 'Non disponibile'; };
const qty = item => Number.isFinite(Number(item.qty)) ? Math.max(0,Number(item.qty)) : 1;
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
  ,filter:'M4 7h16 M7 12h10 M10 17h4'
  ,list:'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01'
  ,compare:'M8 3v18 M16 3v18 M3 8h10 M11 16h10'
  ,zoom:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M6 10h8 M10 6v8'
  ,share:'M12 16V3 m-4 4 4-4 4 4 M5 12v9h14v-9'
  ,target:'M21 12a9 9 0 1 1-9-9 M16 12a4 4 0 1 1-4-4 M12 12 22 2 M17 2h5v5'
  ,refresh:'M21 8a9 9 0 0 0-15-4L3 7 M3 2v5h5 M3 16a9 9 0 0 0 15 4l3-3 M21 22v-5h-5'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] || icons.grid}"/></svg>`;
const state = {vault:null, view:'collection', query:'', brand:'', sort:'original', limit:24, busy:false, accessKey:null, pendingImport:null, editingId:null, editSnapshot:null, editValues:null, readError:false,
  layout:'gallery', cardSize:3, condition:'', size:'', minPrice:'', maxPrice:'', quick:'all', compare:[], currentDetail:null, editorDirty:false, chartRange:'all', backupAt:null, externalChange:false};
const dialog = $('#dialog');
let toastTimer, searchTimer, preferenceTimer, importToken=0, registration=null, updateRequested=false, lastUpdateCheck=0;
const syncChannel = 'BroadcastChannel' in window ? new BroadcastChannel('sneaker-vault-changes') : null;
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
  return src ? `<img src="${esc(src)}" alt="${esc(title(item))}" width="1200" height="750" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async" referrerpolicy="no-referrer">` : `<span class="photo-missing">${icon('shoe')}<span>Foto non disponibile</span></span>`;
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
  return state.vault.items.reduce((latest,i)=>Math.max(latest,num(i.market?.at)),0);
}
function itemById(id) { return state.vault?.items.find(i => String(i.id) === String(id)); }
function empty(message, description, action = '') { return `<div class="empty-state">${icon('shoe')}<h2>${message}</h2><p>${description}</p>${action}</div>`; }
function nav() {
  $('#navigation').innerHTML = [['collection','grid','Collezione'],['portfolio','chart','Portfolio'],['favorites','heart','Watchlist'],['settings','settings','Il mio vault']].map(([view, symbol, label]) => `<button class="nav-button ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></button>`).join('');
}
function head(eyebrow, heading, description = '') { return `<div class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1>${heading}</h1>${description ? `<p>${description}</p>` : ''}</div></div>`; }
function targetBadge(item) {
  const target = num(item.targetPrice);
  if (target <= 0) return '';
  const reached = num(item.current)>0 && num(item.current)<=target;
  return `<span class="badge ${reached ? 'accent' : ''}">${icon('target')}${reached ? 'Obiettivo raggiunto' : 'Obiettivo '+money(target)}</span>`;
}
function card(item) {
  const cost=num(item.paid), gain=num(item.current)-cost, selected=state.compare.includes(String(item.id));
  return `<article class="shoe-card ${selected ? 'is-selected' : ''}"><div class="shoe-photo"><button class="photo-open" data-detail="${esc(item.id)}" aria-label="Apri ${esc(title(item))}">${photo(item)}</button><button class="compare-toggle ${selected?'active':''}" data-compare="${esc(item.id)}" aria-pressed="${selected}" aria-label="${selected?'Rimuovi dal':'Aggiungi al'} confronto: ${esc(title(item))}">${icon(selected?'check':'compare')}</button><button class="icon-button ${item.watch?'active':''}" data-watch="${esc(item.id)}" aria-pressed="${Boolean(item.watch)}" aria-label="${item.watch?'Rimuovi dalla':'Aggiungi alla'} watchlist: ${esc(title(item))}">${icon('heart')}</button></div><div class="shoe-info"><div class="shoe-brand"><span>${esc(item.brand)}</span><span>EU ${esc(item.size??'—')}</span></div><button class="shoe-name" data-detail="${esc(item.id)}">${esc(item.model || 'Sneaker')}</button><div class="shoe-meta"><span>${esc(item.condition || 'Condizione n.d.')}</span><span>·</span><span>${qty(item)} ${qty(item)===1?'paio':'paia'}</span></div><div class="shoe-price"><span>${money(item.current)} <small>/ paio</small></span>${cost>0 ? `<span class="change ${gain>=0?'up':'down'}">${gain>=0?'+':''}${Math.round(gain/cost*100)}%</span>`:'<span class="badge">Valore salvato</span>'}</div>${targetBadge(item)}</div></article>`;
}
function filtered() {
  return queryItems(state.vault.items,{query:state.query,brand:state.brand,condition:state.condition,size:state.size,minPrice:state.minPrice,maxPrice:state.maxPrice,quick:state.quick,sort:state.sort,watchOnly:state.view==='favorites'});
}
function activeFilters() {
  const labels=[];
  if(state.brand)labels.push(state.brand);
  if(state.condition)labels.push(state.condition);
  if(state.size)labels.push('EU '+state.size);
  if(state.minPrice!=='')labels.push('Da '+money(state.minPrice));
  if(state.maxPrice!=='')labels.push('Fino a '+money(state.maxPrice));
  const quickLabel={'missing-cost':'Senza costo','missing-photo':'Senza foto',stale:'Prezzi da rivedere'}[state.quick];
  if(quickLabel)labels.push(quickLabel);
  return labels;
}
function collectionResults() {
  const items=filtered(), stats=collectionStats(items), labels=activeFilters();
  return `<div class="filter-summary">${labels.map(l=>`<span class="active-filter">${esc(l)}</span>`).join('')}${labels.length||state.query?'<button data-action="reset-filters">Azzera filtri</button>':''}</div><div class="collection-summary"><span><strong>${items.length}</strong> ${items.length===1?'modello':'modelli'}${labels.length||state.query?' trovati':''}</span><span>${money(stats.value)} <small>totali</small></span></div><div class="shoe-grid size-${['compact','medium','large'][state.cardSize-1]} ${state.layout==='list'?'is-list':''}">${items.slice(0,state.limit).map(card).join('')}</div>${!items.length?empty(state.view==='favorites'?'La tua selezione inizia qui':'Nessun risultato',state.vault.items.length?'Aggiungi i tuoi preferiti con il cuore o prova a cambiare i filtri.':'Importa un backup oppure aggiungi la prima sneaker.',state.vault.items.length?'<button class="button secondary" data-action="reset-filters">Azzera filtri</button>':'<button class="button primary" data-action="add">Aggiungi sneaker</button>'):''}${items.length>state.limit?`<button class="button secondary full load-more" data-action="more">Mostra altre · ${items.length-state.limit} rimaste</button>`:''}`;
}
function collection() {
  const watch=state.view==='favorites', items=watch?state.vault.items.filter(i=>i.watch):state.vault.items, stats=collectionStats(items);
  const brands=[...new Set(state.vault.items.map(i=>i.brand).filter(Boolean))].sort();
  return `<section class="collection-hero"><div class="hero-top"><div><span class="eyebrow">${watch?'La tua selezione personale':'Ogni paio, una storia'}</span><h1>${watch?'La tua watchlist':'La tua collezione'}<span class="accent-dot">.</span></h1><p>${watch?'I modelli che segui. Gli obiettivi che scegli.':'Il tuo archivio, curato nei dettagli.'}</p></div><div class="app-mark" aria-hidden="true"><svg viewBox="0 0 80 84"><path d="M40 4 74 24 40 44 6 24Z" fill="#d7f7a2"/><path d="m6 24 34 20v36L6 60Z" fill="#8ba96a"/><path d="m40 44 34-20v36L40 80Z" fill="#344c39"/><path d="m23 14 34 20v16" fill="none" stroke="#0b1118" stroke-width="3"/></svg></div></div><div class="hero-metrics"><div class="hero-metric"><span>Valore salvato</span><strong>${money(stats.value)}</strong><small>Quotazioni in archivio</small></div><div class="hero-metric"><span>La collezione</span><strong>${stats.pairs}<small> paia</small></strong><small>${items.length} modelli</small></div><div class="hero-metric"><span>${watch?'Con obiettivo':'Nella watchlist'}</span><strong>${watch?items.filter(i=>num(i.targetPrice)>0).length:stats.watchCount}</strong><small>${watch?'Prezzo scelto da te':'I tuoi preferiti'}</small></div></div></section><div class="toolbar"><label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Modello, SKU, taglia…" aria-label="Cerca nella collezione" value="${esc(state.query)}" autocomplete="off"></label><button class="icon-button" data-action="filters" aria-label="Apri filtri avanzati">${icon('filter')}</button></div><div class="filters" aria-label="Filtra per brand"><button class="filter-chip ${!state.brand?'active':''}" data-brand="" aria-pressed="${!state.brand}">Tutti</button>${brands.map(b=>`<button class="filter-chip ${state.brand===b?'active':''}" data-brand="${esc(b)}" aria-pressed="${state.brand===b}">${esc(b)}</button>`).join('')}</div><div class="collection-controls"><div class="view-switch" aria-label="Vista collezione"><button data-layout="gallery" class="${state.layout==='gallery'?'active':''}" aria-pressed="${state.layout==='gallery'}" aria-label="Vista galleria">${icon('grid')}</button><button data-layout="list" class="${state.layout==='list'?'active':''}" aria-pressed="${state.layout==='list'}" aria-label="Vista elenco">${icon('list')}</button></div><select id="sort" aria-label="Ordina la collezione">${[['original','Il mio ordine'],['value-desc','Valore più alto'],['value-asc','Valore più basso'],['gain-desc','Differenza sul costo'],['name','Nome A–Z'],['recent','Aggiunte recenti']].map(([v,l])=>`<option value="${v}" ${state.sort===v?'selected':''}>${l}</option>`).join('')}</select></div><label class="size-control" for="card-size"><span>Dimensione scarpe</span><input id="card-size" type="range" min="1" max="3" step="1" value="${state.cardSize}" ${state.layout==='list'?'disabled':''} aria-valuetext="${['Compatte','Medie','Grandi'][state.cardSize-1]}"><output id="card-size-label" for="card-size">${state.layout==='list'?'Elenco':['Compatte','Medie','Grandi'][state.cardSize-1]}</output></label><div id="collection-results" aria-live="polite">${collectionResults()}</div>`;
}

function chart(points, label) {
  const safe = points.filter(p => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.p))).sort((a,b)=>a.t-b.t);
  if (safe.length < 2) return '<p class="muted">Servono almeno due rilevazioni per mostrare l’andamento.</p>';
  let min=Infinity,max=-Infinity;for(const point of safe){min=Math.min(min,num(point.p));max=Math.max(max,num(point.p));}
  // Bound drawing work only: the archive and exported history keep every point.
  let plotted=safe;
  if(safe.length>400){plotted=[safe[0]];const step=Math.ceil((safe.length-2)/180);for(let n=1;n<safe.length-1;n+=step){let lo=safe[n],hi=safe[n];for(let j=n;j<Math.min(n+step,safe.length-1);j++){if(safe[j].p<lo.p)lo=safe[j];if(safe[j].p>hi.p)hi=safe[j];}plotted.push(...(lo.t<=hi.t?[lo,hi]:[hi,lo]));}plotted.push(safe.at(-1));}
  const start = num(safe[0].t), end = num(safe.at(-1).t);
  const coords = plotted.map(p => `${(12 + (num(p.t)-start)/(end-start||1)*496).toFixed(2)},${(max===min?87:150-(num(p.p)-min)/(max-min)*126).toFixed(2)}`).join(' ');
  return `<div class="chart"><svg viewBox="0 0 520 182" role="img" aria-label="${esc(label)}: da ${esc(money(safe[0].p))} a ${esc(money(safe.at(-1).p))}"><path d="M12 150H508 M12 87H508 M12 24H508" stroke="currentColor" opacity=".1"/><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="179" fill="currentColor" font-size="12">${esc(date(safe[0].t))}</text><text x="508" y="179" text-anchor="end" fill="currentColor" font-size="12">${esc(date(safe.at(-1).t))}</text></svg></div>`;
}
function portfolio() {
  const items=state.vault.items, stats=collectionStats(items), groups=brandBreakdown(items);
  const top=[...items].sort((a,b)=>num(b.current)*qty(b)-num(a.current)*qty(a)).slice(0,5);
  const observations=state.vault.snaps||[], last=observations.at(-1);
  const points=observations.filter(s=>state.chartRange==='all'||num(s.t)>=Date.now()-Number(state.chartRange)*86400000).map(s=>({t:s.t,p:s.value}));
  return head('La collezione, in prospettiva','Il tuo portfolio','Valore, composizione e dettagli da completare. Tutto dai tuoi dati.')+`<section class="panel portfolio-hero"><div class="section-head"><span class="eyebrow">Valore complessivo salvato</span><span class="badge accent">${stats.pairs} paia</span></div><div class="hero-value">${money(stats.value)}</div><div class="portfolio-delta"><span class="change ${stats.gain>=0?'up':'down'}">${stats.gain>=0?'+':''}${money(stats.gain)}</span><span class="muted">sui modelli con costo registrato</span></div><div class="chart-ranges" aria-label="Periodo del grafico">${[['30','1 mese'],['90','3 mesi'],['365','1 anno'],['all','Tutto']].map(([v,l])=>`<button class="filter-chip ${state.chartRange===v?'active':''}" data-range="${v}" aria-pressed="${state.chartRange===v}">${l}</button>`).join('')}</div>${chart(points,'Storico del valore della collezione')}<p>${last?'Ultima fotografia: '+date(last.t)+'.':'Non hai ancora salvato una fotografia.'} Il totale in alto include le modifiche attuali.</p><button class="button secondary" data-action="snapshot">${icon('plus')}Salva fotografia di oggi</button></section><div class="stats-grid"><div class="stat"><span>Spesa registrata</span><strong>${money(stats.spent)}</strong><small>${stats.costedCount} modelli con costo</small></div><div class="stat"><span>Differenza sul costo</span><strong>${stats.returnPct===null?'—':(stats.returnPct>=0?'+':'')+stats.returnPct.toFixed(1).replace('.',',')+'%'}</strong><small>Solo modelli con costo &gt; 0</small></div><div class="stat"><span>Valore medio / paio</span><strong>${stats.pairs?money(stats.value/stats.pairs):'—'}</strong><small>Valore salvato, non prezzo live</small></div><div class="stat"><span>Brand presenti</span><strong>${groups.length}</strong><small>${stats.count} modelli in archivio</small></div></div><section class="panel"><div class="section-head"><h2>Dentro la collezione</h2><span class="eyebrow">Per valore</span></div><div class="distribution">${groups.map(g=>`<div class="distribution-row"><div><span>${esc(g.brand)} <small>${g.pairs} paia</small></span><strong>${money(g.value)} <small>${Math.round(g.share*100)}%</small></strong></div><svg class="distribution-track" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${esc(g.brand)}, ${Math.round(g.share*100)} percento del valore"><rect width="100" height="4" rx="2"/><rect class="distribution-fill" width="${Math.max(0,Math.min(100,g.share*100))}" height="4" rx="2"/></svg></div>`).join('')||'<p class="muted">Aggiungi una sneaker per vedere la composizione.</p>'}</div></section><section class="panel"><div class="section-head"><h2>Il prossimo dettaglio</h2>${icon('target')}</div><p>Completa l’archivio per leggere meglio la tua collezione.</p><div class="insight-grid"><button class="insight-card" data-quick="missing-cost"><span>Costi mancanti</span><strong>${stats.missingCost}</strong><small>Completa la spesa ${icon('arrow')}</small></button><button class="insight-card" data-quick="missing-photo"><span>Foto mancanti</span><strong>${stats.missingPhotos}</strong><small>Completa le schede ${icon('arrow')}</small></button><button class="insight-card" data-quick="stale"><span>Prezzi da rivedere</span><strong>${queryItems(items,{quick:'stale'}).length}</strong><small>Assenti o oltre 30 giorni ${icon('arrow')}</small></button></div></section><section class="panel"><div class="section-head"><h2>I pezzi di maggior valore</h2><span class="eyebrow">Top ${top.length}</span></div>${top.map(i=>`<button class="recent-row" data-detail="${esc(i.id)}"><span class="shoe-photo">${photo(i)}</span><div><strong>${esc(title(i))}</strong><small>EU ${esc(i.size)} · ${qty(i)} ${qty(i)===1?'paio':'paia'}</small></div><strong>${money(num(i.current)*qty(i))}</strong></button>`).join('')||'<p>La tua collezione è ancora vuota.</p>'}</section><div class="notice">I valori sono quelli salvati, non quotazioni in tempo reale. Apri StockX da ogni scheda per consultare il mercato.</div>`;
}
function setting(action, symbol, label, help) { return `<button class="setting-row" data-action="${action}">${icon(symbol)}<div><strong>${label}</strong><small>${help}</small></div>${icon('arrow')}</button>`; }
function settings() {
  const stats=collectionStats(state.vault.items);
  return head('Il tuo spazio personale','Il mio vault','Collezione, backup e preferenze. Ogni modifica resta sotto il tuo controllo.')+`<section class="panel health-summary"><div class="section-head"><span class="eyebrow">Archivio sul dispositivo</span><span class="badge accent">${icon('check')}Salvataggio locale</span></div><h2>${stats.count} modelli. Tutti i tuoi dettagli.</h2><p>${state.vault.items.filter(i=>i.image).length} foto · ${(state.vault.snaps||[]).length} fotografie del portfolio · ${state.backupAt?'Ultimo backup preparato: '+date(state.backupAt):'Prepara un backup per conservare una copia anche in File.'}</p><button class="button primary" data-action="backup">${icon('download')}Esporta backup completo</button></section><section class="settings-group"><h2>Collezione e trasferimenti</h2><div class="settings-list">${setting('import','upload','Importa un backup','Controlla l’anteprima prima di sostituire la copia locale')}${setting('csv','download','Esporta tabella CSV','Modelli, quantità, valori e obiettivi per Numbers o Excel')}${setting('previous','back','Recupera versione precedente','Scarica la copia prima dell’ultima modifica salvata')}</div></section><section class="settings-group"><h2>La tua app</h2><div class="settings-list">${setting('install','plus','Installa su iPhone','Un’icona sulla Home, accesso diretto alla collezione')}${setting('check-update','refresh','Controlla aggiornamenti','Versione 2.0 · il tuo archivio resta conservato')}${setting('persistent','check','Proteggi lo spazio dei dati','Chiedi al browser di conservare l’archivio locale')}${state.accessKey?setting('copy-key','copy','Copia codice di accesso','Per aprire la copia iniziale su un altro dispositivo'):''}</div></section><div class="notice"><strong>PC e iPhone hanno archivi separati.</strong><br>Per trasferire modifiche, esporta il backup JSON e importalo sull’altro dispositivo. Il codice privato apre la copia iniziale; non sincronizza gli aggiornamenti.</div><section class="panel"><h2>Leggera, anche offline</h2><p>Interfaccia e archivio funzionano senza rete dopo il primo caricamento completo. Le immagini esterne richiedono internet se non sono già disponibili. Le foto che scegli dal telefono restano nel backup, nella qualità originale.</p><p>Conserva il JSON in File: eliminare i dati del sito o rimuovere l’app può cancellare l’archivio locale.</p></section><p class="muted version">Sneaker Vault · 2.0.0<br>Nessun tracciamento. Nessuna ricerca prezzi in background.</p>`;
}

function render() {
  if (!state.vault) return;
  $('#shell').hidden = false; $('#gate').hidden = true;
  nav();
  $('#page').innerHTML = state.view === 'portfolio' ? portfolio() : state.view === 'settings' ? settings() : collection();
  updateCompare();updateNotice();
}
function modal(heading, body, footer = '') {
  dialog.className='dialog';state.editorDirty=false;
  dialog.innerHTML = `<header class="dialog-header"><h2 id="dialog-title">${heading}</h2><button class="icon-button" data-action="close" aria-label="Chiudi">${icon('close')}</button></header><div class="dialog-body">${body}</div>${footer ? `<footer class="dialog-footer">${footer}</footer>` : ''}`;
  if (!dialog.open) dialog.showModal();
  $('.dialog-body', dialog).scrollTop = 0;
}
function close() { if (state.busy) return; dialog.close(); state.pendingImport = null; state.editorDirty=false;importToken++; }
function detail(id) {
  const i = itemById(id); if (!i) return;
  state.currentDetail=String(id);
  const obs = currentObservation(i);
  modal('La tua sneaker', `<button class="detail-photo" data-photo="${esc(i.id)}" aria-label="Apri la foto a schermo intero">${photo(i,false)}<span class="photo-hint">${icon('zoom')}Esplora la foto</span></button><h1 class="detail-title"><span class="eyebrow">${esc(i.brand)}</span>${esc(i.model)}<small>${esc(i.colorway || '')}</small></h1><div class="hero-value">${money(i.current)} <small>/ paio</small></div><p class="muted">${obs.label}${obs.at ? ' · '+date(obs.at) : ''}${obs.label === 'Quotazione salvata' && i.market?.basis ? ' · '+esc(i.market.basis) : ''}</p><div class="detail-grid">${[['Taglia EU',i.size],['Quantità',qty(i)],['Condizione',i.condition],['Pagato / paio',money(i.paid)],['Retail / paio',money(i.retail)],['SKU',i.sku || '—'],['Categoria',i.category || '—'],['Data uscita',i.release ? date(i.release) : '—'],['Aggiunta il',i.added ? date(i.added) : '—']].map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div>${targetBadge(i)}<div class="detail-actions"><button class="button secondary" data-share="${esc(i.id)}">${icon('share')}Condividi scheda</button><button class="button secondary" data-edit="${esc(i.id)}">${icon('target')}Obiettivo di prezzo</button></div><section class="panel"><h3>Storico conservato</h3>${chart(Array.isArray(i.hist)?i.hist:[], 'Storico dei valori salvati')}<p>Rilevazioni presenti nel tuo archivio originale, incluse eventuali stime passate.</p></section>${i.notes ? `<section class="panel"><h3>Note</h3><p class="notes">${esc(i.notes)}</p></section>` : ''}<div class="notice">Consulta il prezzo attuale su StockX. Le quotazioni qui non si aggiornano automaticamente.</div>`, `<button class="button secondary" data-edit="${esc(i.id)}">Modifica</button><a class="button primary" href="${esc(stockx(i))}" target="_blank" rel="noopener noreferrer">StockX ${icon('arrow')}</a>`);
}
function input(name, label, value, type='text', attrs='') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
}
function edit(id) {
  const i = id != null ? itemById(id) : {brand:'',model:'',qty:1,size:'',condition:'Deadstock'};
  if (!i) return;
  state.editingId = id ?? null;
  state.editSnapshot = state.vault;
  modal(id ? 'Modifica sneaker' : 'Aggiungi sneaker', `<form id="shoe-form" class="form-grid">${input('brand','Brand',i.brand,'text','required maxlength="120"')}${input('model','Modello',i.model,'text','required maxlength="240"')}${input('colorway','Colorway',i.colorway,'text','maxlength="500"')}${input('sku','SKU',i.sku,'text','maxlength="120"')}${input('size','Taglia EU',i.size,'number','required min="1" max="80" step="0.5" inputmode="decimal"')}${input('qty','Quantità',i.qty,'number','required min="1" max="9999" step="1" inputmode="numeric"')}${input('condition','Condizione',i.condition,'text','list="conditions" maxlength="120"')}<datalist id="conditions"><option>Deadstock</option><option>VNDS</option><option>Usata</option></datalist>${input('category','Categoria',i.category,'text','maxlength="120"')}${input('paid','Pagato per paio (€)',i.paid ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('retail','Retail per paio (€)',i.retail ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('current','Valore per paio (€)',i.current ?? 0,'number','min="0" step="0.01" inputmode="decimal" required')}${input('targetPrice','Obiettivo di prezzo (€)',i.targetPrice??'','number','min="0" step="0.01" inputmode="decimal" placeholder="Facoltativo"')}${input('release','Data uscita',(i.release || '').slice(0,10), 'date')}<label class="field full"><span>Note</span><textarea name="notes" maxlength="20000">${esc(i.notes || '')}</textarea></label><label class="field full"><span>Link immagine (HTTPS)</span><input name="image" value="${esc(i.image || '')}" type="text" autocomplete="off"><small>La foto attuale resta invariata finché non cambi questo campo.</small></label><label class="field full"><span>Oppure scegli una foto dal telefono</span><input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"><small>Viene conservato il file originale, senza compressione. Massimo 12 MB per foto.</small></label><p id="form-error" class="notice error full" role="alert" hidden></p></form>`, `<button class="button secondary" data-action="close">Annulla</button><button class="button primary" type="submit" form="shoe-form">Salva sneaker</button>`);
  state.editValues = Object.fromEntries(new FormData($('#shoe-form')));
}
function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('button').forEach(b => { b.disabled = busy; });
}
async function commit(next, expected = state.vault, alreadyBusy=false) {
  if (state.busy&&!alreadyBusy) return false;
  setBusy(true);
  try { await saveVault(next, {expected}); state.vault = next; syncChannel?.postMessage({type:'vault-saved'}); return true; }
  catch (e) {
    if (e.code === 'VAULT_CONFLICT') {state.vault=await loadVault();render();throw new Error('La collezione è cambiata in un’altra scheda. Chiudi e riapri la scheda della sneaker prima di modificare.');}
    throw e;
  }
  finally { setBusy(false); }
}
async function saveShoe(form) {
  if (state.busy || !form.reportValidity()) return;
  $('#form-error').hidden = true;
  setBusy(true);
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
    if(f.get('targetPrice')!==state.editValues.targetPrice){const value=f.get('targetPrice');record.targetPrice=value===''?null:Number(value);if(value!==''&&(!Number.isFinite(record.targetPrice)||record.targetPrice<0))throw new Error('Inserisci un obiettivo di prezzo valido.');}
    if (!old || img !== old.image) record.image = img || null;
    if (!old || num(old.current) !== record.current) record.hist = [...(old?.hist || []), {t:Date.now(),p:record.current,src:'manual'}];
    const next = {...state.vault, items:old ? state.vault.items.map(i=>i.id===old.id?record:i) : [record,...state.vault.items]};
    if (await commit(next, state.editSnapshot,true)) { state.editorDirty=false;dialog.close(); render(); detail(record.id); toast('Sneaker salvata su questo dispositivo.'); }
  } catch (e) { if ($('#form-error')) { $('#form-error').textContent=e.message || 'Salvataggio non riuscito. I dati precedenti sono conservati.'; $('#form-error').hidden=false; $('#form-error').scrollIntoView({block:'nearest'}); } else failure(e); }
  finally{setBusy(false);}
}
async function watch(id) {
  const i = itemById(id); if (!i || state.busy) return;
  const next = {...state.vault,items:state.vault.items.map(v=>v.id===i.id?{...v,watch:!v.watch}:v)};
  if (await commit(next)) { const y=scrollY;render();window.scrollTo(0,y);toast(i.watch ? 'Rimossa dalla watchlist.' : 'Aggiunta alla watchlist.'); }
}
function resetFilters() {
  Object.assign(state,{query:'',brand:'',condition:'',size:'',minPrice:'',maxPrice:'',quick:'all',limit:24});
}
function preferences() {
  clearTimeout(preferenceTimer);
  preferenceTimer=setTimeout(()=>setSettings({mobileV2:{layout:state.layout,cardSize:state.cardSize,sort:state.sort}}).catch(()=>toast('Preferenza applicata. Non è stato possibile memorizzarla.',true)),250);
}
function resizeCards(value) {
  state.cardSize=Math.min(3,Math.max(1,Number(value)||3));
  const names=['Compatte','Medie','Grandi'], classes=['compact','medium','large'];
  const grid=$('.shoe-grid');
  if(grid)grid.className=`shoe-grid size-${classes[state.cardSize-1]} ${state.layout==='list'?'is-list':''}`;
  const output=$('#card-size-label');if(output)output.textContent=names[state.cardSize-1];
  const range=$('#card-size');if(range)range.setAttribute('aria-valuetext',names[state.cardSize-1]);
  preferences();
}
function filterSheet() {
  const options=(field,first)=>`<option value="">${first}</option>`+[...new Set(state.vault.items.map(i=>String(i[field]??'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'it',{numeric:true})).map(v=>`<option value="${esc(v)}" ${String(state[field])===v?'selected':''}>${esc(v)}</option>`).join('');
  modal('Trova il paio giusto',`<p>Combina i filtri. I prezzi indicati sono per singolo paio.</p><form id="filter-form" class="filter-grid"><label class="field"><span>Brand</span><select name="brand">${options('brand','Tutti i brand')}</select></label><label class="field"><span>Condizione</span><select name="condition">${options('condition','Tutte le condizioni')}</select></label><label class="field"><span>Taglia EU</span><select name="size">${options('size','Tutte le taglie')}</select></label><label class="field"><span>Da controllare</span><select name="quick">${[['all','Tutto l’archivio'],['missing-cost','Costo d’acquisto mancante'],['missing-photo','Foto mancante'],['stale','Prezzi assenti o oltre 30 giorni']].map(([v,l])=>`<option value="${v}" ${state.quick===v?'selected':''}>${l}</option>`).join('')}</select></label><div class="range-pair">${input('minPrice','Prezzo minimo (€)',state.minPrice,'number','min="0" step="0.01" inputmode="decimal"')}${input('maxPrice','Prezzo massimo (€)',state.maxPrice,'number','min="0" step="0.01" inputmode="decimal"')}</div><p id="filter-error" class="notice error" hidden role="alert"></p></form>`,`<button class="button secondary" data-action="clear-filter-sheet">Azzera</button><button class="button primary" form="filter-form" type="submit">Mostra risultati</button>`);
}
function applyFilters(form) {
  const f=new FormData(form), min=f.get('minPrice'),max=f.get('maxPrice');
  if(min!==''&&max!==''&&Number(min)>Number(max)){$('#filter-error').textContent='Il prezzo massimo deve essere almeno uguale al minimo.';$('#filter-error').hidden=false;return;}
  for(const key of ['brand','condition','size','quick','minPrice','maxPrice'])state[key]=String(f.get(key)||'');
  state.limit=24;dialog.close();render();
}
function updateCompare() {
  state.compare=state.compare.filter(id=>itemById(id));
  const tray=$('#compare-tray');tray.hidden=!state.compare.length||!state.vault;
  tray.innerHTML=state.compare.length?`<div><strong>${state.compare.length} / 3 sneaker</strong><small>La tua selezione per il confronto</small></div><button class="button primary" data-action="compare-open">Confronta ${icon('compare')}</button><button class="icon-button" data-action="compare-clear" aria-label="Svuota confronto">${icon('close')}</button>`:'';
  document.body.classList.toggle('has-compare',Boolean(state.compare.length));
  document.querySelectorAll('[data-compare]').forEach(el=>{const selected=state.compare.includes(el.dataset.compare);el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));el.innerHTML=icon(selected?'check':'compare');el.closest('.shoe-card')?.classList.toggle('is-selected',selected);});
}
function toggleCompare(id) {
  id=String(id);
  if(state.compare.includes(id))state.compare=state.compare.filter(v=>v!==id);
  else if(state.compare.length<3)state.compare.push(id);
  else {toast('Confronta fino a 3 sneaker. Rimuovine una per aggiungerne un’altra.');return;}
  updateCompare();
}
function compareOpen() {
  const items=state.compare.map(itemById).filter(Boolean);
  if(items.length<2){toast('Seleziona almeno 2 sneaker con l’icona di confronto sulla foto.');return;}
  const rows=[['Valore / paio',i=>money(i.current)],['Pagato / paio',i=>num(i.paid)>0?money(i.paid):'Non registrato'],['Differenza / paio',i=>num(i.paid)>0?(num(i.current)-num(i.paid)>=0?'+':'')+money(num(i.current)-num(i.paid)):'—'],['Obiettivo',i=>num(i.targetPrice)>0?money(i.targetPrice):'Non impostato'],['Taglia EU',i=>i.size],['Condizione',i=>i.condition||'—'],['Quantità',qty],['Valore totale',i=>money(num(i.current)*qty(i))],['Ultima quotazione',i=>i.market?.at?date(i.market.at):'Non disponibile'],['SKU',i=>i.sku||'—']];
  modal('Le tue sneaker a confronto',`<p>Valori salvati in archivio. Scorri la tabella per confrontare ogni dettaglio.</p><div class="compare-scroll"><table class="compare-table"><thead><tr><th scope="col">Dettaglio</th>${items.map(i=>`<th scope="col"><div class="compare-photo">${photo(i)}</div><button data-detail="${esc(i.id)}">${esc(title(i))}</button></th>`).join('')}</tr></thead><tbody>${rows.map(([label,value])=>`<tr><th scope="row">${label}</th>${items.map(i=>`<td>${esc(value(i))}</td>`).join('')}</tr>`).join('')}<tr><th scope="row">Mercato</th>${items.map(i=>`<td><a href="${esc(stockx(i))}" target="_blank" rel="noopener noreferrer">StockX ↗</a></td>`).join('')}</tr></tbody></table></div>`,'<button class="button primary" data-action="close">Torna alla collezione</button>');
}
function openPhoto(id) {
  const item=itemById(id);if(!item)return;
  state.currentDetail=String(id);
  modal('La foto, nei dettagli',`<div class="photo-stage">${photo(item,false)}</div><p class="photo-caption">${esc(title(item))}</p><p class="muted">Ingrandisci e scorri la foto per vedere i dettagli. Il file originale resta invariato.</p>`,`<button class="button secondary" data-action="detail-back">Scheda</button><button class="button primary" data-action="photo-zoom" aria-pressed="false">${icon('zoom')}Ingrandisci</button>`);
  dialog.classList.add('photo-viewer');
}
function photoZoom() {
  const stage=$('.photo-stage');if(!stage)return;
  const zoomed=stage.classList.toggle('photo-zoomed'),button=$('[data-action="photo-zoom"]');
  button.setAttribute('aria-pressed',String(zoomed));button.innerHTML=icon('zoom')+(zoomed?'Adatta allo schermo':'Ingrandisci');
  stage.scrollTo(0,0);
}
async function shareShoe(id) {
  const i=itemById(id);if(!i)return;
  const text=`${title(i)}\n${i.colorway||''}\nTaglia EU ${i.size} · ${i.condition||''}\nValore salvato: ${money(i.current)} / paio\n${i.sku?'SKU: '+i.sku+'\n':''}${stockx(i)}`;
  if(navigator.share){try{await navigator.share({title:title(i),text});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(text);toast('Scheda copiata. Puoi incollarla dove vuoi.');}
  catch{modal('Scheda da copiare',`<label class="field"><span>Solo i dettagli della sneaker, senza il codice privato</span><textarea readonly id="share-text">${esc(text)}</textarea></label>`,'<button class="button primary" data-action="close">Chiudi</button>');$('#share-text').select();}
}
function snapshotPreview() {
  const stats=collectionStats(state.vault.items);
  modal('Una fotografia del portfolio',`<span class="eyebrow">${date(Date.now())}</span><div class="hero-value">${money(stats.value)}</div><p>${stats.pairs} paia · ${stats.count} modelli. Salva il totale attuale nello storico per confrontarlo nel tempo.</p><div class="notice">La fotografia usa i valori già presenti. Non aggiorna le quotazioni e non modifica le rilevazioni precedenti.</div>`,'<button class="button secondary" data-action="close">Annulla</button><button class="button primary" data-action="confirm-snapshot">Salva fotografia</button>');
}
async function saveSnapshot() {
  const stats=collectionStats(state.vault.items),next={...state.vault,snaps:[...(state.vault.snaps||[]),{t:Date.now(),value:stats.value,spent:stats.spent,label:'Fotografia da iPhone',src:'manual'}]};
  if(await commit(next)){dialog.close();render();toast('Fotografia del portfolio salvata nello storico.');}
}
function updateNotice() {
  const banner=$('#update-banner');
  const waiting=registration?.waiting;
  banner.hidden=!waiting&&!state.externalChange;
  if(waiting)banner.innerHTML=`<div><strong>Un aggiornamento è pronto</strong><small>Applica la nuova versione mantenendo il tuo archivio.</small></div><button class="button primary" data-action="apply-update">Aggiorna</button>`;
  else if(state.externalChange)banner.innerHTML=`<div><strong>Archivio aggiornato in un’altra scheda</strong><small>Le modifiche in corso restano nella scheda aperta.</small></div><button class="button secondary" data-action="refresh-vault">Rileggi archivio</button>`;
}
async function refreshVault() {
  if(state.busy||dialog.open){toast('Chiudi prima la scheda aperta. Le modifiche in corso non verranno ricaricate.');return;}
  const current=await loadVault();if(current){state.vault=current;state.externalChange=false;render();updateNotice();}
}
async function checkUpdate(explicit=false) {
  if(!registration){if(explicit)toast('La modalità offline si sta preparando. Riprova tra poco.');return;}
  if(!navigator.onLine){if(explicit)toast('Sei offline. La collezione è disponibile; controlla gli aggiornamenti quando torni online.');return;}
  lastUpdateCheck=Date.now();
  try{await registration.update();updateNotice();if(explicit&&!registration.waiting&&!registration.installing)toast('Stai usando la versione più recente disponibile.');}
  catch{if(explicit)toast('Controllo non riuscito. La versione attuale e i dati restano disponibili.',true);}
}
function applyUpdate() {
  if(state.busy||dialog.open){toast('Salva o chiudi la scheda aperta prima di aggiornare.');return;}
  if(!registration?.waiting)return;
  updateRequested=true;
  registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
}
async function registerOffline() {
  if(!('serviceWorker' in navigator))return;
  try{
    registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    updateNotice();
    registration.addEventListener('updatefound',()=>{
      const next=registration.installing;if(!next)return;
      next.addEventListener('statechange',()=>{if(next.state==='installed')updateNotice();});
    });
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested){updateRequested=false;location.reload();}});
  }catch{toast('La modalità offline non è ancora pronta. Riapri l’app con una connessione disponibile.');}
}
function requestClose() {
  if(state.busy)return;
  if(state.editorDirty&&$('#shoe-form')){
    if(!$('#discard-prompt'))$('.dialog-body').insertAdjacentHTML('beforeend','<div id="discard-prompt" class="notice error" role="alert"><strong>Hai modifiche non salvate.</strong><p>Puoi continuare a modificare oppure scartare questa bozza.</p><button class="button danger" data-action="discard-edit">Scarta modifiche</button></div>');
    $('#discard-prompt').scrollIntoView({block:'nearest'});return;
  }
  close();
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
  if(!suffix){state.backupAt=Date.now();setSettings({backupAt:state.backupAt}).catch(()=>{});if(state.view==='settings')render();}
  toast('Backup preparato. Conservalo nell’app File.');
}
function exportCsv() {
  const cell = value => { let s=String(value??''); if (/^[=+@\-\t\r]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; };
  const lines = [['Brand','Modello','Colorway','SKU','Taglia EU','Quantità','Condizione','Categoria','Pagato per paio EUR','Valore per paio EUR','Valore totale EUR','Obiettivo di prezzo EUR','Note','Immagine','StockX'], ...state.vault.items.map(i=>[i.brand,i.model,i.colorway,i.sku,i.size,qty(i),i.condition,i.category,i.paid,i.current,num(i.current)*qty(i),i.targetPrice??'',i.notes,i.image,stockx(i)])];
  download('\uFEFF'+lines.map(row=>row.map(cell).join(';')).join('\r\n'),'sneaker-vault.csv','text/csv;charset=utf-8');
}
async function importFile(file) {
  if (!file || state.busy) return;
  const token=++importToken;
  if(file.size>1024*1024)toast('Lettura del backup in corso…');
  let incoming;
  try { incoming = await readArchiveFile(file); } catch(e) {if(token!==importToken)return;throw new Error('Backup non valido: '+(e.message||'il file deve essere un archivio Sneaker Vault JSON.')); }
  if(token!==importToken)return;
  state.pendingImport = incoming; importSource=file.name;
  const stats = total(incoming.items);
  modal('Controlla il backup', `<span class="eyebrow">${esc(file.name)}</span><h1 class="detail-title">${incoming.items.length} modelli.<br>Pronti da importare.</h1><div class="detail-grid"><div><small>Paia</small><strong>${stats.pairs}</strong></div><div><small>Immagini</small><strong>${incoming.items.filter(i=>i.image).length}</strong></div><div><small>Valore salvato</small><strong>${money(stats.value)}</strong></div></div><div class="notice">${state.readError ? 'Confermando, recuperi la collezione da questo backup. La copia illeggibile viene conservata separatamente e la versione precedente resta intatta.' : state.vault ? 'Confermando, sostituisci la collezione su questo dispositivo. Una copia precedente rimane recuperabile da “Il mio vault” fino alla modifica successiva. Esporta prima un backup per conservarla nel tempo.' : 'La collezione verrà salvata su questo dispositivo.'}<br>Il PC e i file originali restano invariati.</div>`, `${state.vault ? '<button class="button secondary" data-action="backup">Backup attuale</button>' : '<button class="button secondary" data-action="close">Annulla</button>'}<button class="button primary" data-action="confirm-import">Conferma importazione</button>`);
}
async function confirmImport() {
  const next = state.pendingImport; if (!next) return;
  let saved=false;
  if (state.readError) {setBusy(true);try{await recoverVault(next);state.vault=next;state.readError=false;saved=true;}finally{setBusy(false);}}
  else saved=await commit(next);
  if (saved) { dialog.close(); state.pendingImport=null;resetFilters();state.compare=[];render();toast(`Importati ${next.items.length} modelli da ${importSource}.`); }
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
  if (name === 'close') return requestClose();
  if (name === 'home') {state.view='collection';resetFilters();render();window.scrollTo(0,0);return;}
  if (name === 'filters') return filterSheet();
  if (name === 'reset-filters') {resetFilters();render();return;}
  if (name === 'clear-filter-sheet') {resetFilters();return filterSheet();}
  if (name === 'compare-open') return compareOpen();
  if (name === 'compare-clear') {state.compare=[];updateCompare();return;}
  if (name === 'detail-back') return detail(state.currentDetail);
  if (name === 'photo-zoom') return photoZoom();
  if (name === 'snapshot') return snapshotPreview();
  if (name === 'confirm-snapshot') return saveSnapshot();
  if (name === 'check-update') return checkUpdate(true);
  if (name === 'apply-update') return applyUpdate();
  if (name === 'refresh-vault') return refreshVault();
  if (name === 'discard-edit') {state.editorDirty=false;return close();}
  if (name === 'add') return edit();
  if (name === 'more') {state.limit+=24; $('#collection-results').innerHTML=collectionResults();updateCompare();return;}
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
  if (d.view) {state.view=d.view;resetFilters();render();window.scrollTo(0,0);$('#page').focus({preventScroll:true});return;}
  if (d.layout && ['gallery','list'].includes(d.layout)) {state.layout=d.layout;render();preferences();return;}
  if (d.range) {state.chartRange=d.range;render();return;}
  if (d.quick) {state.view='collection';resetFilters();state.quick=d.quick;render();window.scrollTo(0,0);return;}
  if ('brand' in d) {state.brand=d.brand;state.limit=24;render();return;}
  if (d.compare) return toggleCompare(d.compare);
  if (d.photo) return openPhoto(d.photo);
  if (d.share) {shareShoe(d.share).catch(e=>failure(e));return;}
  if (d.detail) return detail(d.detail);
  if (d.edit) return edit(d.edit);
  if (d.watch) {watch(d.watch).catch(e=>failure(e));return;}
  if (d.action) {e.preventDefault();action(d.action).catch(e=>failure(e));}
});
document.addEventListener('input',e=>{
  if (e.target.closest('#shoe-form')) state.editorDirty=true;
  if (e.target.id==='card-size') {resizeCards(e.target.value);return;}
  if (e.target.id!=='search') return;
  state.query=e.target.value;state.limit=24;
  clearTimeout(searchTimer); searchTimer=setTimeout(()=>{const root=$('#collection-results');if(root){root.innerHTML=collectionResults();updateCompare();}},100);
});
document.addEventListener('change',e=>{
  if(e.target.closest('#shoe-form'))state.editorDirty=true;
  if(e.target.id==='sort'){state.sort=e.target.value;$('#collection-results').innerHTML=collectionResults();updateCompare();preferences();}
  if(e.target.id==='import-file')importFile(e.target.files[0]).catch(e=>failure(e));
});
document.addEventListener('submit',e=>{
  if(e.target.id==='filter-form'){e.preventDefault();applyFilters(e.target);}
  if(e.target.id==='unlock-form'){e.preventDefault();unlock(new FormData(e.target).get('key'));}
  if(e.target.id==='shoe-form'){e.preventDefault();saveShoe(e.target);}
});
document.addEventListener('error', e => {
  if (e.target.tagName !== 'IMG') return;
  const img=e.target; const parent=img.parentElement;
  if (parent && !parent.querySelector('.photo-missing')) {const fallback=document.createElement('span');fallback.className='photo-missing';fallback.innerHTML=icon('shoe')+'<span>Foto non disponibile offline</span>';parent.append(fallback);}
  img.hidden=true;
},true);
dialog.addEventListener('cancel',e=>{e.preventDefault();if(!state.busy)requestClose();});
window.addEventListener('beforeunload',e=>{if(state.editorDirty){e.preventDefault();e.returnValue='';}});
if(syncChannel)syncChannel.onmessage=e=>{if(e.data?.type==='vault-saved'){state.externalChange=true;updateNotice();if(!state.busy&&!dialog.open)refreshVault().catch(()=>{});}};
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  if(state.externalChange&&!state.busy&&!dialog.open)refreshVault().catch(()=>{});
  if(Date.now()-lastUpdateCheck>60000)checkUpdate().catch(()=>{});
});
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
    try {
      const settings=await getSettings(),prefs=settings.mobileV2||{};
      state.accessKey=settings.accessKey||null;state.backupAt=settings.backupAt||null;
      if(['gallery','list'].includes(prefs.layout))state.layout=prefs.layout;
      if([1,2,3].includes(prefs.cardSize))state.cardSize=prefs.cardSize;
      if(['original','value-desc','value-asc','gain-desc','name','recent'].includes(prefs.sort))state.sort=prefs.sort;
    } catch {}
    state.vault = await loadVault();
    if (state.vault) {
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
  await registerOffline();
}
start();
