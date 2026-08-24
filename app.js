import { loadNostrLib } from './js/nostr-lib.js';
import {
  loadIdentity,
  saveIdentity,
  clearIdentity,
  createIdentity,
  importIdentity,
  extensionIdentity,
  toNpub,
  toNsec,
  fromNpub,
} from './js/keys.js';
import { uploadBlob } from './js/blossom.js';
import { publishBlogState, fetchBlogState, subscribeBlogState, signWithIdentity, fetchLatestUserVote, subscribeUserVote } from './js/nostr.js';
import { initRadar, UNIVERSES } from './js/radar.js';
import { nativeDialog, openDlg, closeDlg } from './js/compat.js';

const LEGACY_CACHE_KEY = 'bento_blog_cache_v2';
const LAST_PUB_KEY = 'bento_last_pub';

function cacheKeyFor(pub) {
  return 'bento_state_' + String(pub || '').slice(0, 16);
}

function loadCacheFor(pub) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(pub));
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(LEGACY_CACHE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed && parsed._pub === pub) return parsed;
    }
  } catch (err) {}
  return null;
}

function persistCache() {
  if (!state._pub) return;
  try {
    localStorage.setItem(cacheKeyFor(state._pub), JSON.stringify(state));
    localStorage.setItem(LAST_PUB_KEY, state._pub);
  } catch (err) {}
}

const COLORS = ['#7c5cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

const EMOJIS = ['🐱','🦊','🐼','🐸','🦉','🐺','🦁','🐯','🐨','🐵','🦄','🐙','🌸','🌙','⚡','🔥','💫','🎧','🎮','📚','☕','🪴','🧠','🚀'];

const SIZES = ['sm', 'wide', 'tall', 'big'];
const SIZE_ICONS = { sm: '▫️', wide: '▬', tall: '▮', big: '◼' };

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
}

function defaultState() {
  return {
    username: 'tu_nombre',
    avatar: '',
    avatarUrl: '',
    cards: [],
  };
}

function demoState() {
  return {
    ...defaultState(),
    cards: [
      { id: uid(), type: 'thought', text: '¡Hola! Este es tu blog descentralizado.\n\nPulsa ✏️ Editar y personaliza todo. Se publica firmado en Nostr y las imágenes suben a Blossom.', size: 'big', color: COLORS[0] },
      { id: uid(), type: 'image', img: 'https://picsum.photos/seed/bento1/600/400', caption: 'Una imagen cualquiera…', size: 'wide' },
      { id: uid(), type: 'thought', text: 'Las cajas pueden ser pequeñas…', size: 'sm', color: COLORS[2] },
      { id: uid(), type: 'thought', text: '…grandes…', size: 'big', color: COLORS[4] },
      { id: uid(), type: 'image', img: 'https://picsum.photos/seed/bento2/400/600', caption: '', size: 'tall' },
      { id: uid(), type: 'thought', text: '…o anchas. ¡Bórralas y crea las tuyas!', size: 'wide', color: COLORS[1] },
    ],
  };
}

let state = demoState();

const $ = (sel) => document.querySelector(sel);
const usernameEl = $('#username');
const avatarBtn = $('#avatarBtn');
const bento = $('#bento');
const addCardBtn = $('#addCardBtn');
const cardDialog = $('#cardDialog');
const avatarDialog = $('#avatarDialog');
const loginDialog = $('#loginDialog');
const keyGuardDialog = $('#keyGuardDialog');
const accountDialog = $('#accountDialog');
const syncStatusEl = $('#syncStatus');
const syncTextEl = $('#syncText');

let identity = null;
let viewerKey = null;

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 3400);
}

function setSyncStatus(mode) {
  syncStatusEl.dataset.mode = mode;
  const labels = { ok: 'Sincronizado', syncing: 'Publicando…', err: 'Sin conexión a relays', idle: '' };
  syncTextEl.textContent = labels[mode] ?? '';
}

