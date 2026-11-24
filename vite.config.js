import {defineConfig} from 'vite';

// GitHub Pages serves this project at /origamiViewer/. The API URL is built
// into the public bundle; it must be a Worker URL, never a secret.
export default defineConfig(({command})=>{
  if(command==='build'&&!/^https:\/\/[^/]+(?:\/)?$/.test(process.env.VITE_API_URL??''))
    throw new Error('Set VITE_API_URL to the HTTPS Cloudflare Worker origin before building.');
  return {base:command==='build'?'/origamiViewer/':'/',
    build:{outDir:'dist',sourcemap:false}};
});
