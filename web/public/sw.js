/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAexY9GbH2a9Ad1zMq8pWzWSul6zx4-dr4',
  authDomain: 'appmonitorzcnet.firebaseapp.com',
  projectId: 'appmonitorzcnet',
  storageBucket: 'appmonitorzcnet.firebasestorage.app',
  messagingSenderId: '512622843004',
  appId: '1:512622843004:web:624fcad355b83b1247a5f9',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Monitor MikroTik', {
    body: body || '',
  });
});

// --- Casco do app pra funcionar offline/ser instalável ---

const CACHE_NAME = 'monitor-shell-v1';
const SHELL_URLS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Dados (/api/*) sempre buscam na rede — nunca serve informação velha do cache.
// Só o "casco" do app (HTML/JS/CSS) usa cache, pra abrir mesmo sem internet.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
