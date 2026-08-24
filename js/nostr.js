import { loadNostrLib } from './nostr-lib.js';
import { secretKeyBytes } from './keys.js';

export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.ditto.pub',
];

export const BLOG_KIND = 33777;
export const BLOG_DTAG = 'bento-blog-v1';

let pool = null;

async function getPool() {
  const lib = await loadNostrLib();
  if (!pool) pool = new lib.SimplePool();
  return { lib, pool };
}

export async function signWithIdentity(identity, draft) {
  if (identity.type === 'extension') {
    if (!window.nostr || !window.nostr.signEvent) throw new Error('extension no disponible');
    return window.nostr.signEvent(draft);
  }
  const lib = await loadNostrLib();
  return lib.finalizeEvent(draft, secretKeyBytes(identity));
}

export async function publishBlogState(identity, state) {
  const { pool } = await getPool();
  const now = Math.floor(Date.now() / 1000);

  const blogDraft = {
    kind: BLOG_KIND,
    created_at: now,
    tags: [
      ['d', BLOG_DTAG],
      ['title', `${state.username} · bento blog`],
      ['client', 'bento-blog'],
    ],
    content: JSON.stringify({
      username: state.username,
      avatar: state.avatar || '',
      avatarUrl: state.avatarUrl || '',
      cards: state.cards,
      updated_at: now,
    }),
  };
  const blogEvent = await signWithIdentity(identity, blogDraft);

  const profileDraft = {
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({
      name: state.username,
      display_name: state.username,
      picture: state.avatarUrl || '',
    }),
  };
  const profileEvent = await signWithIdentity(identity, profileDraft);

  const pubs = [...pool.publish(RELAYS, blogEvent), ...pool.publish(RELAYS, profileEvent)];

  return new Promise((resolve) => {
    let ok = 0;
    let pending = pubs.length;
    const done = (success) => {
      pending -= 1;
      if (success) ok += 1;
      if (pending <= 0) resolve(ok);
    };
    pubs.forEach((p) => p.then(() => done(true)).catch(() => done(false)));
    setTimeout(() => resolve(ok), 8000);
  });
}

export const VOTE_KIND = 30078;
export const VOTE_DTAG = 'doomsdaygrid-vote';

export async function subscribeVoteTotals(onUpdate, onLive) {
  const { lib, pool } = await getPool();
  const latest = new Map();

  const compute = () => {
    const totals = { spidey: 0, xmen: 0, mcu: 0, f4: 0, doom: 0, tva: 0 };
    for (const ev of latest.values()) {
      const tTag = ev.tags.find((tag) => tag[0] === 't');
      if (tTag && totals[tTag[1]] !== undefined) {
        totals[tTag[1]] += 1;
      }
    }
    onUpdate(totals);
  };

  const closer = pool.subscribeMany(
    RELAYS,
    [{ kinds: [VOTE_KIND], '#d': [VOTE_DTAG] }],
    {
      onevent: (ev) => {
        try {
          if (!lib.verifyEvent(ev)) return;
        } catch (err) {
          return;
        }
        const dTag = ev.tags.find((tag) => tag[0] === 'd');
        if (!dTag || dTag[1] !== VOTE_DTAG) return;
        const prev = latest.get(ev.pubkey);
        if (!prev || ev.created_at > prev.created_at) {
          latest.set(ev.pubkey, ev);
          compute();
        }
      },
      oneose: () => {
        compute();
        onLive?.();
      },
      maxWait: 9000,
    }
  );

  return closer;
}

export async function fetchLatestUserVote(pubkeyHex) {
  const { lib, pool } = await getPool();
  let events = [];
  try {
    events = await pool.querySync(
      RELAYS,
      { kinds: [VOTE_KIND], authors: [pubkeyHex], '#d': [VOTE_DTAG], limit: 1 },
      { maxWait: 7000 }
    );
  } catch (err) {
    return null;
  }
  let best = null;
  for (const ev of events) {
    try {
      if (!lib.verifyEvent(ev)) continue;
    } catch (err) {
      continue;
    }
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  if (!best) return null;
  const tTag = best.tags.find((tag) => tag[0] === 't');
  return tTag ? { universe: tTag[1], createdAt: best.created_at } : null;
}

export async function subscribeUserVote(pubkeyHex, onVote) {
  const { lib, pool } = await getPool();
  let lastSeen = 0;
  return pool.subscribeMany(
    RELAYS,
    [{ kinds: [VOTE_KIND], authors: [pubkeyHex], '#d': [VOTE_DTAG] }],
    {
      onevent: (ev) => {
        try {
          if (!lib.verifyEvent(ev)) return;
        } catch (err) {
          return;
        }
        const tTag = ev.tags.find((tag) => tag[0] === 't');
        if (!tTag) return;
        lastSeen = Math.max(lastSeen, ev.created_at);
        onVote(tTag[1], ev.created_at);
      },
      maxWait: 8000,
    }
  );
}

export async function fetchBlogState(pubkeyHex) {
  const { lib, pool } = await getPool();

  let events = [];
  try {
    events = await pool.querySync(
      RELAYS,
      { kinds: [BLOG_KIND], authors: [pubkeyHex], '#d': [BLOG_DTAG], limit: 2 },
      { maxWait: 9000 }
    );
  } catch (err) {
    throw new Error('relays no disponibles');
  }

  let best = null;
  for (const ev of events) {
    try {
      if (!lib.verifyEvent(ev)) continue;
    } catch (err) {
      continue;
    }
    if (!best || ev.created_at > best.created_at) best = ev;
  }
  if (!best) return null;

  try {
    const data = JSON.parse(best.content);
    if (!Array.isArray(data.cards)) return null;
    return data;
  } catch (err) {
    return null;
  }
}
