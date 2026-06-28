// src/router.ts
export function initRouter() {
  // Map hash to page path
  const routes: Record<string, string> = {
    '#dashboard': '/index.html',
    '#report': '/report.html',
    '#intelligence': '/intelligence.html',
    '#agent': '/agent-command.html',
    '#admin': '/admin.html',
  };

  function loadPage(path: string) {
    fetch(path)
      .then((res) => res.text())
      .then((html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const app = document.getElementById('app');
        if (app) {
          const fetchedApp = doc.getElementById('app');
          // If the fetched page has its own #app container, use its innerHTML.
          // Otherwise fallback to the whole body content.
          app.innerHTML = fetchedApp ? fetchedApp.innerHTML : doc.body.innerHTML;
        }
      })
      .catch((err) => console.error('Failed to load page', path, err));
  }

  // Initial load based on current hash or default to dashboard
  const initialHash = location.hash || '#dashboard';
  loadPage(routes[initialHash] || routes['#dashboard']);

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    const hash = location.hash;
    const path = routes[hash];
    if (path) {
      loadPage(path);
    }
  });

  // Set up navigation link click handling (prevent default full reload)
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A') {
      const href = (target as HTMLAnchorElement).getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        location.hash = href;
      }
    }
  });
}