function applyIdentity() {
  usernameEl.textContent = state.username;
  document.title = `${state.username} · blog`;
  if (state.avatarUrl) {
    avatarBtn.textContent = '';
    avatarBtn.style.backgroundImage = `url("${state.avatarUrl}")`;
  } else {
    avatarBtn.style.backgroundImage = '';
    avatarBtn.textContent = state.avatar || '🙂';
  }
}

function renderCards() {
  bento.querySelectorAll('.card:not(#radarCard)').forEach((el) => el.remove());
  for (const card of state.cards) {
    bento.insertBefore(buildCard(card), addCardBtn);
  }
}

function renderAll() {
  applyIdentity();
  renderCards();
}

function buildCard(card) {
  const el = document.createElement('article');
  el.className = 'card ' + card.type;
  el.dataset.size = card.size || 'sm';
  el.dataset.id = card.id;
  if (card.color) {
    el.style.setProperty('--card-color', card.color);
    el.classList.add('tinted-text');
  }

  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.appendChild(iconBtn(SIZE_ICONS[card.size] || '▫️', 'Cambiar tamaño', () => cycleSize(card)));
  controls.appendChild(iconBtn('✏️', 'Editar', () => openCardDialog(card)));
  controls.appendChild(iconBtn('🗑️', 'Eliminar', () => removeCard(card.id)));
  el.appendChild(controls);

  if (card.type === 'thought') {
    const p = document.createElement('p');
    p.className = 'thought-text';
    p.textContent = card.text || '';
    el.appendChild(p);
  } else {
    if (card.img) {
      const img = document.createElement('img');
      img.src = card.img;
      img.alt = card.caption || 'imagen del blog';
      img.loading = 'lazy';
      el.appendChild(img);
    }
    if (card.caption) {
      const cap = document.createElement('div');
      cap.className = 'caption';
      cap.textContent = card.caption;
      el.appendChild(cap);
    }
  }
  return el;
}

function iconBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function cycleSize(card) {
  const i = SIZES.indexOf(card.size || 'sm');
  card.size = SIZES[(i + 1) % SIZES.length];
  commit();
  renderCards();
}

function removeCard(id) {
  const el = bento.querySelector(`.card[data-id="${id}"]`);
  const doRemove = () => {
    state.cards = state.cards.filter((c) => c.id !== id);
    commit();
    renderCards();
    toast('🗑️ Caja eliminada');
  };
  if (el) {
    el.classList.add('removing');
    setTimeout(doRemove, 170);
  } else {
    doRemove();
  }
}

function commit() {
  if (identity && identity.name !== state.username) {
    identity.name = state.username;
    saveIdentity(identity);
  }
  persistCache();
  schedulePublish();
}

let publishTimer = null;
let lastPublishAt = 0;
let publishedJson = '';

function schedulePublish() {
  if (!identity || viewerKey) return;
  clearTimeout(publishTimer);
  setSyncStatus('syncing');
  publishTimer = setTimeout(doPublish, 900);
}

async function doPublish() {
  try {
    const okCount = await publishBlogState(identity, state);
    if (okCount > 0) {
      lastPublishAt = Date.now();
      publishedJson = JSON.stringify({ ...state, _pub: undefined });
      setSyncStatus('ok');
    } else {
      setSyncStatus('err');
      toast('No se pudo publicar en ningún relay. Tus cambios quedan guardados aquí.', 'err');
    }
  } catch (err) {
    setSyncStatus('err');
    toast('Error al publicar: ' + err.message, 'err');
  }
}

function applyRemoteState(remote, evAt) {
  if (viewerKey) {
    state = { ...defaultState(), ...remote };
    renderAll();
    return;
  }
  if (identity && remote.pubkey && remote.pubkey !== identity.pub) return;

  const localAt = Number(state.updated_at || 0);
  if (evAt && localAt && evAt < localAt) return;

  const incomingJson = JSON.stringify({ ...remote, _pub: undefined });
  if (Date.now() - lastPublishAt < 6000 && incomingJson === publishedJson) return;

  delete remote._pub;
  state = { ...defaultState(), ...remote };
  state._pub = identity ? identity.pub : viewerKey;
  persistCache();
  renderAll();
  toast('🔄 Sincronizado desde Nostr');
}

