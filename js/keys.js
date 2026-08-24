import { loadNostrLib, getNip19 } from './nostr-lib.js';

const IDENTITY_KEY = 'bento_identity_v1';

function bytesToB64(bytes) {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function loadIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {}
  return null;
}

export function saveIdentity(identity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

export async function createIdentity(name) {
  const lib = await loadNostrLib();
  const sk = lib.generateSecretKey();
  const pub = lib.getPublicKey(sk);
  return {
    type: 'local',
    pub,
    sec: bytesToB64(sk),
    name: name || 'anonimo',
  };
}

function decodeBech32(nip19, str) {
  if (typeof nip19.decode === 'function') {
    return nip19.decode(str);
  }
  if (str.startsWith('nsec') && typeof nip19.nsecDecode === 'function') {
    return { type: 'nsec', data: nip19.nsecDecode(str) };
  }
  if (str.startsWith('npub') && typeof nip19.npubDecode === 'function') {
    return { type: 'npub', data: nip19.npubDecode(str) };
  }
  throw new Error('formato no soportado');
}

export async function importIdentity(nsec, name) {
  const lib = await loadNostrLib();
  const nip19 = await getNip19();
  let decoded;
  try {
    decoded = decodeBech32(nip19, nsec.trim().toLowerCase());
  } catch (err) {
    throw new Error('nsec invalido');
  }
  if (!decoded || decoded.type !== 'nsec' || !decoded.data) {
    throw new Error('eso no es un nsec, parece un ' + (decoded?.type ?? 'texto desconocido'));
  }
  const pub = lib.getPublicKey(decoded.data);
  return {
    type: 'local',
    pub,
    sec: bytesToB64(decoded.data),
    name: name || 'anonimo',
  };
}

export async function extensionIdentity() {
  if (!window.nostr || !window.nostr.getPublicKey) {
    throw new Error('sin extension NIP-07');
  }
  const pub = await window.nostr.getPublicKey();
  return { type: 'extension', pub, sec: '', name: 'anonimo' };
}

export function secretKeyBytes(identity) {
  return b64ToBytes(identity.sec);
}

export async function toNpub(pubkeyHex) {
  try {
    const nip19 = await getNip19();
    return nip19.npubEncode(pubkeyHex);
  } catch (err) {
    return pubkeyHex;
  }
}

export async function fromNpub(npub) {
  const nip19 = await getNip19();
  const decoded = decodeBech32(nip19, npub.trim().toLowerCase());
  if (!decoded || decoded.type !== 'npub') {
    throw new Error('npub invalido');
  }
  return decoded.data;
}

export async function toNsec(identity) {
  const nip19 = await getNip19();
  return nip19.nsecEncode(secretKeyBytes(identity));
}
