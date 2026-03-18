// Register the service worker at site root so it controls all pages
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then(reg => {
        // Optional: listen for updates
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          newSW && newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated') console.log('Service worker activated');
          });
        });
        console.log('Service worker registered:', reg.scope);
      })
      .catch(err => console.warn('Service worker registration failed:', err));
  });
}