let blogSub = null;

function startBlogSubscription(pubkeyHex) {
  if (blogSub && blogSub.close) blogSub.close();
  blogSub = null;
  subscribeBlogState(pubkeyHex, (data, evAt) => {
    data.pubkey = pubkeyHex;
    applyRemoteState(data, evAt);
  }).then((sub) => {
    blogSub = sub;
  }).catch(() => {});
}

let editUnlocked = false;

function toggleEdit() {
  const editing = document.body.classList.toggle('editing');
  $('#editModeBtn').textContent = editing ? '✅ Listo' : '✏️ Editar';
  if (editing) {
    usernameEl.setAttribute('contenteditable', 'true');
    toast('✏️ Modo edición activado — pulsa ✅ Listo para salir');
    usernameEl.focus();
  } else {
    usernameEl.removeAttribute('contenteditable');
    toast('Modo edición cerrado. Tus cambios ya se están publicando ☁️');
  }
}

$('#editModeBtn').addEventListener('click', (e) => {
  if (!identity) {
    openDlg(loginDialog);
    return;
  }
  if (identity.type === 'extension') {
    toggleEdit();
    return;
  }
  if (!editUnlocked) {
    openEditGate();
    return;
  }
  toggleEdit();
});

const editGateDialog = $('#editGateDialog');

function openEditGate() {
  $('#egNsecInput').value = '';
  const err = $('#egError');
  err.textContent = '';
  err.classList.add('hidden');
  openDlg(editGateDialog);
  setTimeout(() => $('#egNsecInput').focus(), 50);
}

async function confirmEditGate() {
  const val = $('#egNsecInput').value.trim();
  const err = $('#egError');
  err.textContent = '';
  err.classList.add('hidden');

  if (!val) {
    err.textContent = 'Pega tu clave nsec para continuar.';
    err.classList.remove('hidden');
    return;
  }

  try {
    const test = await importIdentity(val);
    if (test.pub !== identity.pub) {
      err.textContent = 'Esa clave no corresponde a este blog. Revisa que sea tu nsec.';
      err.classList.remove('hidden');
      return;
    }
    editUnlocked = true;
    closeDlg(editGateDialog);
    toggleEdit();
  } catch (err2) {
    err.textContent = 'nsec inválido: ' + err2.message;
    err.classList.remove('hidden');
  }
}

$('#egConfirmBtn').addEventListener('click', confirmEditGate);
$('#egNsecInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmEditGate();
});

usernameEl.addEventListener('beforeinput', (e) => {
  if (document.body.classList.contains('editing') === false) e.preventDefault();
});

usernameEl.addEventListener('input', () => {
  state.username = usernameEl.textContent.trim().slice(0, 40) || 'sin_nombre';
  document.title = `${state.username} · blog`;
  commit();
});

addCardBtn.addEventListener('click', () => openCardDialog(null));

let editingCard = null;
let dialogType = 'thought';
let pickedColor = COLORS[0];
let pendingImgData = null;

function openCardDialog(card) {
  editingCard = card;
  pendingImgData = null;

  const tabs = $('#typeTabs');
  tabs.style.display = card ? 'none' : 'flex';

  dialogType = card ? card.type : 'thought';
  setTabActive(dialogType);

  $('#cardDialogTitle').textContent = card ? 'Editar caja' : 'Nueva caja';
  $('#cardText').value = card ? (card.type === 'thought' ? card.text : card.caption || '') : '';

  $('#imgUrlInput').value = card && card.img ? card.img : '';
  $('#imgFileInput').value = '';
  $('#imgPreview').src = card && card.img ? card.img : '';
  $('#imgPreview').classList.toggle('hidden', !(card && card.img));
  $('#uploadStatus').textContent = '';

  pickedColor = card && card.color ? card.color : COLORS[0];
  renderColorSwatches();
  updateFieldVisibility();

  openDlg(cardDialog);
}

function setTabActive(type) {
  dialogType = type;
  document.querySelectorAll('#typeTabs .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.type === type);
  });
  updateFieldVisibility();
}

