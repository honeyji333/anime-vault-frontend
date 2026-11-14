// Keep SPA page titles and metadata useful when a crawler or visitor changes routes.
(() => {
  const SITE_NAME = 'AnimeVault';
  const BASE_DESCRIPTION = 'Explore anime, movies, and series in the AnimeVault catalog. Browse titles, genres, episode details, and available video sources.';
  const app = document.getElementById('app');
  if (!app) return;

  function ensureMeta(selector, attributes) {
    let element = document.head.querySelector(selector);
    if (!element) {
      element = document.createElement('meta');
      document.head.appendChild(element);
    }
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function updateSeo() {
    const pathname = window.location.pathname || '/';
    const route = pathname.replace(/\/$/, '') || '/';
    const heading = app.querySelector('h1');
    const headingText = heading?.textContent?.replace(/\s+/g, ' ').trim();
    let title = `${SITE_NAME} — Explore Anime, Movies & Series`;
    let description = BASE_DESCRIPTION;
    let noIndex = false;

    if (route.startsWith('/anime/')) {
      const animeName = app.querySelector('.anime-detail-info h1')?.textContent?.trim() || headingText;
      const summary = app.querySelector('.anime-detail-description')?.textContent?.replace(/\s+/g, ' ').trim();
      if (animeName) title = `${animeName} — ${SITE_NAME}`;
      if (summary && summary !== 'No description available.') description = summary.slice(0, 300);
    } else if (route.startsWith('/watch/')) {
      title = headingText ? `${headingText} — ${SITE_NAME}` : `Episode player — ${SITE_NAME}`;
      description = 'Episode information and available video sources.';
      noIndex = true;
    } else if (route === '/browse') {
      title = `Browse Anime, Movies & Series — ${SITE_NAME}`;
      description = 'Browse the AnimeVault catalog by title, genre, format, year, and status.';
    } else if (route === '/genres') {
      title = `Anime Genres — ${SITE_NAME}`;
      description = 'Explore anime and series in the AnimeVault catalog by genre.';
    } else if (['/profile', '/watchlist', '/favorites', '/history'].includes(route)) {
      title = `${headingText || 'Your account'} — ${SITE_NAME}`;
      description = 'Your personal AnimeVault account page.';
      noIndex = true;
    }

    document.title = title;
    ensureMeta('meta[name="description"]', { name: 'description', content: description });
    ensureMeta('meta[name="robots"]', { name: 'robots', content: noIndex ? 'noindex,follow' : 'index,follow' });
    ensureMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE_NAME });
    ensureMeta('meta[property="og:title"]', { property: 'og:title', content: title });
    ensureMeta('meta[property="og:description"]', { property: 'og:description', content: description });

    const canonical = document.head.querySelector('link[rel="canonical"]') || document.createElement('link');
    let canonicalOrigin = window.location.origin;
    try {
      canonicalOrigin = new URL(canonical.href).origin;
    } catch {
      // Keep the current host when the server did not provide a canonical URL.
    }
    canonical.rel = 'canonical';
    canonical.href = `${canonicalOrigin}${route === '/' ? '/' : route}`;
    if (!canonical.isConnected) document.head.appendChild(canonical);
    ensureMeta('meta[property="og:url"]', { property: 'og:url', content: canonical.href });
  }

  const observer = new MutationObserver(updateSeo);
  observer.observe(app, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', updateSeo);
  updateSeo();
})();
