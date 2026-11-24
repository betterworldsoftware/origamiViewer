# Origami crane viewer

This public repository contains the static crane player and a read-only
Cloudflare Worker. The folding engine and baked animation files live in the
private origamiNew project. GitHub Pages serves the player. The Worker reads
the baked files from a private Cloudflare R2 bucket.

The expected site URL is:

https://betterworldsoftware.github.io/origamiViewer/

## How playback works

1. The browser asks the Worker for a short-lived session token.
2. The browser loads crane/model.json and a step manifest through the Worker.
3. The manifest contains five-minute URLs for that step's mesh and frame chunks.
4. The browser downloads those files through the Worker, which streams them
   from its private R2 binding. No R2 credentials appear in the browser.

The Worker only handles the crane model and only reads objects. The R2 bucket
does not need a public URL or a CORS policy. The public site lets visitors
view and save the bytes it receives; the session token and allowed Origin
limit casual reuse but do not make a public animation confidential.

## 1. Create the R2 bucket

In the Cloudflare dashboard, open R2 Object Storage and create a bucket named
origami-bake using **Standard** storage. Leave public access off: do not turn
on the r2.dev URL or connect a public custom domain. If you choose another
bucket name, change bucket_name in wrangler.jsonc before deploying.

Create an R2 API token scoped to this one bucket with Object Read & Write
permission for the one-time upload. Save its Access Key ID, Secret Access Key,
your Account ID, and the S3 endpoint shown by Cloudflare. Do not put these
values in this public repository or in GitHub Actions.

## 2. Upload the baked crane

Run this from the private origamiNew repository on the computer with the bake.
Set the four variables in the local shell from your saved credentials:

~~~sh
export S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
export S3_BUCKET=origami-bake
export S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
export S3_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
npm run upload:r2 -- crane
~~~

The uploader writes each step before crane/model.json. The full bake is about
257 MB on disk, with 232.7 MB of compressed frame chunks. You can remove
those four variables from the shell after upload.

## 3. Deploy the read-only Worker

From this repository:

~~~sh
npm ci
npx wrangler login
npm run deploy:worker
npx wrangler secret put TOKEN_SECRET
~~~

For TOKEN_SECRET, generate a random value locally with openssl rand -hex 32
and paste it into Wrangler's prompt. Never commit it. Wrangler prints the
Worker URL, usually ending in workers.dev. The first deployment returns 500
until the secret is set; Wrangler redeploys when the secret is added.

The Worker uses the BAKE R2 binding in wrangler.jsonc. SITE_ORIGIN is set to
https://betterworldsoftware.github.io, which is the Origin header for this
GitHub Pages project site. If you use another GitHub account or a custom
domain, update SITE_ORIGIN and the Vite base path before deploying.

Check the deployment:

~~~sh
curl https://YOUR_WORKER_URL/healthz
~~~

It should return {"ok":true}. R2 credentials are only used by the uploader;
the Worker binding reads R2 without an API key in code or GitHub.

## 4. Publish GitHub Pages

In the origamiViewer GitHub repository:

1. Settings → Secrets and variables → Actions → Variables: add VITE_API_URL
   with the Worker origin, such as https://origami-crane-frames.YOU.workers.dev.
   This is a public URL, not a secret.
2. Settings → Pages → Build and deployment: select **GitHub Actions**.
3. Push the contents of this repository to main. The included workflow builds
   and tests the app, then publishes dist to GitHub Pages.
4. Open https://betterworldsoftware.github.io/origamiViewer/ and check the
   first and final steps.

The production build intentionally fails when VITE_API_URL is missing or is
not an HTTPS origin. No baked files are committed to this repo.

## Local development

The private project's local API can serve the baked files while developing
the player. Start it on port 8787 with origamiNew's server command. Then run:

~~~sh
cp .env.example .env
npm ci
npm run dev
~~~

Allow http://127.0.0.1:5191 in that API's ALLOWED_ORIGINS. The local app is
at http://127.0.0.1:5191/. The production app uses the Worker URL configured
at build time.