function updateFieldVisibility() {
  const isImage = dialogType === 'image';
  $('#imageFields').style.display = isImage ? 'block' : 'none';
  $('#colorField').style.display = isImage ? 'none' : 'block';
  $('#textLabel').textContent = isImage ? 'Descripción (opcional)' : '¿Qué estás pensando?';
}

document.querySelectorAll('#typeTabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => setTabActive(tab.dataset.type));
});

function renderColorSwatches() {
  const wrap = $('#colorSwatches');
  wrap.innerHTML = '';
  for (const color of COLORS) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch' + (color === pickedColor ? ' selected' : '');
    s.style.background = color;
    s.addEventListener('click', () => {
      pickedColor = color;
      renderColorSwatches();
    });
    wrap.appendChild(s);
  }
}

async function uploadToBlossom(file, statusEl) {
  if (!identity) {
    toast('Inicia sesión para subir imágenes', 'err');
    return null;
  }
  statusEl.textContent = 'preparando…';
  try {
    const url = await uploadBlob(file, (draft) => signWithIdentity(identity, draft), (msg) => {
      statusEl.textContent = msg;
    });
    statusEl.textContent = '';
    toast('Imagen subida ✅');
    return url;
  } catch (err) {
    statusEl.textContent = '';
    toast('No se pudo subir la imagen: ' + err.message, 'err');
    return null;
  }
}

$('#imgUrlInput').addEventListener('input', (e) => {
  const url = e.target.value.trim();
  if (url) {
    pendingImgData = url;
    $('#imgPreview').src = url;
    $('#imgPreview').classList.remove('hidden');
  }
});

$('#imgFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = await uploadToBlossom(file, $('#uploadStatus'));
  if (url) {
    pendingImgData = url;
    $('#imgPreview').src = url;
    $('#imgPreview').classList.remove('hidden');
  }
});

$('#saveCardBtn').addEventListener('click', () => {
  const text = $('#cardText').value.trim();
  const img = pendingImgData;

  if (dialogType === 'image' && !img) {
    toast('Agrega una imagen (URL o archivo)', 'err');
    return;
  }
  if (dialogType === 'thought' && !text) {
    toast('Escribe algo primero 🙂', 'err');
    return;
  }

  if (editingCard) {
    if (editingCard.type === 'thought') {
      editingCard.text = text;
    } else {
      editingCard.img = img;
      editingCard.caption = text;
    }
    editingCard.color = dialogType === 'thought' ? pickedColor : editingCard.color;
  } else {
    const card =
      dialogType === 'thought'
        ? { id: uid(), type: 'thought', text, size: 'wide', color: pickedColor }
        : { id: uid(), type: 'image', img, caption: text, size: 'sm' };
    state.cards.unshift(card);
  }

  commit();
  renderCards();
  closeDlg(cardDialog, 'confirm');
});

let pickedEmoji = '🙂';
let pendingAvatarData = null;

avatarBtn.addEventListener('click', () => {
  if (!identity) {
    openDlg(loginDialog);
    return;
  }
  pickedEmoji = state.avatar || '🙂';
  pendingAvatarData = null;
  $('#avatarFileInput').value = '';
  $('#avatarUploadStatus').textContent = '';
  renderEmojiGrid();
  openDlg(avatarDialog);
});

function renderEmojiGrid() {
  const wrap = $('#emojiGrid');
  wrap.innerHTML = '';
  for (const em of EMOJIS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emoji-option' + (em === pickedEmoji ? ' selected' : '');
    b.textContent = em;
    b.addEventListener('click', () => {
      pickedEmoji = em;
      pendingAvatarData = null;
      renderEmojiGrid();
    });
    wrap.appendChild(b);
  }
}

$('#avatarFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = await uploadToBlossom(file, $('#avatarUploadStatus'));
  if (url) {
    pendingAvatarData = url;
    renderEmojiGrid();
  }
});

