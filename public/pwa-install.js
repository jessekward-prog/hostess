// PWA install support — see manifest.json/sw.js alongside this file. There
// is no web API that can place an icon on the OS desktop directly; this
// gets you a real OS app-list entry (Windows Start Menu, macOS/Linux
// Applications) via a visible button, since the browser's own install icon
// is easy to miss — which is the actual point, so the dashboard tab isn't
// just one of a dozen localhost:XXXX tabs you lose track of.

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
const installHint = document.getElementById('installHint');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = '';
});

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.style.display = 'none';
  if (installHint) installHint.style.display = 'none';
});

if (isIos() && !isStandalone() && installHint) {
  installHint.style.display = '';
}

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted' && installBtn) installBtn.style.display = 'none';
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
