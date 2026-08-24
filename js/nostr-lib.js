let libPromise = null;
let nip19Promise = null;

const CDNS = [
  'https://esm.sh/nostr-tools@2.10.4',
  'https://cdn.jsdelivr.net/npm/nostr-tools@2.10.4/+esm',
];

const NIP19_SUBPATHS = [
  'https://esm.sh/nostr-tools@2.10.4/nip19',
  'https://cdn.jsdelivr.net/npm/nostr-tools@2.10.4/nip19/+esm',
];

export function loadNostrLib() {
  if (!libPromise) {
    libPromise = (async () => {
      let lastError = null;
      for (const url of CDNS) {
        try {
          const mod = await import(url);
          if (mod.finalizeEvent && mod.SimplePool) return mod;
          lastError = new Error('exportos faltantes en ' + url);
        } catch (err) {
          lastError = err;
        }
      }
      libPromise = null;
      throw lastError || new Error('nostr-tools no disponible');
    })();
  }
  return libPromise;
}

export function getNip19() {
  if (!nip19Promise) {
    nip19Promise = (async () => {
      const lib = await loadNostrLib();
      if (lib.nip19 && lib.nip19.npubEncode) return lib.nip19;
      let lastError = null;
      for (const url of NIP19_SUBPATHS) {
        try {
          return await import(url);
        } catch (err) {
          lastError = err;
        }
      }
      nip19Promise = null;
      throw lastError || new Error('nip19 no disponible');
    })();
  }
  return nip19Promise;
}
