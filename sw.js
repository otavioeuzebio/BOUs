/* Service worker — offline. Ao publicar nova versão, aumente o número do CACHE. */
const CACHE = 'descritivo-bou-v2';
const ARQUIVOS = ['./', './index.html', './app.js', './municipios.js', './firebase-config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  const meu = u.origin === self.location.origin, sdk = u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  if (e.request.method !== 'GET' || (!meu && !sdk)) return; // Firebase, CEP e GPS sempre direto na rede
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (meu ? caches.match('./index.html') : undefined))));
});