$('#avatarConfirmBtn').addEventListener('click', () => {
  if (pendingAvatarData) {
    state.avatarUrl = pendingAvatarData;
    state.avatar = '';
  } else {
    state.avatar = pickedEmoji;
    state.avatarUrl = '';
  }
  commit();
  applyIdentity();
  closeDlg(avatarDialog, 'confirm');
});

let kgAllowClose = false;

function openKeyGuard(nsec) {
  kgAllowClose = false;
  $('#kgNsec').textContent = nsec;
  const btn = $('#kgContinueBtn');
  let left = 10;
  btn.disabled = true;
  btn.textContent = `⏳ Continuar (${left} s)`;

  if (keyGuardDialog.timer) clearInterval(keyGuardDialog.timer);
  keyGuardDialog.timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(keyGuardDialog.timer);
      keyGuardDialog.timer = null;
      btn.disabled = false;
      btn.textContent = '✅ Ya la copié y guardé';
    } else {
      btn.textContent = `⏳ Continuar (${left} s)`;
    }
  }, 1000);

  openDlg(keyGuardDialog);
}

keyGuardDialog.addEventListener('cancel', (e) => {
  if (!kgAllowClose) e.preventDefault();
});

$('#kgCopyBtn').addEventListener('click', () => copyText($('#kgNsec').textContent, 'nsec'));

$('#kgContinueBtn').addEventListener('click', () => {
  const btn = $('#kgContinueBtn');
  if (btn.disabled) return;
  if (keyGuardDialog.timer) {
    clearInterval(keyGuardDialog.timer);
    keyGuardDialog.timer = null;
  }
  kgAllowClose = true;
  closeDlg(keyGuardDialog);
});

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  ta.remove();
  return ok;
}

async function copyText(text, label) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (err) {}
  if (!ok) ok = legacyCopy(text);
  if (ok) toast(label + ' copiado ✅');
  else toast('No se pudo copiar automáticamente — selecciónalo y copia manualmente', 'err');
}

function renderVoteBadge(universeId, createdAt) {
  const badge = $('#voteBadge');
  const label = $('#voteBadgeLabel');
  const u = UNIVERSES.find((x) => x.id === universeId);
  if (renderVoteBadge.last && createdAt && createdAt < renderVoteBadge.last) return;
  renderVoteBadge.last = createdAt || renderVoteBadge.last;
  if (!u) {
    badge.classList.add('hidden');
    label.classList.add('hidden');
    return;
  }
  badge.textContent = u.shortName;
  badge.style.background = u.color;
  badge.style.color = u.fg;
  badge.classList.remove('hidden');
  label.classList.remove('hidden');
}

let voteSub = null;

async function trackUserVote(pubkeyHex) {
  const vote = await fetchLatestUserVote(pubkeyHex);
  if (vote) renderVoteBadge(vote.universe, vote.createdAt);
  else renderVoteBadge(null);
  if (voteSub && voteSub.close) voteSub.close();
  voteSub = await subscribeUserVote(pubkeyHex, (universe, createdAt) => {
    renderVoteBadge(universe, createdAt);
  });
}

$('#supportBtn').addEventListener('click', () => openDlg($('#supportDialog')));
$('#donateBtn').addEventListener('click', () => openDlg($('#donateDialog')));

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dlg = btn.closest('dialog');
    if (dlg) closeDlg(dlg, 'cancel');
  });
});

document.querySelectorAll('.dlg-cancel').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dlg = btn.closest('dialog');
    if (dlg) closeDlg(dlg, 'cancel');
  });
});

document.querySelectorAll('a[data-ext]').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (!a.hasAttribute('data-ext')) return;
    e.preventDefault();
    const url = a.href;
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
  });
});

$('#creatorBtn').addEventListener('click', (e) => {
  if (!document.body.classList.contains('viewer')) return;
  e.preventDefault();
  location.href = location.origin + location.pathname;
});

document.querySelectorAll('.copy-addr').forEach((btn) => {
  btn.addEventListener('click', () => copyText(btn.parentElement.querySelector('input').value, 'Dirección'));
});

