export const BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://blossom.nostr.build',
  'https://blossom.band',
  'https://nostr.download',
  'https://cdn.nostrcheck.me',
];

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export async function uploadBlob(file, signEvent, onProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error('archivo mayor a 20 MB');
  }
  const hash = await sha256Hex(bytes);
  const now = Math.floor(Date.now() / 1000);
  const draft = {
    kind: 24242,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(now + 3600)],
    ],
    content: 'Subida de imagen para el blog bento',
  };
  const signed = await signEvent(draft);
  const auth = 'Nostr ' + b64Utf8(JSON.stringify(signed));
  const contentType = file.type || 'application/octet-stream';

  let lastError = null;
  for (const server of BLOSSOM_SERVERS) {
    try {
      if (onProgress) onProgress(`subiendo a ${server.replace('https://', '')}…`);
      const res = await fetch(server + '/upload', {
        method: 'PUT',
        headers: {
          Authorization: auth,
          'Content-Type': contentType,
        },
        body: bytes,
      });
      if (!res.ok) {
        lastError = new Error(`${server} respondio ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.url) return data.url;
      return `${server}/${hash}`;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('ningun servidor Blossom disponible');
}
