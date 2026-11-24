// Read-only gateway for the private crane bake in R2. The Worker contains no
// folding engine and never receives upload credentials: BAKE is an R2 binding.
const MODEL = 'crane';
const TOKEN_TTL = 15 * 60;
const FILE_TTL = 5 * 60;
const encoder = new TextEncoder();
let cachedSecret;
let cachedKey;

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('invalid base64url');
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmacKey(secret) {
  if (secret !== cachedSecret) {
    cachedKey = await crypto.subtle.importKey('raw', encoder.encode(secret),
      {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
    cachedSecret = secret;
  }
  return cachedKey;
}

async function sign(secret, value) {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',
    await hmacKey(secret), encoder.encode(value))));
}

async function verify(secret, value, mac) {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret),
      fromBase64url(mac), encoder.encode(value));
  } catch {
    return false;
  }
}

function headers(origin, type = 'application/json') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Vary': 'Origin',
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  };
}

function json(value, status, origin) {
  return new Response(JSON.stringify(value), {status, headers: headers(origin)});
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function issueToken(secret, origin) {
  const nonce = crypto.getRandomValues(new Uint8Array(9));
  const exp = nowSeconds() + TOKEN_TTL;
  const body = base64url(encoder.encode(JSON.stringify({o: origin, exp, n: base64url(nonce)})));
  return {token: body + '.' + await sign(secret, body), expiresAt: exp};
}

async function validToken(secret, token, origin) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !await verify(secret, parts[0], parts[1])) return false;
  try {
    const claim = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return claim.o === origin && Number.isInteger(claim.exp) && claim.exp > nowSeconds();
  } catch {
    return false;
  }
}

async function signedFileUrl(request, secret, origin, key) {
  const exp = nowSeconds() + FILE_TTL;
  const sig = await sign(secret, 'file:' + key + ':' + exp + ':' + origin);
  const url = new URL('/files/' + key, request.url);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sig);
  return url.href;
}

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  return object ? object.json() : null;
}

function configured(env) {
  if (!env.BAKE || typeof env.TOKEN_SECRET !== 'string' ||
      env.TOKEN_SECRET.length < 32 || typeof env.SITE_ORIGIN !== 'string') return false;
  try {
    const site = new URL(env.SITE_ORIGIN);
    return site.protocol === 'https:' && site.origin === env.SITE_ORIGIN;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    if (!configured(env)) return new Response('Worker is not configured', {status: 500});
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET')
      return json({ok: true}, 200, env.SITE_ORIGIN);

    const origin = request.headers.get('Origin');
    if (origin !== env.SITE_ORIGIN) return new Response('Origin not allowed', {status: 403});
    if (request.method === 'OPTIONS')
      return new Response(null, {status: 204, headers: headers(origin)});
    if (request.method !== 'GET' && request.method !== 'POST')
      return json({error: 'method not allowed'}, 405, origin);

    if (url.pathname === '/api/session' && request.method === 'POST')
      return json(await issueToken(env.TOKEN_SECRET, origin), 200, origin);

    const file = /^\/files\/(crane\/step-\d{2}\/(?:index|uv|frames-\d+)\.bin\.gz)$/.exec(url.pathname);
    if (file && request.method === 'GET') {
      const key = file[1], exp = Number(url.searchParams.get('exp'));
      const sig = url.searchParams.get('sig');
      if (!Number.isSafeInteger(exp) || exp <= nowSeconds() ||
          !await verify(env.TOKEN_SECRET, 'file:' + key + ':' + exp + ':' + origin, sig))
        return json({error: 'invalid or expired link'}, 403, origin);
      const object = await env.BAKE.get(key);
      if (!object) return json({error: 'not found'}, 404, origin);
      const responseHeaders = headers(origin, 'application/octet-stream');
      responseHeaders['Cache-Control'] = 'private, max-age=300';
      if (object.httpEtag) responseHeaders.ETag = object.httpEtag;
      return new Response(object.body, {status: 200, headers: responseHeaders});
    }

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!await validToken(env.TOKEN_SECRET, token, origin))
      return json({error: 'invalid or expired token'}, 401, origin);

    try {
      if (url.pathname === '/api/models/' + MODEL && request.method === 'GET') {
        const model = await readJson(env.BAKE, MODEL + '/model.json');
        return model ? json(model, 200, origin) : json({error: 'not baked'}, 404, origin);
      }
      const match = /^\/api\/models\/crane\/steps\/([1-9]\d*)$/.exec(url.pathname);
      if (match && request.method === 'GET') {
        const model = await readJson(env.BAKE, MODEL + '/model.json');
        if (!model) return json({error: 'not baked'}, 404, origin);
        const n = Number(match[1]);
        const step = model.steps.find(s => s.index === n - 1);
        if (!step || !/^step-\d{2}$/.test(step.folder))
          return json({error: 'no such step'}, 404, origin);
        const dir = MODEL + '/' + step.folder + '/';
        const manifest = await readJson(env.BAKE, dir + 'manifest.json');
        if (!manifest || !Array.isArray(manifest.chunks) ||
            manifest.chunks.some(c => !/^frames-\d+\.bin\.gz$/.test(c.file)))
          return json({error: 'not baked'}, 404, origin);
        const chunks = await Promise.all(manifest.chunks.map(async c =>
          ({...c, url: await signedFileUrl(request, env.TOKEN_SECRET, origin, dir + c.file)})));
        return json({...manifest, expiresIn: FILE_TTL,
          index: await signedFileUrl(request, env.TOKEN_SECRET, origin, dir + 'index.bin.gz'),
          uv: await signedFileUrl(request, env.TOKEN_SECRET, origin, dir + 'uv.bin.gz'),
          chunks}, 200, origin);
      }
      return json({error: 'not found'}, 404, origin);
    } catch (error) {
      console.error(error);
      return json({error: 'server error'}, 500, origin);
    }
  }
};