$('#voteCtaBtn').addEventListener('click', () => {
  if (!identity) {
    openDlg(loginDialog);
    toast('Crea tu cuenta para votar con tu identidad', 'warn');
    return;
  }
  const back = encodeURIComponent(location.origin + location.pathname);
  location.href = `../DoomsdayGrid/?src=bento&back=${back}`;
});

function fillAccountDialog(npub) {
  $('#npubOutput').value = npub;
  $('#shareLink').value = `${location.origin}${location.pathname}?u=${npub}`;
  $('#backupSection').style.display = identity.type === 'local' ? 'block' : 'none';
  $('#nsecOutput').value = '';
  $('#nsecOutput').type = 'password';
  $('#revealNsecBtn').textContent = 'Mostrar';
}

accountDialog.addEventListener('close', () => {
  const out = $('#nsecOutput');
  out.value = '';
  out.type = 'password';
});

$('#accountBtn').addEventListener('click', async () => {
  if (!identity) {
    openDlg(loginDialog);
    return;
  }
  fillAccountDialog(await toNpub(identity.pub));
  openDlg(accountDialog);
});

$('#copyNpubBtn').addEventListener('click', () => copyText($('#npubOutput').value, 'npub'));
$('#copyLinkBtn').addEventListener('click', () => copyText($('#shareLink').value, 'Enlace'));

$('#revealNsecBtn').addEventListener('click', async () => {
  const out = $('#nsecOutput');
  if (out.type === 'password') {
    out.value = await toNsec(identity);
    out.type = 'text';
    $('#revealNsecBtn').textContent = 'Ocultar';
  } else {
    out.type = 'password';
    out.value = '';
    $('#revealNsecBtn').textContent = 'Mostrar';
  }
});

$('#copyNsecBtn').addEventListener('click', async () => {
  copyText(await toNsec(identity), 'nsec');
});

let logoutArmed = false;
let logoutTimer = null;

$('#logoutBtn').addEventListener('click', () => {
  const btn = $('#logoutBtn');
  if (!logoutArmed) {
    logoutArmed = true;
    btn.textContent = '¿Seguro? Pulsa otra vez';
    clearTimeout(logoutTimer);
    logoutTimer = setTimeout(() => {
      logoutArmed = false;
      btn.textContent = 'Cerrar sesión';
    }, 3500);
    return;
  }
  clearTimeout(logoutTimer);
  clearIdentity();
  location.href = location.pathname;
});

$('#btnCreateIdentity').addEventListener('click', async () => {
  const btn = $('#btnCreateIdentity');
  const name = $('#loginNameInput').value.trim();
  btn.disabled = true;
  btn.textContent = 'Generando claves…';
  try {
    identity = await createIdentity(name);
    saveIdentity(identity);
    state.username = name || state.username;
    closeDlg(loginDialog);
    toast('Identidad creada 🎉');
    await afterLogin();
    openKeyGuard(await toNsec(identity));
  } catch (err) {
    toast('No se pudo crear la identidad: ' + err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Crear identidad nueva';
  }
});

function setLoginError(msg) {
  const err = $('#loginError');
  if (msg) {
    err.textContent = msg;
    err.classList.remove('hidden');
  } else {
    err.textContent = '';
    err.classList.add('hidden');
  }
}

async function doImportNsec() {
  const btn = $('#btnImportNsec');
  const nsec = $('#nsecInput').value.trim();
  setLoginError('');

  if (!nsec) {
    setLoginError('⚠️ Pega tu clave nsec en el campo de arriba');
    $('#nsecInput').focus();
    return;
  }

  const origText = '🔑 Iniciar sesión con nsec';
  btn.disabled = true;
  btn.textContent = '⏳ Verificando clave…';
  try {
    identity = await importIdentity(nsec, $('#loginNameInput').value.trim());
    saveIdentity(identity);
    $('#nsecInput').value = '';
    closeDlg(loginDialog);
    toast('Sesión iniciada 🔑');
    await afterLogin();
  } catch (err) {
    const msg = (err && err.message) || 'clave inválida';
    setLoginError('⚠️ ' + msg);
    toast('No se pudo iniciar sesión: ' + msg, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

$('#btnImportNsec').addEventListener('click', doImportNsec);

$('#nsecInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doImportNsec();
});

$('#eyeBtn').addEventListener('click', () => {
  const input = $('#nsecInput');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#eyeBtn').textContent = input.type === 'password' ? '👁️' : '🙈';
});

$('#btnExtension').addEventListener('click', async () => {
  try {
    identity = await extensionIdentity();
    saveIdentity(identity);
    closeDlg(loginDialog);
    toast('Conectado con extensión 🦊');
    await afterLogin();
  } catch (err) {
    toast('No se pudo conectar con la extensión', 'err');
  }
});

async function afterLogin() {
  applyIdentity();
  setSyncStatus('syncing');

  const cached = loadCacheFor(identity.pub);
  if (cached) {
    state = { ...defaultState(), ...cached };
    renderAll();
  }

  try {
    const remote = await fetchBlogState(identity.pub);
    if (remote) {
      const localAt = Number(state.updated_at || 0);
      const remoteAt = Number(remote.updated_at || 0);
      if (!cached || remoteAt >= localAt) {
        state = { ...defaultState(), ...remote };
        toast('Blog cargado desde Nostr ☁️');
      }
    } else if (!cached && state.cards.length === 0) {
      state = demoState();
    }
    state._pub = identity.pub;
    persistCache();
    renderAll();
    setSyncStatus('ok');
    startBlogSubscription(identity.pub);
    trackUserVote(identity.pub);
  } catch (err) {
    setSyncStatus('err');
    startBlogSubscription(identity.pub);
  }
}

async function resolveViewerKey() {
  const raw = new URLSearchParams(location.search).get('u');
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw;
  try {
    return await fromNpub(raw);
  } catch (err) {
    return null;
  }
}

async function enterViewerMode(pubkeyHex) {
  document.body.classList.add('viewer');
  syncStatusEl.style.display = 'none';
  $('#accountBtn').style.display = 'none';
  $('#editModeBtn').style.display = 'none';

  const cb = $('#creatorBtn');
  cb.removeAttribute('data-ext');
  cb.textContent = '↩️ Volver';
  cb.href = location.origin + location.pathname;

  const cached = loadCacheFor(pubkeyHex);
  if (cached) {
    state = { ...defaultState(), ...cached };
    renderAll();
  }

  try {
    const remote = await fetchBlogState(pubkeyHex);
    if (remote) {
      state = { ...defaultState(), ...remote };
      state._pub = pubkeyHex;
      persistCache();
    } else if (!cached) {
      state = demoState();
    }
    renderAll();
    startBlogSubscription(pubkeyHex);
    trackUserVote(pubkeyHex);
  } catch (err) {
    if (!cached) renderAll();
    toast('Sin conexión a los relays', 'err');
  }
}

async function boot() {
  if (!nativeDialog || !window.crypto || !window.crypto.subtle) {
    $('#compatNote').classList.remove('hidden');
  }

  loadNostrLib().catch(() => {});

  if (window.nostr && window.nostr.getPublicKey) {
    $('#btnExtension').classList.remove('hidden');
  }

  renderAll();
  setSyncStatus('idle');
  initRadar();

  viewerKey = await resolveViewerKey();
  identity = loadIdentity();

  if (viewerKey && identity && identity.pub === viewerKey) {
    viewerKey = null;
    history.replaceState({}, '', location.pathname);
    toast('👋 Bienvenido de nuevo, dueño de este blog');
    await afterLogin();
    return;
  }

  if (viewerKey) {
    await enterViewerMode(viewerKey);
    return;
  }

  if (!identity) {
    const lastPub = localStorage.getItem(LAST_PUB_KEY);
    const lastCached = lastPub ? loadCacheFor(lastPub) : null;
    if (lastCached && Array.isArray(lastCached.cards) && lastCached.cards.length) {
      state = { ...defaultState(), ...lastCached };
      state._pub = lastPub;
      renderAll();
      toast('👀 Vista local — inicia sesión para editar');
    }
    openDlg(loginDialog);
    setSyncStatus('idle');
  } else {
    await afterLogin();
  }
}

boot();
