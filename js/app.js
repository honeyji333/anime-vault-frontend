// ===== AnimeVault — Full SPA JavaScript =====

// State
let currentUser = null;
let searchTimeout = null;
let heroInterval = null;
let currentHeroSlide = 0;

// ===== Configurable API Base (Split Frontend/Backend Architecture) =====
const API_BASE = (function() {
  if (typeof window !== 'undefined' && window.ANIME_VAULT_API_BASE) {
    return window.ANIME_VAULT_API_BASE;
  }
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    return '';
  }
  return window.ANIME_VAULT_API_BASE || 'https://animevault-vwo3.onrender.com';
})();

// ===== API Helper =====
async function api(endpoint, options = {}) {
  const { headers, ...restOptions } = options;
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}/api${endpoint}`;
  const res = await fetch(url, {
    credentials: 'include',
    ...restOptions,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ===== Toast =====
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===== Router =====
window.closeNavDropdowns = function() {
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
};

window.toggleNavDropdown = function(btn, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const parent = btn.closest('.nav-dropdown');
  if (!parent) return;
  const wasOpen = parent.classList.contains('open');
  closeNavDropdowns();
  if (!wasOpen) {
    parent.classList.add('open');
  }
};

document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-dropdown')) {
    closeNavDropdowns();
  }
});

function navigateTo(path) {
  closeNavDropdowns();
  if (typeof window._saveWatchProgressBeforeNav === 'function') {
    try { window._saveWatchProgressBeforeNav(); } catch (e) {}
  }
  if (typeof adminAutoRefreshTimer !== 'undefined' && adminAutoRefreshTimer && path !== '/admin') {
    clearInterval(adminAutoRefreshTimer);
    adminAutoRefreshTimer = null;
  }
  history.pushState({}, '', path);
  handleRoute();
}

window.addEventListener('beforeunload', () => {
  if (typeof window._saveWatchProgressBeforeNav === 'function') {
    try { window._saveWatchProgressBeforeNav(); } catch (e) {}
  }
});
window.addEventListener('pagehide', () => {
  if (typeof window._saveWatchProgressBeforeNav === 'function') {
    try { window._saveWatchProgressBeforeNav(); } catch (e) {}
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && typeof window._saveWatchProgressBeforeNav === 'function') {
    try { window._saveWatchProgressBeforeNav(); } catch (e) {}
  }
});

// ===== AniSurge Watched Episodes Tracker =====
function getWatchedEpisodesSet() {
  try {
    const raw = localStorage.getItem('anime_watched_episodes');
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    return new Set();
  }
}

function markEpisodeWatched(episodeId) {
  if (!episodeId) return;
  const numId = Number(episodeId);
  const set = getWatchedEpisodesSet();
  if (!set.has(numId)) {
    set.add(numId);
    try {
      localStorage.setItem('anime_watched_episodes', JSON.stringify(Array.from(set)));
    } catch (e) {}
  }
}

function isEpisodeWatched(episodeId, serverWatchedIds = []) {
  if (!episodeId) return false;
  const numId = Number(episodeId);
  if (Array.isArray(serverWatchedIds) && serverWatchedIds.map(Number).includes(numId)) return true;
  return getWatchedEpisodesSet().has(numId);
}

// ===== Guest-to-Cloud Watch History & Progress Auto-Sync =====
async function syncGuestHistoryToCloud() {
  if (!currentUser) return;
  try {
    const watchedSet = getWatchedEpisodesSet();
    const guestHistory = JSON.parse(localStorage.getItem('anime_guest_history') || '[]');
    const episodesToSync = [];
    const seenIds = new Set();

    // 1. Add detailed guest history entries
    for (const item of guestHistory) {
      if (item && item.episode_id && !seenIds.has(Number(item.episode_id))) {
        seenIds.add(Number(item.episode_id));
        const prog = Number(item.progress_seconds) || Number(localStorage.getItem(`anime_prog_${item.episode_id}`) || 0);
        episodesToSync.push({
          episode_id: Number(item.episode_id),
          progress_seconds: prog
        });
      }
    }

    // 2. Add any other watched episode IDs from set
    for (const epId of watchedSet) {
      const numId = Number(epId);
      if (numId && !seenIds.has(numId)) {
        seenIds.add(numId);
        const prog = Number(localStorage.getItem(`anime_prog_${numId}`) || 0);
        episodesToSync.push({
          episode_id: numId,
          progress_seconds: prog
        });
      }
    }

    // Send batch sync to server
    if (episodesToSync.length > 0) {
      const res = await api('/user/history/sync', {
        method: 'POST',
        body: JSON.stringify({ episodes: episodesToSync })
      });
      if (res?.success && res.synced > 0) {
        console.log(`[Sync] Merged ${res.synced} offline guest episode(s) to cloud account.`);
      }
    }

    // Two-way sync: Pull user's full cloud history so all watched tick marks light up on any device!
    const cloudRes = await api('/user/history').catch(() => null);
    if (cloudRes?.data && Array.isArray(cloudRes.data)) {
      cloudRes.data.forEach(h => {
        if (h.episode_id) markEpisodeWatched(h.episode_id);
      });
    }
  } catch (err) {
    console.warn('[Sync] Offline guest history sync skipped or failed:', err);
  }
}

// ===== OffAnime Symmetrical Landing Gateway Page =====
function renderLandingPage() {
  const app = document.getElementById('app');
  document.getElementById('navbar')?.classList.add('navbar-transparent');

  app.innerHTML = `
    <div class="landing-gateway">
      <!-- Emerald ambient lights fading lighter towards corners -->
      <div class="landing-corner-glow glow-tl"></div>
      <div class="landing-corner-glow glow-tr"></div>
      <div class="landing-corner-glow glow-bl"></div>
      <div class="landing-corner-glow glow-br"></div>

      <!-- Cool Guy Manga Sketch in Center -->
      <div class="landing-character-wrap">
        <img src="/images/gateway-character.jpg?v=6.3.0" alt="Manga Character" class="landing-character-img" loading="eager" onerror="this.src='/images/a442e0f70e07279feacf1d6be1856854.jpg'">
      </div>

      <!-- Center Gateway Interactive Elements -->
      <div class="landing-center-box">
        <!-- Logo / Stylized Emblem like OffAnime -->
        <div class="landing-logo-wrap">
          <img src="/images/logo-emblem.png" alt="AnimeVault Logo" class="landing-center-emblem">
          <div class="landing-logo-title">
            <span class="logo-off">Anime</span><span class="logo-anime">Vault</span>
            <span class="landing-version-pill">v2.0</span>
          </div>
        </div>

        <!-- CONTINUE TO SITE Button -->
        <button class="landing-continue-btn" onclick="navigateTo('/anime')" id="landing-continue-btn">
          <span>CONTINUE TO SITE</span>
          <i class="fas fa-arrow-right"></i>
        </button>

        <!-- Gateway Route Cards: 2x2 Symmetrical Quadrant Grid -->
        <!-- Left: Anime & Vault Toons | Right: Movies & Shows & Asian Dramas -->
        <div class="landing-cards-row">
          <div class="landing-card card-anime" onclick="navigateTo('/anime')">
            <div class="landing-card-icon"><i class="fas fa-tv" style="color:var(--accent);"></i></div>
            <div class="landing-card-text">
              <span class="landing-card-head" style="color:var(--accent);">ANIME</span>
              <span class="landing-card-desc">Browse full catalogue</span>
            </div>
            <i class="fas fa-arrow-right landing-card-arrow"></i>
          </div>

          <div class="landing-card card-toons" onclick="navigateTo('/toons')">
            <div class="landing-card-icon"><i class="fas fa-play-circle" style="color:#38bdf8;"></i></div>
            <div class="landing-card-text">
              <span class="landing-card-head" style="color:#38bdf8;">VAULT TOONS</span>
              <span class="landing-card-desc">Hindi Dubs & Cartoons</span>
            </div>
            <i class="fas fa-arrow-right landing-card-arrow"></i>
          </div>

          <div class="landing-card card-movies" onclick="navigateTo('/browse?type=Movie')">
            <div class="landing-card-icon"><i class="fas fa-film" style="color:#a855f7;"></i></div>
            <div class="landing-card-text">
              <span class="landing-card-head" style="color:#c084fc;">MOVIES & SHOWS</span>
              <span class="landing-card-desc">Bollywood & Hollywood</span>
            </div>
            <i class="fas fa-arrow-right landing-card-arrow"></i>
          </div>

          <div class="landing-card card-dramas" onclick="navigateTo('/browse?category=kdrama')">
            <div class="landing-card-icon"><i class="fas fa-heart" style="color:#f43f5e;"></i></div>
            <div class="landing-card-text">
              <span class="landing-card-head" style="color:#f43f5e;">ASIAN DRAMAS</span>
              <span class="landing-card-desc">K-Dramas & C-Dramas</span>
            </div>
            <i class="fas fa-arrow-right landing-card-arrow"></i>
          </div>
        </div>

        <!-- Social Community Buttons -->
        <div class="landing-social-row">
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" class="landing-social-btn" title="Instagram">
            <i class="fab fa-instagram"></i>
          </a>
          <a href="https://discord.com" target="_blank" rel="noopener noreferrer" class="landing-social-btn" title="Discord">
            <i class="fab fa-discord"></i>
          </a>
          <a href="https://reddit.com" target="_blank" rel="noopener noreferrer" class="landing-social-btn" title="Reddit">
            <i class="fab fa-reddit-alien"></i>
          </a>
        </div>
      </div>
    </div>
  `;
}

window.addEventListener('popstate', handleRoute);

function handleRoute() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const app = document.getElementById('app');

  // Clear hero interval when navigating away from streaming home
  if (heroInterval && path !== '/anime' && path !== '/home') {
    clearInterval(heroInterval);
    heroInterval = null;
  }

  // Update nav active states
  document.querySelectorAll('.nav-link[data-page]').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.mobile-bar-item').forEach(b => b.classList.remove('active'));

  const navEl = document.getElementById('navbar');

  if (path === '/' || path === '') {
    navEl?.classList.add('navbar-transparent');
    document.querySelector('.nav-link[data-page="home"]')?.classList.add('active');
    document.querySelector('.mobile-bar-item[data-page="home"]')?.classList.add('active');
    renderLandingPage();
  } else {
    navEl?.classList.remove('navbar-transparent');
    if (path === '/anime' || path === '/home') {
      document.querySelector('.nav-link[data-page="anime"]')?.classList.add('active');
      document.querySelector('.mobile-bar-item[data-page="anime"]')?.classList.add('active');
      renderHomePage();
    } else if (path === '/toons') {
      document.querySelector('.nav-link[data-page="toons"]')?.classList.add('active');
      document.querySelector('.mobile-bar-item[data-page="toons"]')?.classList.add('active');
      renderToonsPage();
    } else if (path.startsWith('/toons/series/')) {
      const slug = path.split('/toons/series/')[1];
      document.querySelector('.nav-link[data-page="toons"]')?.classList.add('active');
      renderToonSeriesPage(slug);
    } else if (path.startsWith('/toons/watch/')) {
      const slug = path.split('/toons/watch/')[1];
      document.querySelector('.nav-link[data-page="toons"]')?.classList.add('active');
      renderToonWatchPage(slug);
    } else if (path === '/browse') {
      const typeParam = (params.get('type') || '').toLowerCase();
      const genreParam = params.get('genre');
      if (typeParam === 'movie' || typeParam === 'animemovie') {
        document.querySelector('.nav-link[data-page="movies"]')?.classList.add('active');
        document.querySelector('.mobile-bar-item[data-page="movies"]')?.classList.add('active');
      } else if (params.get('dub') === 'hindi') {
        document.querySelector('.nav-link[data-page="hindi-dub"]')?.classList.add('active');
        document.querySelector('.mobile-bar-item[data-page="hindi-dub"]')?.classList.add('active');
      } else if (genreParam) {
        document.querySelector('.nav-link[data-page="genres"]')?.classList.add('active');
      } else if (typeParam) {
        document.querySelector('.nav-link[data-page="types"]')?.classList.add('active');
      } else {
        document.querySelector('.nav-link[data-page="browse"]')?.classList.add('active');
      }
      renderBrowsePage(params);
    } else if (path === '/genres') {
      document.querySelector('.nav-link[data-page="genres"]')?.classList.add('active');
      renderGenresPage();
  } else if (path.startsWith('/anime/')) {
    const slug = path.split('/anime/')[1];
    renderAnimeDetail(slug);
  } else if (path.startsWith('/watch/')) {
    const epId = path.split('/watch/')[1];
    renderWatchPage(epId);
  } else if (path === '/profile') {
    renderProfilePage();
  } else if (path === '/watchlist') {
    document.querySelector('.mobile-bar-item[data-page="watchlist"]')?.classList.add('active');
    renderWatchlistPage();
  } else if (path === '/favorites') {
    renderFavoritesPage();
  } else if (path === '/history') {
    renderHistoryPage();
  } else if (path === '/admin') {
    renderAdminPage();
  } else {
    app.innerHTML = `<div class="empty-state"><i class="fas fa-ghost"></i><h3>404 — Page Not Found</h3><p>The page you're looking for doesn't exist.</p><button class="btn btn-primary" onclick="navigateTo('/')">Go Home</button></div>`;
  }
  }

  window.scrollTo(0, 0);
}

// ===== HINDI DUBBED ANIME & CINEMA REGISTRY =====
const HINDI_DUBBED_SLUGS = new Set([
  'naruto', 'naruto-classic', 'naruto-shippuden', 'dragon-ball', 'dragon-ball-z', 'dragon-ball-super', 'dragon-ball-daima',
  'fairy-tail', 'fairy-tail-hindi', 'demon-slayer', 'demon-slayer-mugen-train',
  'jujutsu-kaisen', 'chainsaw-man', 'my-hero-academia', 'solo-leveling', 'solo-leveling-season-2',
  'spy-x-family', 'one-punch-man', 'attack-on-titan', 'death-note', 'tokyo-revengers',
  'black-clover-sword-of-the-wizard-king', 'kaiju-no-8', 'dan-da-dan', 'bleach-classic', 'bleach-tybw', 'bleach-tybw-part-3',
  'dr-stone', 'vinland-saga', 'vinland-saga-season-2', 'hells-paradise',
  'classroom-of-the-elite', 'delicious-in-dungeon', 'shangri-la-frontier',
  'blue-lock', 'mashle', 'wind-breaker', 'the-apothecary-diaries', 'ranma-1-2-2024',
  'blue-box', 'pluto', 'tower-of-god', 'beyblade', 'ben-10-alien-force', 'hunter-x-hunter', 'tokyo-ghoul',
  'your-name', 'suzume', 'weathering-with-you', 'spirited-away', 'howls-moving-castle', 'a-silent-voice',
  'jujutsu-kaisen-0', 'dragon-ball-super-super-hero', 'dragon-ball-super-broly',
  'avengers-endgame', 'avengers-infinity-war', 'the-dark-knight', 'inception', 'interstellar',
  'deadpool-wolverine', 'avatar-the-way-of-water', 'dune-part-two', 'oppenheimer', 'spider-man-no-way-home',
  '3-idiots', 'dangal', 'sholay', 'jawan', 'pathaan', 'stree-2', 'kalki-2898-ad', 'rrr',
  'kgf-chapter-2', 'pushpa-the-rise', 'pushpa-2-the-rule', 'salaar', 'baahubali-2-the-conclusion',
  'scam-1992', 'mirzapur', 'sacred-games', 'panchayat', 'the-family-man', 'farzi', 'the-great-indian-kapil-show',
  'squid-game', 'all-of-us-are-dead', 'the-glory', 'crash-landing-on-you', 'vincenzo', 'queen-of-tears',
  'the-vvaan-force-of-the-forrest-2026'
]);

const INDIAN_STUDIOS = [
  'bollywood', 'yash raj', 'dharma', 't-series', 'red chillies', 'excel entertainment',
  'nadiadwala', 'maddock', 'phantom films', 'balaji', 'aamir khan', 'eros', 'utv',
  'hombale', 'mythri', 'geetha arts', 'arka media', 'vyjayanthi', 'sun pictures',
  'lyca', 'zee studios', 'junglee', 'reliance entertainment', 'svf', 'cinema motion'
];

const INDIAN_SLUGS = new Set([
  '3-idiots', 'dangal', 'sholay', 'jawan', 'pathaan', 'stree-2', 'kalki-2898-ad', 'rrr',
  'kgf-chapter-1', 'kgf-chapter-2', 'pushpa-the-rise', 'pushpa-2-the-rule', 'salaar',
  'baahubali-the-beginning', 'baahubali-2-the-conclusion', 'animal', 'rockstar', 'queen',
  'chhappan-chhuriyan', 'brahmastra', 'fighter', 'war', 'kabir-singh', 'drishyam', 'drishyam-2',
  'munna-bhai-mbbs', 'lage-raho-munna-bhai', 'pk', 'bajrangi-bhaijaan', 'sultan', 'tiger-3',
  'gadar-2', 'om-shanti-om', 'chennai-express', 'dilwale-dulhania-le-jayenge', 'lagaan',
  'swades', 'chak-de-india', 'taare-zameen-par', 'barfi', 'zindagi-na-milegi-dobara',
  'scam-1992', 'scam-2003-the-telgi-story', 'mirzapur', 'sacred-games', 'panchayat',
  'the-family-man', 'farzi', 'paatal-lok', 'kota-factory', 'asur', 'gullak', 'delhi-crime',
  'guns-and-gulaabs', 'taaza-khabar', 'special-ops', 'the-great-indian-kapil-show',
  'indias-got-latent-samay-raina', 'rocket-boys', 'breathe', 'kaala-paani', 'kohrra',
  'scoop', 'aspirants', 'yeh-meri-family', 'jamtara', 'the-vvaan-force-of-the-forrest-2026',
  'dhindora', 'dhindora-season-2'
]);

function isIndianTitle(ep) {
  if (!ep) return false;
  const slug = ep.anime_slug || '';
  if (INDIAN_SLUGS.has(slug) || slug.includes('vvaan') || slug.includes('kapil') || slug.includes('latent') || slug.includes('scam') || slug.includes('mirzapur') || slug.includes('dhindora')) return true;
  const studio = (ep.studio || '').toLowerCase();
  if (INDIAN_STUDIOS.some(s => studio.includes(s))) return true;
  if (ep.audio_language === 'Hindi') return true;
  return false;
}

// Vault Toons Hindi Dub provider slugs & officially dubbed batch limits
const TOONS_HINDI_SLUGS = new Set([
  'naruto',
  'naruto-classic',
  'naruto-shippuden',
  'tokyo-revengers',
  'jujutsu-kaisen',
  'demon-slayer',
  'demon-slayer-kimetsu-no-yaiba',
  'attack-on-titan',
  'one-punch-man',
  'hunter-x-hunter',
  'tokyo-ghoul',
  'blue-lock',
  'chainsaw-man',
  'wind-breaker',
  'solo-leveling',
  'bleach-classic',
  'bleach',
  'beyblade',
  'ben-10-alien-force'
]);

const TOONS_MAX_HINDI_EPS = {
  'naruto': 52,
  'naruto-classic': 52,
  'naruto-shippuden': 32,
  'tokyo-revengers': 24,
  'jujutsu-kaisen': 18,
  'demon-slayer': 26,
  'demon-slayer-kimetsu-no-yaiba': 26,
  'attack-on-titan': 25,
  'one-punch-man': 12,
  'hunter-x-hunter': 62,
  'tokyo-ghoul': 12,
  'blue-lock': 24,
  'chainsaw-man': 12,
  'wind-breaker': 13,
  'solo-leveling': 12,
  'bleach-classic': 91,
  'bleach': 91,
  'beyblade': 51,
  'ben-10-alien-force': 13
};

// ===== STREAMING PROVIDERS REGISTRY (MULTI-SERVER ULTRA ARCHITECTURE) =====
const ANIME_SERVERS = [
  {
    id: 'hindi-toons',
    name: 'Hindi Dub HD',
    badge: '🇮🇳 1080p',
    provider: 'Vault Toons Ultra Hindi Dub',
    audio: ['hindi'],
    build: ({ animeSlug, episode }) => {
      const slug = animeSlug || 'naruto';
      return `/api/toons/embed/${slug}/${episode}`;
    }
  },
  {
    id: 'vidlink-anime',
    name: 'VidLink PRO',
    badge: '4K UHD',
    provider: 'VidLink Pro Ultra HD (Multi-Audio)',
    audio: ['sub', 'dub', 'hindi'],
    build: ({ anilistId, malId, tmdbId, episode, tmdbEpisode, season, isMovie, audio }) => {
      const langParam = audio === 'hindi' ? '&multi=true&lang=hi' : '';
      if (tmdbId) {
        return isMovie
          ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=8b5cf6&secondaryColor=10b981&iconColor=8b5cf6&autoplay=false${langParam}`
          : `https://vidlink.pro/tv/${tmdbId}/${season || 1}/${tmdbEpisode || episode}?primaryColor=8b5cf6&secondaryColor=10b981&iconColor=8b5cf6&autoplay=false${langParam}`;
      }
      const track = audio === 'sub' ? 'sub' : 'dub';
      const type = anilistId ? 'ani' : 'mal';
      const id = anilistId || malId || 21;
      return `/api/player/embed?type=${type}&id=${id}&ep=${episode}&track=${track}&accent=8b5cf6&autoSkip=1`;
    }
  },
  {
    id: 'vidcore-anime',
    name: 'VidCore 4K',
    badge: 'STABLE HD',
    provider: 'VidCore Ultra HD',
    audio: ['sub', 'dub'],
    build: ({ anilistId, malId, tmdbId, episode, tmdbEpisode, season, isMovie }) => {
      if (tmdbId) {
        return isMovie
          ? `https://vidcore.org/embed/movie/${tmdbId}?theme=8b5cf6`
          : `https://vidcore.org/embed/tv/${tmdbId}/${season || 1}/${tmdbEpisode || episode}?theme=8b5cf6`;
      }
      const id = anilistId || malId || 21;
      return `/api/player/embed?type=ani&id=${id}&ep=${episode}&accent=8b5cf6&autoSkip=1`;
    }
  },
  {
    id: 'autoembed-anime',
    name: 'AutoEmbed',
    badge: 'UHD PRO',
    provider: 'AutoEmbed Direct Global',
    audio: ['sub', 'dub'],
    build: ({ anilistId, malId, tmdbId, episode, tmdbEpisode, season, isMovie }) => {
      if (tmdbId) {
        return isMovie
          ? `https://player.autoembed.me/embed/movie/${tmdbId}`
          : `https://player.autoembed.me/embed/tv/${tmdbId}/${season || 1}/${tmdbEpisode || episode}/`;
      }
      const id = anilistId || malId || 21;
      return `/api/player/embed?type=ani&id=${id}&ep=${episode}&accent=8b5cf6&autoSkip=1`;
    }
  },
  {
    id: 'two-embed',
    name: '2Embed',
    badge: 'MULTI-CDN',
    provider: '2Embed Global Stream',
    audio: ['sub', 'dub'],
    build: ({ anilistId, malId, tmdbId, episode, tmdbEpisode, season, isMovie, audio }) => {
      if (tmdbId) {
        return isMovie
          ? `https://www.2embed.cc/embed/${tmdbId}`
          : `https://www.2embed.cc/embedtv/${tmdbId}&s=${season || 1}&e=${tmdbEpisode || episode}`;
      }
      const track = audio === 'sub' ? 'sub' : 'dub';
      const type = malId ? 'mal' : 'ani';
      const id = malId || anilistId || 21;
      return `/api/player/embed?type=${type}&id=${id}&ep=${episode}&track=${track}&accent=8b5cf6&autoSkip=1`;
    }
  },
  {
    id: 'animeembed',
    name: 'Vidstream',
    badge: 'FAST HD',
    provider: 'Vidstream Direct HD',
    audio: ['sub', 'dub'],
    build: ({ anilistId, malId, episode, audio }) => {
      const track = audio === 'sub' ? 'sub' : 'dub';
      const type = anilistId ? 'ani' : 'mal';
      const id = anilistId || malId || 21;
      return `https://animeembed.com/embed/${type}/${id}/${episode}?track=${track}&accent=8b5cf6&autoSkip=1`;
    }
  },
  {
    id: 'animeembed-mal',
    name: 'MegaCloud',
    badge: 'MIRROR',
    provider: 'MegaCloud Direct HD',
    audio: ['sub', 'dub'],
    build: ({ anilistId, malId, episode, audio }) => {
      const track = audio === 'sub' ? 'sub' : 'dub';
      const type = malId ? 'mal' : 'ani';
      const id = malId || anilistId || 21;
      return `https://animeembed.com/embed/${type}/${id}/${episode}?track=${track}&accent=8b5cf6&autoSkip=1`;
    }
  }
];

// Web Series & Movies TMDB streaming providers (Clean, Fast, 4K UHD, Zero Adult Popups)
const WEBSERIES_SERVERS = [
  {
    id: 'hindi-multi-uhd',
    name: 'Server 1 (Hindi Dub 4K)',
    badge: '🇮🇳 4K HINDI',
    provider: 'VidLink Multi-Audio Ultra HD (Hindi Default)',
    audio: ['hindi', 'dub', 'sub'],
    build: ({ tmdbId, season, episode, isMovie, audio }) => {
      const langParam = audio === 'hindi' ? '&multi=true&lang=hi' : (audio === 'sub' ? '&multi=true' : '');
      return isMovie
        ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=8b5cf6&secondaryColor=10b981&iconColor=8b5cf6&autoplay=false${langParam}`
        : `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}?primaryColor=8b5cf6&secondaryColor=10b981&iconColor=8b5cf6&autoplay=false${langParam}`;
    }
  },
  {
    id: 'vidcore-tv',
    name: 'Server 2 (4K UHD)',
    badge: '4K UHD',
    provider: 'VidCore Ultra HD',
    audio: ['sub', 'dub'],
    build: ({ tmdbId, season, episode, isMovie }) =>
      isMovie
        ? `https://vidcore.org/embed/movie/${tmdbId}?theme=8b5cf6`
        : `https://vidcore.org/embed/tv/${tmdbId}/${season}/${episode}?theme=8b5cf6`
  },
  {
    id: 'autoembed-direct',
    name: 'Server 3 (PRO)',
    badge: 'UHD PRO',
    provider: 'AutoEmbed Direct',
    audio: ['sub', 'dub'],
    build: ({ tmdbId, season, episode, isMovie }) =>
      isMovie
        ? `https://player.autoembed.me/embed/movie/${tmdbId}`
        : `https://player.autoembed.me/embed/tv/${tmdbId}/${season}/${episode}/`
  },
  {
    id: '2embed-skin',
    name: 'Server 4 (Multi-Audio)',
    badge: 'MULTI-AUDIO',
    provider: '2Embed Ultra HD Multi-Audio',
    audio: ['hindi', 'dub', 'sub'],
    build: ({ tmdbId, season, episode, isMovie }) =>
      isMovie
        ? `https://www.2embed.skin/movie/${tmdbId}`
        : `https://www.2embed.skin/tv/${tmdbId}&s=${season}&e=${episode}`
  },
  {
    id: '2embed-cc',
    name: 'Server 5 (FAST)',
    badge: 'FAST STREAM',
    provider: '2Embed Global Stream',
    audio: ['sub', 'dub'],
    build: ({ tmdbId, season, episode, isMovie }) =>
      isMovie
        ? `https://www.2embed.cc/embed/${tmdbId}`
        : `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`
  },
  {
    id: 'vidlink-tv',
    name: 'Server 6 (2K HD)',
    badge: '2K HD',
    provider: 'VidLink Pro Ultra',
    audio: ['sub', 'dub'],
    build: ({ tmdbId, season, episode, isMovie }) =>
      isMovie
        ? `https://vidlink.pro/movie/${tmdbId}?primaryColor=8b5cf6`
        : `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}?primaryColor=8b5cf6`
  }
];

// ===== MOBILE & SMART TV DEVICE DETECTOR =====
function isMobileOrTVDevice() {
  if (typeof window === 'undefined') return false;
  const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
  const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|crios|silk/i.test(ua);
  const isTV = /smart-tv|smarttv|googletv|appletv|hbbtv|pov_tv|netcast|viera|bravia|tizen|web0s|roku|firetv|androidtv|crkey/i.test(ua);
  const isSmallTouch = (window.innerWidth <= 840) && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
  return isMobile || isTV || isSmallTouch;
}

function isFullscreenActive() {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    (typeof window !== 'undefined' && window.fullScreen)
  );
}

// ===== ANTI-NUDITY & MALICIOUS AD NETWORK BLOCKLIST =====
function isAdultOrMaliciousAdUrl(url) {
  if (!url) return false;
  const u = String(url).toLowerCase();
  const BAD_TERMS = [
    'exoclick', 'adsterra', 'trafficjunky', 'trafficstars', 'ero-advertising',
    'juicyads', 'clickadu', 'hilltopads', 'monetag', 'galaksion', 'richpush',
    'admaven', 'evadav', 'rollerads', 'realsrv', 'syndication', 'tsyndicate',
    'etahub', 'bngpt', 'stripchat', 'bongacams', 'chaturbate', 'livejasmin',
    'abscloud', 'tagivi', 'whos.amung.us', 'doublepimp', 'popads', 'propeller',
    'adult', 'porn', 'sex', 'nude', 'nudity', 'dating', 'hookup', 'cams', 'xxx', 'ero',
    'bet365', '1xbet', 'casino', 'vulkan', 'parimatch', 'stake', 'dirty', 'horny',
    'escort', 'webcam', 'teen', 'taboola', 'outbrain', 'mgid', 'push', 'clicknu',
    'playboy', 'hentai', 'xhamster', 'xvideos', 'pornhub', 'redtube', 'youporn',
    'offanime.cc'
  ];
  return BAD_TERMS.some(t => u.includes(t));
}

// Page-level popup & redirect guard (100% Zero-Tolerance Anti-Adult & Anti-Popup Shield)
let popupGuardInstalled = false;

function isExplicitUserAllowed(url) {
  if (!url) return false;
  if (isAdultOrMaliciousAdUrl(url)) return false;
  try {
    const u = new URL(url, window.location.href);
    if (u.hostname === window.location.hostname) return true;
    if (u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com' || u.hostname === 'youtu.be' || u.hostname === 'www.youtube-nocookie.com') return true;
    if (u.hostname === 'vimeo.com' || u.hostname === 'player.vimeo.com') return true;
    return false;
  } catch {
    return false;
  }
}

function attachPlayerClickGate() {
  // Purged: Zero click gates to prevent any unwanted popup triggers
  const oldGate = document.getElementById('player-click-gate');
  if (oldGate) oldGate.remove();
}

function installPopupGuard() {
  if (popupGuardInstalled || typeof window === 'undefined') return;
  popupGuardInstalled = true;

  // 1. Intercept and kill all window.open calls from rogue scripts or embeds
  window.open = function(url) {
    if (isExplicitUserAllowed(url)) {
      return window;
    }
    console.warn('🛡️ [ZeroPopup Shield] Blocked external popup attempt to:', url);
    return {
      closed: true,
      close() {},
      focus() {},
      blur() {},
      location: { set href(v){}, get href(){return '';}, replace(){}, assign(){} },
      document: { write(){}, close(){}, body:{} }
    };
  };

  // 2. Intercept clicks to block adult and unauthorized target=_blank popups
  window.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const a = target.closest?.('a[href]');
    if (a) {
      if (isAdultOrMaliciousAdUrl(a.href)) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🛡️ [ZeroPopup Shield] Blocked click to adult/ad URL:', a.href);
        return;
      }
      if (a.target === '_blank' && !isExplicitUserAllowed(a.href)) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('🛡️ [ZeroPopup Shield] Blocked rogue external link:', a.href);
        return;
      }
    }
  }, true);

  // 3. Monitor Fullscreen changes
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
    document.addEventListener(evt, () => {
      const gate = document.getElementById('player-click-gate');
      if (gate) gate.remove();
    });
  });

  window.popupManager = {
    getStatus: () => ({ allowed: false, zeroPopupPolicy: true }),
    resetCooldown: () => {},
    setUrl: () => {}
  };
}

// Helpers for 100-episode ranges
function calcEpisodeRange(epNum, total, step = 100) {
  const num = Math.max(1, Number(epNum) || 1);
  const tot = Math.max(1, Number(total) || 1);
  const start = Math.floor((num - 1) / step) * step + 1;
  const end = Math.min(start + step - 1, tot);
  return [start, end];
}

function generateEpisodeRanges(total, step = 100) {
  const ranges = [];
  const tot = Math.max(1, Number(total) || 1);
  for (let i = 0; i < tot; i += step) {
    ranges.push([i + 1, Math.min(i + step, tot)]);
  }
  return ranges;
}

// ===== Card Renderer =====
function displayAnimeType(animeOrType, category = null) {
  if (typeof animeOrType === 'object' && animeOrType !== null) {
    const t = animeOrType.type;
    const cat = animeOrType.category;
    if (cat === 'kdrama') return 'K-Drama';
    if (cat === 'cdrama') return 'C-Drama';
    const isAnime = cat === 'anime' || Boolean(animeOrType.anilist_id) || Boolean(animeOrType.mal_id);
    if (t === 'Movie' || t === 'AnimeMovie') {
      return isAnime ? 'Anime Movie' : 'Movie';
    }
    if (t === 'ONA') {
      return cat === 'series' || animeOrType.tmdb_id ? 'Web Series' : 'ONA';
    }
    return t || 'TV';
  }
  const type = animeOrType;
  if (category === 'kdrama') return 'K-Drama';
  if (category === 'cdrama') return 'C-Drama';
  if (type === 'AnimeMovie') return 'Anime Movie';
  if (type === 'Movie') return category === 'anime' ? 'Anime Movie' : 'Movie';
  if (type === 'ONA') return 'Web Series';
  return type || 'TV';
}

function renderAnimeCard(anime) {
  const showStatus = anime.anime_status || anime.status || 'Completed';
  const watchlistStatus = anime.anime_status ? anime.status : null;
  const formatWatchlistStatus = (st) => (st ? st.replace(/_/g, ' ') : '');
  const typeLabel = displayAnimeType(anime);
  const isAnyMovie = anime.type === 'Movie' || anime.type === 'AnimeMovie';

  return `
    <div class="anime-card" onclick="navigateTo('/anime/${anime.slug}')">
      <div class="anime-card-image">
        <img src="${anime.cover_image}" alt="${anime.title}" loading="lazy"
             onerror="this.src='https://via.placeholder.com/300x420/1a1a2e/8b5cf6?text=${encodeURIComponent(anime.title)}'">
        <div class="anime-card-overlay">
          <div class="anime-card-play"><i class="fas fa-play"></i></div>
        </div>
        <div class="anime-card-badges">
          <span class="badge badge-sub">${typeLabel}</span>
          ${Boolean(anime.is_auto_discovered) ? `<span class="badge" style="background:rgba(16, 185, 129, 0.25);color:#34d399;border:1px solid rgba(16, 185, 129, 0.45);"><i class="fas fa-bolt"></i> DISCOVERED</span>` : ''}
          ${(anime.slug === 'spider-man-across-the-spider-verse' || (anime.duration && anime.duration.includes('4K'))) ? `<span class="badge" style="background:linear-gradient(135deg, #a855f7, #ec4899);color:#fff;font-weight:800;letter-spacing:0.5px;"><i class="fas fa-sparkles"></i> 4K UHD</span>` : ''}
          ${Boolean(anime.has_hindi_dub || HINDI_DUBBED_SLUGS.has(anime.slug)) ? `<span class="badge badge-hindi"><i class="fas fa-flag" style="font-size:0.65rem;"></i> HINDI DUB</span>` : ''}
          ${anime.episodes_count ? `<span class="badge badge-ep">${isAnyMovie ? (typeLabel === 'Anime Movie' ? 'ANIME FILM' : 'MOVIE') : `EP ${anime.episodes_count}`}</span>` : ''}
          ${watchlistStatus ? `<span class="badge badge-dub">${formatWatchlistStatus(watchlistStatus)}</span>` : ''}
        </div>
        <div class="anime-card-rating">
          <i class="fas fa-star"></i> ${anime.rating?.toFixed(1) || 'N/A'}
        </div>
      </div>
      <div class="anime-card-info">
        <div class="anime-card-title" title="${anime.title}">${anime.title}</div>
        <div class="anime-card-meta">
          <span><i class="fas fa-calendar"></i> ${anime.release_year || '?'}</span>
          <span><i class="fas fa-tv"></i> ${showStatus}</span>
        </div>
      </div>
    </div>
  `;
}

function renderSkeletonCards(count = 12) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton-card"><div class="skeleton skeleton-img"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text-sm"></div></div>`;
  }
  return html;
}

// ===== Continue Watching Card (OffAnime Symmetrical 16:9 Card) =====
function renderContinueWatchingCard(item) {
  const epId = item.target_episode_id || item.current_episode || item.episode_id;
  const isWebSeries = item.type === 'ONA' || item.anime_type === 'ONA';
  const epNum = item.episode_number || item.episode_in_season || 1;
  const epLabel = isWebSeries && item.season_number
    ? `S${item.season_number}:E${epNum}`
    : `EP ${epNum}`;
  const epTitle = item.episode_title ? `Episode ${epNum} · ${item.episode_title}` : `Episode ${epNum} · Ready to stream`;
  const progSec = Number(item.progress_seconds) || Number(localStorage.getItem(`anime_prog_${epId}`) || 0);
  const totalEstSec = (item.episode_duration ? Number(item.episode_duration) * 60 : 0) || (isWebSeries ? 45 * 60 : 24 * 60);
  const pct = Math.min(100, Math.max(progSec > 0 ? 8 : 0, Math.round((progSec / totalEstSec) * 100)));
  const imgUrl = item.banner_image || item.cover_image || item.episode_thumbnail || '/images/placeholder.svg';
  const title = (item.title || item.anime_title || 'ANIME').toUpperCase();

  return `
    <div class="continue-card" onclick="navigateTo('/watch/${epId}')">
      <div class="continue-card-thumb">
        <img src="${imgUrl}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
        <span class="continue-ep-badge">${epLabel}</span>
        <div class="continue-card-play"><i class="fas fa-play"></i></div>
        <div class="continue-progress-bar-wrap">
          <div class="continue-progress-bar" style="width: ${pct}%;"></div>
        </div>
      </div>
      <div class="continue-card-info">
        <div class="continue-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="continue-card-subtitle">${escapeHtml(epTitle)}</div>
      </div>
    </div>
  `;
}

// ===== Top 10 Card Renderer (OffAnime Signature Feature) =====
function renderTop10Card(anime, rank) {
  const isMovie = anime.type === 'Movie';
  return `
    <div class="top10-item" onclick="navigateTo('/anime/${anime.slug}')">
      <div class="top10-rank-num">${rank}</div>
      <div class="top10-poster-card">
        <div class="top10-poster-wrap">
          <img src="${anime.cover_image}" alt="${escapeHtml(anime.title)}" loading="lazy"
               onerror="this.src='https://via.placeholder.com/300x420/1a1a2e/8b5cf6?text=${encodeURIComponent(anime.title)}'">
          <div class="top10-overlay">
            <div class="top10-play-icon"><i class="fas fa-play"></i></div>
          </div>
          <div class="top10-corner-badges">
            <span class="badge badge-sub">${displayAnimeType(anime.type)}</span>
            ${anime.episodes_count ? `<span class="badge badge-ep">${isMovie ? 'MOVIE' : `EP ${anime.episodes_count}`}</span>` : ''}
          </div>
          <div class="top10-card-rating">
            <i class="fas fa-star"></i> ${anime.rating ? anime.rating.toFixed(1) : '9.0'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function scrollContainer(containerId, direction) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const scrollAmount = container.clientWidth * 0.7 * direction;
  container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
}

// ===== HOME PAGE =====
async function renderHomePage() {
  const app = document.getElementById('app');

  // Show skeleton immediately with Hero, Quick Nav, Top 10, and Grids
  app.innerHTML = `
    <div class="hero">
      <div class="hero-slider" id="hero-slider"></div>
      <button class="hero-nav-arrow prev" onclick="prevHeroSlide()" aria-label="Previous slide"><i class="fas fa-chevron-left"></i></button>
      <button class="hero-nav-arrow next" onclick="nextHeroSlide()" aria-label="Next slide"><i class="fas fa-chevron-right"></i></button>
      <div class="hero-dots" id="hero-dots"></div>
    </div>

    <div class="home-quick-nav">
      <button class="quick-pill active" onclick="navigateTo('/')"><i class="fas fa-fire"></i> Discover</button>
      <button class="quick-pill hindi-pill" onclick="navigateTo('/browse?dub=hindi')"><i class="fas fa-flag"></i> 🇮🇳 Hindi Dub</button>
      <button class="quick-pill" onclick="navigateTo('/browse?type=AnimeMovie')"><i class="fas fa-film"></i> 🎬 Anime Movies</button>
      <button class="quick-pill" onclick="navigateTo('/browse?type=Movie')"><i class="fas fa-clapperboard"></i> 🍿 Movies</button>
      <button class="quick-pill" onclick="navigateTo('/browse?category=series')"><i class="fas fa-tv"></i> 📺 Web Series</button>
      <button class="quick-pill" onclick="navigateTo('/browse?category=kdrama')"><i class="fas fa-heart"></i> 🇰🇷 K-Dramas</button>
      <button class="quick-pill" onclick="navigateTo('/browse?category=cdrama')"><i class="fas fa-dragon"></i> 🇨🇳 C-Dramas</button>
      <button class="quick-pill" onclick="navigateTo('/browse?sort=rating')"><i class="fas fa-star"></i> Top Rated</button>
      <button class="quick-pill" onclick="navigateTo('/genres')"><i class="fas fa-tags"></i> All Genres</button>
    </div>

    <!-- OffAnime Signature: TOP 10 Content Today -->
    <section class="section top10-section">
      <div class="top10-header-offanime">
        <div class="top10-title-container">
          <span class="top10-giant-hollow">TOP 10</span>
          <span class="top10-vertical-divider"></span>
          <div class="top10-stacked-label">
            <span>CONTENT</span>
            <span>TODAY</span>
          </div>
        </div>
        <div class="top10-nav-arrows">
          <button class="top10-arrow-btn" onclick="scrollContainer('top10-slider', -1)" aria-label="Previous"><i class="fas fa-chevron-left"></i></button>
          <button class="top10-arrow-btn" onclick="scrollContainer('top10-slider', 1)" aria-label="Next"><i class="fas fa-chevron-right"></i></button>
        </div>
      </div>
      <div class="top10-slider" id="top10-slider">
        ${renderSkeletonCards(6)}
      </div>
    </section>

    <!-- Popular Anime -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Popular Anime</h2>
        <a href="/browse?sort=views" class="section-link" onclick="navigateTo('/browse?sort=views'); return false;">View All <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="trending-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Popular Hindi Dubbed Anime -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Popular Hindi Dubbed Anime</h2>
        <a href="/browse?dub=hindi" class="section-link" onclick="navigateTo('/browse?dub=hindi'); return false;">View All Hindi Dub <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="hindi-dub-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Anime Movies -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Anime Movies</h2>
        <a href="/browse?type=AnimeMovie" class="section-link" onclick="navigateTo('/browse?type=AnimeMovie'); return false;">View All Anime Movies <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="anime-movies-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Blockbuster Movies -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Blockbuster Movies</h2>
        <a href="/browse?type=Movie" class="section-link" onclick="navigateTo('/browse?type=Movie'); return false;">View All Movies <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="movies-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Web Series -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Web Series</h2>
        <a href="/browse?category=series" class="section-link" onclick="navigateTo('/browse?category=series'); return false;">View All Web Series <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="series-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Trending K-Dramas -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Trending K-Dramas 🇰🇷</h2>
        <a href="/browse?category=kdrama" class="section-link" onclick="navigateTo('/browse?category=kdrama'); return false;">View All K-Dramas <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="kdrama-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Top C-Dramas -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Top C-Dramas 🇨🇳</h2>
        <a href="/browse?category=cdrama" class="section-link" onclick="navigateTo('/browse?category=cdrama'); return false;">View All C-Dramas <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="cdrama-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Latest Updates -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Latest Updates</h2>
        <a href="/browse?sort=latest" class="section-link" onclick="navigateTo('/browse?sort=latest'); return false;">View All <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="latest-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Most Popular Classics -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Most Popular Classics</h2>
        <a href="/browse?sort=rating" class="section-link" onclick="navigateTo('/browse?sort=rating'); return false;">View All <i class="fas fa-chevron-right"></i></a>
      </div>
      <div class="anime-grid" id="popular-grid">${renderSkeletonCards(6)}</div>
    </section>

    <!-- Continue Watching Shelf (Directly above the 3 columns matching Screenshot 3) -->
    <div id="home-continue-watching-wrap"></div>

    <!-- ANIME SUGE SIGNATURE 3-COLUMN BOTTOM BAR (MOST VIEWED | NEW RELEASES | COMPLETED) -->
    <section class="section bottom-three-col-section">
      <div class="bottom-three-grid">
        <!-- Col 1: MOST VIEWED (Day | Week | Month) -->
        <div class="bottom-col most-viewed-col">
          <div class="bottom-col-header">
            <h3 class="bottom-col-title">MOST VIEWED</h3>
            <div class="most-viewed-tabs">
              <button class="mv-tab-btn active" data-period="day" onclick="switchMostViewedTab('day')">Day</button>
              <button class="mv-tab-btn" data-period="week" onclick="switchMostViewedTab('week')">Week</button>
              <button class="mv-tab-btn" data-period="month" onclick="switchMostViewedTab('month')">Month</button>
            </div>
          </div>
          <div class="most-viewed-list" id="most-viewed-list">
            ${renderSkeletonCards(3)}
          </div>
        </div>

        <!-- Col 2: NEW RELEASES -->
        <div class="bottom-col new-releases-col">
          <div class="bottom-col-header">
            <h3 class="bottom-col-title">NEW RELEASES</h3>
            <a href="/browse?sort=latest" class="bottom-view-all" onclick="navigateTo('/browse?sort=latest'); return false;">View all</a>
          </div>
          <div class="compact-media-list" id="new-releases-list">
            ${renderSkeletonCards(3)}
          </div>
        </div>

        <!-- Col 3: COMPLETED -->
        <div class="bottom-col completed-col">
          <div class="bottom-col-header">
            <h3 class="bottom-col-title">COMPLETED</h3>
            <a href="/browse?status=Completed" class="bottom-view-all" onclick="navigateTo('/browse?status=Completed'); return false;">View all</a>
          </div>
          <div class="compact-media-list" id="completed-list">
            ${renderSkeletonCards(3)}
          </div>
        </div>
      </div>

      <!-- Centered Back To Top matching Screenshot 4 -->
      <div class="back-to-top-wrap">
        <button class="back-to-top-btn" onclick="window.scrollTo({ top: 0, behavior: 'smooth' });">
          <i class="fas fa-chevron-up"></i> BACK TO TOP
        </button>
      </div>
    </section>
  `;

  try {
    // Fetch all datasets in parallel
    const [trending, animeMovies, movies, series, kdrama, cdrama, latest, popular, hindiDub, mostViewed, newReleases, completedAnime] = await Promise.all([
      api('/anime/trending'),
      api('/anime/anime-movies').catch(() => ({ data: [] })),
      api('/anime/movies').catch(() => ({ data: [] })),
      api('/anime/series').catch(() => ({ data: [] })),
      api('/anime/kdrama').catch(() => ({ data: [] })),
      api('/anime/cdrama').catch(() => ({ data: [] })),
      api('/anime/latest'),
      api('/anime/popular'),
      api('/anime/hindi-dubbed').catch(() => ({ data: [] })),
      api('/anime/most-viewed?period=day').catch(() => ({ data: [] })),
      api('/anime/new-releases').catch(() => ({ data: [] })),
      api('/anime/completed').catch(() => ({ data: [] }))
    ]);

    // Hero slider: top 6 spotlights
    renderHeroSlider(trending.data.slice(0, 6));

    // Top 10 Today horizontal slider
    const top10Container = document.getElementById('top10-slider');
    if (top10Container) {
      top10Container.innerHTML = trending.data.slice(0, 10).map((a, i) => renderTop10Card(a, i + 1)).join('');
    }

    // Trending grid
    const trendingGrid = document.getElementById('trending-grid');
    if (trendingGrid) {
      trendingGrid.innerHTML = trending.data.map(renderAnimeCard).join('');
    }

    // Hindi Dubbed Anime grid (Naruto, Dragon Ball, Demon Slayer, Jujutsu Kaisen, etc.)
    const hindiGrid = document.getElementById('hindi-dub-grid');
    if (hindiGrid && hindiDub?.data) {
      hindiGrid.innerHTML = hindiDub.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // Anime Movies grid (dedicated anime movies shelf)
    const animeMoviesGrid = document.getElementById('anime-movies-grid');
    if (animeMoviesGrid && animeMovies?.data) {
      animeMoviesGrid.innerHTML = animeMovies.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // Live-Action Movies grid (Hollywood + Bollywood 200 blockbusters)
    const moviesGrid = document.getElementById('movies-grid');
    if (moviesGrid && movies?.data) {
      moviesGrid.innerHTML = movies.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // Web Series grid (Indian & Global series)
    const seriesGrid = document.getElementById('series-grid');
    if (seriesGrid && series?.data) {
      seriesGrid.innerHTML = series.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // K-Dramas grid (Trending Korean Dramas)
    const kdramaGrid = document.getElementById('kdrama-grid');
    if (kdramaGrid && kdrama?.data) {
      kdramaGrid.innerHTML = kdrama.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // C-Dramas grid (Top Chinese Dramas)
    const cdramaGrid = document.getElementById('cdrama-grid');
    if (cdramaGrid && cdrama?.data) {
      cdramaGrid.innerHTML = cdrama.data.slice(0, 12).map(renderAnimeCard).join('');
    }

    // Latest grid
    const latestGrid = document.getElementById('latest-grid');
    if (latestGrid) {
      latestGrid.innerHTML = latest.data.slice(0, 18).map(renderAnimeCard).join('');
    }

    // Popular grid
    const popularGrid = document.getElementById('popular-grid');
    if (popularGrid) {
      popularGrid.innerHTML = popular.data.slice(0, 18).map(renderAnimeCard).join('');
    }

    // Continue Watching Shelf (Portrait Cards with Red Progress Bar matching Screenshot 3)
    let continueItems = [];
    if (currentUser) {
      try {
        const res = await api('/user/watchlist?status=watching');
        if (res.data?.length > 0) continueItems = res.data;
      } catch (e) {}
    }
    if (continueItems.length === 0) {
      try {
        const guestHist = JSON.parse(localStorage.getItem('anime_guest_history') || '[]');
        if (guestHist.length > 0) continueItems = guestHist;
      } catch (e) {}
    }
    if (continueItems.length === 0) {
      // Default ongoing anime with simulated watch progress matching Screenshot 3
      continueItems = (trending.data || []).slice(0, 7).map((a, i) => ({
        anime_id: a.id,
        anime_title: a.title,
        title: a.title,
        anime_slug: a.slug,
        slug: a.slug,
        type: a.type,
        cover_image: a.cover_image,
        banner_image: a.banner_image,
        episode_number: (i % 3) + 1,
        progress_seconds: 420 + (i * 90),
        duration_seconds: 1440
      }));
    }

    const wrap = document.getElementById('home-continue-watching-wrap');
    if (wrap && continueItems.length > 0) {
      wrap.innerHTML = `
        <section class="section continue-watching-shelf">
          <div class="section-header">
            <h2 class="section-title">CONTINUE WATCHING</h2>
            <a href="/profile" class="section-link" onclick="navigateTo('/profile'); return false;">View all <i class="fas fa-chevron-right"></i></a>
          </div>
          <div class="continue-watching-slider">
            ${continueItems.slice(0, 10).map(renderSugeContinueCard).join('')}
          </div>
        </section>
      `;
    }

    // Most Viewed list (AnimeSuge Column 1)
    const mvList = document.getElementById('most-viewed-list');
    if (mvList && mostViewed?.data) {
      mvList.innerHTML = renderMostViewedItems(mostViewed.data);
    }

    // New Releases list (AnimeSuge Column 2)
    const nrList = document.getElementById('new-releases-list');
    if (nrList && newReleases?.data) {
      nrList.innerHTML = renderCompactMediaItems(newReleases.data, false);
    }

    // Completed list (AnimeSuge Column 3)
    const compList = document.getElementById('completed-list');
    if (compList && completedAnime?.data) {
      compList.innerHTML = renderCompactMediaItems(completedAnime.data, true);
    }
  } catch (err) {
    console.error('Home page error:', err);
    showToast('Failed to load content', 'error');
  }
}

// ===== ANIME SUGE BOTTOM 3-COLUMN RENDERERS =====
function renderSugeContinueCard(item) {
  const title = item.anime_title || item.title || 'Anime';
  const slug = item.anime_slug || item.slug || '';
  const epNum = item.episode_number || item.episode_in_season || 1;
  const type = (item.type || item.anime_type || 'TV').toUpperCase();
  const progSec = Number(item.progress_seconds || item.current_time || 0);
  const totalSec = Number(item.duration_seconds || item.total_seconds || 1440);
  const pct = Math.min(100, Math.max(12, Math.round((progSec / totalSec) * 100)));
  const imgUrl = item.cover_image || item.banner_image || '/images/placeholder.svg';

  const formatMinSec = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const navPath = slug ? `/anime/${slug}` : '/';

  return `
    <div class="suge-continue-card" onclick="navigateTo('${navPath}')" title="${escapeHtml(title)}">
      <div class="suge-continue-poster-wrap">
        <img src="${imgUrl}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
        <span class="suge-continue-type-badge">${type}</span>
        <div class="suge-continue-play-overlay">
          <div class="suge-continue-play-btn"><i class="fas fa-play"></i></div>
        </div>
        <div class="suge-continue-time-pill">
          <span>EP ${epNum}</span>
          <span>${formatMinSec(progSec)} / ${formatMinSec(totalSec)}</span>
        </div>
        <div class="suge-continue-progress-track">
          <div class="suge-continue-progress-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
      <div class="suge-continue-title">${escapeHtml(title)}</div>
    </div>
  `;
}

function renderMostViewedItems(animeList) {
  if (!animeList || animeList.length === 0) {
    return '<p style="color:#71717a; font-size:0.8rem; padding:12px;">No data available</p>';
  }

  const rankOne = animeList[0];
  const otherRanks = animeList.slice(1, 10);

  const rankOneHtml = `
    <div class="mv-rank-one-card" onclick="navigateTo('/anime/${rankOne.slug}')">
      <div class="mv-rank-one-split">
        <div class="mv-rank-one-num-box">01</div>
        <div class="mv-rank-one-art">
          <img src="${rankOne.banner_image || rankOne.cover_image}" alt="${escapeHtml(rankOne.title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
          <div class="mv-rank-one-art-gradient"></div>
        </div>
      </div>
      <div class="mv-rank-one-info">
        <div class="mv-rank-one-title" title="${escapeHtml(rankOne.title)}">${escapeHtml(rankOne.title)}</div>
        <div class="mv-rank-one-meta">
          <span>${(rankOne.type || 'TV').toUpperCase()}</span>
          <span><i class="fas fa-comment-dots"></i> ${rankOne.episodes_count || 12}</span>
          <span><i class="fas fa-microphone"></i> ${rankOne.has_hindi_dub ? 'Dub' : 'Sub'}</span>
        </div>
      </div>
    </div>
  `;

  const otherRanksHtml = otherRanks.map((anime, index) => {
    const rankNum = (index + 2).toString().padStart(2, '0');
    return `
      <div class="mv-rank-row" onclick="navigateTo('/anime/${anime.slug}')">
        <div class="mv-badge-red">${rankNum}</div>
        <div class="mv-row-details">
          <div class="mv-row-title" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</div>
          <div class="mv-row-meta">
            <span>${(anime.type || 'TV').toUpperCase()}</span>
            <span><i class="fas fa-comment-dots"></i> ${anime.episodes_count || 12}</span>
            <span><i class="fas fa-microphone"></i> ${anime.has_hindi_dub ? 'Dub' : 'Sub'}</span>
          </div>
        </div>
        <img src="${anime.cover_image}" alt="${escapeHtml(anime.title)}" class="mv-row-thumb" loading="lazy" onerror="this.src='/images/placeholder.svg'">
      </div>
    `;
  }).join('');

  return rankOneHtml + otherRanksHtml;
}

function renderCompactMediaItems(animeList, isCompleted = false) {
  if (!animeList || animeList.length === 0) {
    return '<p style="color:#71717a; font-size:0.8rem; padding:12px;">No data available</p>';
  }

  return animeList.slice(0, 12).map(anime => {
    const epCount = anime.episodes_count || (anime.type === 'Movie' ? 1 : 12);
    const duration = anime.duration || (isCompleted ? '24 MIN. PER EP.' : '24 MIN.');
    const type = (anime.type || 'TV').toUpperCase();

    return `
      <div class="compact-media-item" onclick="navigateTo('/anime/${anime.slug}')">
        <img src="${anime.cover_image}" alt="${escapeHtml(anime.title)}" class="compact-media-thumb" loading="lazy" onerror="this.src='/images/placeholder.svg'">
        <div class="compact-media-info">
          <div class="compact-media-title" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</div>
          <div class="compact-media-meta">
            <span>${type}</span>
            <span><i class="fas fa-comment-dots"></i> ${epCount}</span>
            <span>${duration.toUpperCase()}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.switchMostViewedTab = async function(period) {
  document.querySelectorAll('.mv-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });

  const list = document.getElementById('most-viewed-list');
  if (!list) return;

  list.style.opacity = '0.5';
  try {
    const res = await api(`/anime/most-viewed?period=${period}`);
    if (res?.data) {
      list.innerHTML = renderMostViewedItems(res.data);
    }
  } catch (e) {
    console.error('Failed to switch most-viewed tab:', e);
  } finally {
    list.style.opacity = '1';
  }
};

// ===== HERO SLIDER =====
function renderHeroSlider(animeList) {
  const slider = document.getElementById('hero-slider');
  const dots = document.getElementById('hero-dots');
  if (!slider || !dots) return;

  if (heroInterval) clearInterval(heroInterval);

  slider.innerHTML = animeList.map((anime, i) => `
    <div class="hero-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
      <img src="${anime.banner_image || anime.cover_image}" alt="${anime.title}" class="hero-slide-bg"
           onerror="this.src='/images/placeholder.svg'">
      <div class="hero-slide-gradient"></div>
      <div class="hero-slide-content">
        <div class="hero-badge"><i class="fas fa-fire"></i> #${i + 1} Spotlight</div>

        <div class="hero-title-box">
          ${anime.logo_image ? `
            <img src="${anime.logo_image}" alt="${anime.title}" class="hero-title-logo"
                 onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='block';">
            <h1 class="hero-title" style="display:none;">${anime.title}</h1>
          ` : `
            <h1 class="hero-title">${anime.title}</h1>
          `}
        </div>

        <div class="hero-meta">
          <span class="rating"><i class="fas fa-star"></i> ${anime.rating ? anime.rating.toFixed(1) : '9.0'}</span>
          <span class="badge badge-quality">HD</span>
          <span class="badge badge-sub">SUB</span>
          <span class="badge badge-dub">DUB</span>
          <span><i class="fas fa-tv"></i> ${displayAnimeType(anime.type)}</span>
          <span><i class="fas fa-film"></i> ${anime.type === 'Movie' ? 'Movie' : `${anime.episodes_count || 12} Episodes`}</span>
          <span><i class="fas fa-calendar"></i> ${anime.release_year || '2024'}</span>
          ${anime.genres ? anime.genres.slice(0, 3).map(g => `<span class="hero-genre-tag">${g.name}</span>`).join('') : ''}
        </div>
        <p class="hero-description">${anime.description || ''}</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" onclick="navigateTo('/anime/${anime.slug}')">
            <i class="fas fa-play"></i> Watch Now
          </button>
          <button class="btn btn-glass btn-lg" onclick="toggleWatchlist(${anime.id})">
            <i class="fas fa-bookmark"></i> Watchlist
          </button>
          <button class="btn btn-glass btn-lg" onclick="navigateTo('/anime/${anime.slug}')">
            <i class="fas fa-circle-info"></i> Details
          </button>
        </div>
      </div>
    </div>
  `).join('');

  dots.innerHTML = animeList.map((_, i) => `
    <div class="hero-dot ${i === 0 ? 'active' : ''}" onclick="goToSlide(${i})"></div>
  `).join('');

  currentHeroSlide = 0;
  heroInterval = setInterval(() => {
    currentHeroSlide = (currentHeroSlide + 1) % animeList.length;
    goToSlide(currentHeroSlide);
  }, 6000);
}

function nextHeroSlide() {
  const slides = document.querySelectorAll('.hero-slide');
  if (!slides.length) return;
  currentHeroSlide = (currentHeroSlide + 1) % slides.length;
  goToSlide(currentHeroSlide);
}

function prevHeroSlide() {
  const slides = document.querySelectorAll('.hero-slide');
  if (!slides.length) return;
  currentHeroSlide = (currentHeroSlide - 1 + slides.length) % slides.length;
  goToSlide(currentHeroSlide);
}

function goToSlide(index) {
  currentHeroSlide = index;
  document.querySelectorAll('.hero-slide').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.hero-dot').forEach(d => d.classList.remove('active'));
  document.querySelector(`.hero-slide[data-index="${index}"]`)?.classList.add('active');
  document.querySelectorAll('.hero-dot')[index]?.classList.add('active');
}

// ===== BROWSE PAGE =====
// ===== BROWSE & CATALOG ENGINE =====
let catalogDebounceTimer = null;
const catalogFilters = {
  search: '',
  genre: '',
  type: '',
  status: '',
  sort: 'rating',
  dub: '',
  category: '',
  page: 1,
  limit: 24
};

async function renderBrowsePage(params) {
  const app = document.getElementById('app');
  catalogFilters.genre = params?.get('genre') || '';
  catalogFilters.type = params?.get('type') || '';
  catalogFilters.status = params?.get('status') || '';
  catalogFilters.sort = params?.get('sort') || 'rating';
  catalogFilters.search = params?.get('search') || '';
  catalogFilters.dub = params?.get('dub') || '';
  catalogFilters.category = params?.get('category') || '';
  catalogFilters.page = parseInt(params?.get('page'), 10) || 1;
  catalogFilters.limit = 24;

  const isHindi = catalogFilters.dub === 'hindi';
  const isKdrama = catalogFilters.category === 'kdrama' || catalogFilters.type === 'kdrama';
  const isCdrama = catalogFilters.category === 'cdrama' || catalogFilters.type === 'cdrama';
  const isAnimeMovie = catalogFilters.type === 'AnimeMovie' || catalogFilters.type === 'anime-movies';
  const isLiveMovie = catalogFilters.type === 'Movie' || catalogFilters.type === 'movies' || catalogFilters.category === 'movie' || catalogFilters.category === 'movies' || catalogFilters.category === 'live_action';
  const isWebSeries = catalogFilters.type === 'ONA' || catalogFilters.type === 'series' || catalogFilters.category === 'series' || catalogFilters.category === 'web-series';

  let pageTitle = 'Browse Anime';
  let pageDesc = 'Discover your next favorite anime from our collection with instant live search & multi-filter catalog';
  let pageIcon = 'fa-compass';

  if (isKdrama) {
    pageTitle = 'Trending K-Dramas 🇰🇷';
    pageDesc = 'Binge-worthy Korean dramas in HD with instant live filter';
    pageIcon = 'fa-heart';
  } else if (isCdrama) {
    pageTitle = 'Top C-Dramas 🇨🇳';
    pageDesc = 'Popular Chinese dramas with HD streaming and live search';
    pageIcon = 'fa-dragon';
  } else if (isLiveMovie) {
    pageTitle = 'Movies 🍿';
    pageDesc = 'Bollywood & Hollywood blockbuster movies with multi-server streaming';
    pageIcon = 'fa-film';
  } else if (isWebSeries) {
    pageTitle = 'Web Series 📺';
    pageDesc = 'Binge-worthy Indian & International web series';
    pageIcon = 'fa-tv';
  } else if (isHindi) {
    pageTitle = 'Hindi Dubbed Anime & Shows 🇮🇳';
    pageDesc = 'Watch top anime in Hindi Dub (Naruto, Shippuden, DBZ, Demon Slayer & more)';
    pageIcon = 'fa-flag';
  } else if (isAnimeMovie) {
    pageTitle = 'Anime Movies 🎬';
    pageDesc = 'Explore iconic anime films in full HD';
    pageIcon = 'fa-film';
  }

  app.innerHTML = `
    <div class="browse-page catalog-page">
      <div class="browse-header">
        <h1><i class="fas ${pageIcon}"></i> ${pageTitle}</h1>
        <p>${pageDesc}</p>
      </div>

      <!-- Live Search & Filter Toolbar -->
      <div class="catalog-toolbar">
        <div class="toolbar-primary-row">
          
          <!-- Search Input with Debounce -->
          <div class="filter-input-wrap">
            <svg class="search-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" id="catalogSearchInput" class="filter-input" placeholder="Search anime title, Japanese name, synopsis..." value="${escapeHtml(catalogFilters.search)}" />
            <button id="clearSearchBtn" class="clear-search-btn" style="${catalogFilters.search ? 'display:flex;' : 'display:none;'}" title="Clear search" onclick="clearCatalogSearch()">&times;</button>
          </div>

          <!-- Dynamic Genres Dropdown -->
          <select id="genreSelect" class="filter-select">
            <option value="">All Genres</option>
          </select>

          <!-- Format Dropdown -->
          <select id="typeSelect" class="filter-select">
            <option value="">All Formats</option>
            <option value="TV" ${catalogFilters.type.toUpperCase() === 'TV' ? 'selected' : ''}>TV Series</option>
            <option value="Movie" ${catalogFilters.type.toLowerCase() === 'movie' || isLiveMovie ? 'selected' : ''}>Movie</option>
            <option value="AnimeMovie" ${isAnimeMovie ? 'selected' : ''}>Anime Movie</option>
            <option value="OVA" ${catalogFilters.type.toUpperCase() === 'OVA' ? 'selected' : ''}>OVA</option>
            <option value="ONA" ${catalogFilters.type.toUpperCase() === 'ONA' || isWebSeries ? 'selected' : ''}>ONA</option>
            <option value="Special" ${catalogFilters.type.toUpperCase() === 'SPECIAL' ? 'selected' : ''}>Special</option>
            ${isKdrama ? `<option value="kdrama" selected>K-Drama</option>` : ''}
            ${isCdrama ? `<option value="cdrama" selected>C-Drama</option>` : ''}
          </select>

          <!-- Status Dropdown -->
          <select id="statusSelect" class="filter-select">
            <option value="">All Statuses</option>
            <option value="Airing" ${catalogFilters.status.toLowerCase() === 'airing' ? 'selected' : ''}>Airing</option>
            <option value="Completed" ${catalogFilters.status.toLowerCase() === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="Upcoming" ${catalogFilters.status.toLowerCase() === 'upcoming' ? 'selected' : ''}>Upcoming</option>
          </select>

          <!-- Sort Dropdown -->
          <select id="sortSelect" class="filter-select">
            <option value="rating" ${catalogFilters.sort === 'rating' ? 'selected' : ''}>Top Rated</option>
            <option value="year" ${catalogFilters.sort === 'year' || catalogFilters.sort === 'newest' ? 'selected' : ''}>Newest Release</option>
            <option value="views" ${catalogFilters.sort === 'views' ? 'selected' : ''}>Most Viewed</option>
            <option value="title" ${catalogFilters.sort === 'title' ? 'selected' : ''}>Title (A-Z)</option>
          </select>

          <!-- Reset Button -->
          <button id="resetFiltersBtn" class="btn btn-outline btn-sm" onclick="resetAllCatalogFilters()">Reset</button>
        </div>

        <!-- Active Filter Chips -->
        <div id="activeFiltersRow" class="active-filters-bar" style="display: none;">
          <span class="active-filters-label">Active:</span>
          <div id="activeChipsContainer" style="display: inline-flex; gap: 8px; flex-wrap: wrap;"></div>
        </div>
      </div>

      <!-- Results Meta Strip -->
      <div class="catalog-meta-strip">
        <div id="catalogResultsCount">Loading titles...</div>
        <div id="catalogPageMeta">Page 1</div>
      </div>

      <!-- Anime Cards Grid -->
      <div id="catalogAnimeGrid" class="catalog-grid anime-grid">${renderSkeletonCards(18)}</div>

      <!-- Pagination Controls -->
      <div id="catalogPagination" class="pagination-wrap pagination"></div>
    </div>
  `;

  // Attach Listeners
  initCatalogEventListeners();

  // Load Genres with Counts
  await loadCatalogGenres(isKdrama, isCdrama, isLiveMovie, isWebSeries);

  // Fetch Results
  await fetchFilteredCatalog();
}

function initCatalogEventListeners() {
  const searchInput = document.getElementById('catalogSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(catalogDebounceTimer);
      const val = e.target.value;
      if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
      catalogDebounceTimer = setTimeout(() => {
        catalogFilters.search = val.trim();
        catalogFilters.page = 1;
        fetchFilteredCatalog();
      }, 300); // 300ms debounce
    });
  }

  ['genreSelect', 'typeSelect', 'statusSelect', 'sortSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        const key = id.replace('Select', '');
        const val = e.target.value;
        if (key === 'genre') catalogFilters.genre = val;
        else if (key === 'type') {
          catalogFilters.type = val;
          if (val === 'Movie') {
            if (catalogFilters.category !== 'anime') catalogFilters.category = 'movie';
          } else if (val === 'AnimeMovie') {
            catalogFilters.category = 'anime';
            catalogFilters.type = 'Movie';
          }
        } else if (key === 'status') catalogFilters.status = val;
        else if (key === 'sort') catalogFilters.sort = val;
        catalogFilters.page = 1;
        fetchFilteredCatalog();
      });
    }
  });
}

function clearCatalogSearch() {
  const searchInput = document.getElementById('catalogSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  catalogFilters.search = '';
  catalogFilters.page = 1;
  fetchFilteredCatalog();
}

async function loadCatalogGenres(isKdrama, isCdrama, isLiveMovie, isWebSeries) {
  try {
    const genreParam = isKdrama ? 'category=kdrama' : (isCdrama ? 'category=cdrama' : (isLiveMovie ? 'category=movie' : (isWebSeries ? 'category=series' : 'category=anime')));
    const genresRes = await api(`/genres?${genreParam}`);
    const genreSelect = document.getElementById('genreSelect');
    if (genreSelect && genresRes?.data) {
      const curGenre = catalogFilters.genre;
      genreSelect.innerHTML = '<option value="">All Genres</option>';
      genresRes.data.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.slug;
        opt.textContent = `${g.name} (${g.anime_count})`;
        if (curGenre && (g.slug.toLowerCase() === curGenre.toLowerCase() || g.name.toLowerCase() === curGenre.toLowerCase())) {
          opt.selected = true;
        }
        genreSelect.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('Error loading genres:', e);
  }
}

async function fetchFilteredCatalog() {
  const grid = document.getElementById('catalogAnimeGrid') || document.getElementById('browse-grid');
  const countEl = document.getElementById('catalogResultsCount');
  const pageMetaEl = document.getElementById('catalogPageMeta');
  const pagination = document.getElementById('catalogPagination') || document.getElementById('browse-pagination');

  if (countEl) countEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching Vault...';
  if (grid && !grid.children.length) grid.innerHTML = renderSkeletonCards(18);

  const params = new URLSearchParams();
  if (catalogFilters.search) params.append('search', catalogFilters.search);
  if (catalogFilters.genre) params.append('genre', catalogFilters.genre);
  if (catalogFilters.type) params.append('type', catalogFilters.type);
  if (catalogFilters.status) params.append('status', catalogFilters.status);
  if (catalogFilters.sort && catalogFilters.sort !== 'rating') params.append('sort', catalogFilters.sort);
  if (catalogFilters.dub) params.append('dub', catalogFilters.dub);
  if (catalogFilters.category) params.append('category', catalogFilters.category);
  params.append('page', catalogFilters.page || 1);
  params.append('limit', catalogFilters.limit || 24);

  // Sync browser URL cleanly
  const queryStr = params.toString();
  const newUrl = '/browse' + (queryStr ? '?' + queryStr : '');
  window.history.replaceState({}, '', newUrl);

  try {
    const res = await api(`/anime?${params.toString()}`);
    if (res?.success && res.data) {
      const animeList = res.data.anime || [];
      const p = res.data.pagination || { total: animeList.length, page: 1, totalPages: 1 };

      if (countEl) countEl.innerHTML = `Showing <strong>${animeList.length}</strong> of <strong>${p.total}</strong> anime titles in catalogue`;
      if (pageMetaEl) pageMetaEl.textContent = `Page ${p.page} of ${p.totalPages || 1}`;

      renderActiveChips();

      if (animeList.length === 0) {
        if (grid) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-search"></i><h3>No titles found</h3><p>Try adjusting your search terms or filters</p><button class="btn btn-outline btn-sm" onclick="resetAllCatalogFilters()">Reset All Filters</button></div>`;
        if (pagination) pagination.innerHTML = '';
        return;
      }

      if (grid) grid.innerHTML = animeList.map(renderAnimeCard).join('');

      // Render pagination
      renderCatalogPagination(p);
    }
  } catch (err) {
    if (countEl) countEl.textContent = 'Failed to load titles';
    showToast('Failed to load results', 'error');
  }
}

function renderActiveChips() {
  const row = document.getElementById('activeFiltersRow');
  const container = document.getElementById('activeChipsContainer');
  if (!row || !container) return;

  const chips = [];
  if (catalogFilters.search) chips.push({ key: 'search', label: `Search: "${catalogFilters.search}"` });
  if (catalogFilters.genre) {
    const genreSelect = document.getElementById('genreSelect');
    const genreText = genreSelect?.options[genreSelect.selectedIndex]?.text?.replace(/\s*\(\d+\)/, '') || catalogFilters.genre;
    chips.push({ key: 'genre', label: `Genre: ${genreText}` });
  }
  if (catalogFilters.type) {
    const typeSelect = document.getElementById('typeSelect');
    const typeText = typeSelect?.options[typeSelect.selectedIndex]?.text || catalogFilters.type;
    chips.push({ key: 'type', label: `Format: ${typeText}` });
  }
  if (catalogFilters.status) {
    const statusSelect = document.getElementById('statusSelect');
    const statusText = statusSelect?.options[statusSelect.selectedIndex]?.text || catalogFilters.status;
    chips.push({ key: 'status', label: `Status: ${statusText}` });
  }
  if (catalogFilters.dub) {
    chips.push({ key: 'dub', label: `Audio: Hindi Dub` });
  }

  if (chips.length > 0) {
    row.style.display = 'flex';
    container.innerHTML = chips.map(c => `
      <span class="filter-chip" onclick="removeSingleFilter('${c.key}')" title="Remove filter">
        ${escapeHtml(c.label)} &times;
      </span>
    `).join('') + `<span class="filter-chip clear-all" onclick="resetAllCatalogFilters()" title="Clear all filters">Clear All</span>`;
  } else {
    row.style.display = 'none';
  }
}

function removeSingleFilter(key) {
  if (key === 'search') {
    catalogFilters.search = '';
    const searchInput = document.getElementById('catalogSearchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
  } else if (key === 'genre') {
    catalogFilters.genre = '';
    const genreSelect = document.getElementById('genreSelect');
    if (genreSelect) genreSelect.value = '';
  } else if (key === 'type') {
    catalogFilters.type = '';
    const typeSelect = document.getElementById('typeSelect');
    if (typeSelect) typeSelect.value = '';
  } else if (key === 'status') {
    catalogFilters.status = '';
    const statusSelect = document.getElementById('statusSelect');
    if (statusSelect) statusSelect.value = '';
  } else if (key === 'dub') {
    catalogFilters.dub = '';
  }

  catalogFilters.page = 1;
  fetchFilteredCatalog();
}

function resetAllCatalogFilters() {
  catalogFilters.search = '';
  catalogFilters.genre = '';
  catalogFilters.type = '';
  catalogFilters.status = '';
  catalogFilters.sort = 'rating';
  catalogFilters.dub = '';
  catalogFilters.page = 1;

  const searchInput = document.getElementById('catalogSearchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';

  ['genreSelect', 'typeSelect', 'statusSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) sortSelect.value = 'rating';

  fetchFilteredCatalog();
}

function goToCatalogPage(p) {
  catalogFilters.page = p;
  fetchFilteredCatalog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCatalogPagination(pagination) {
  const paginationEl = document.getElementById('catalogPagination') || document.getElementById('browse-pagination');
  if (!paginationEl) return;

  const { page: currentPage, totalPages } = pagination;
  if (!totalPages || totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }

  let pagHtml = '';
  if (currentPage > 1) {
    pagHtml += `<button class="page-btn" onclick="goToCatalogPage(${currentPage - 1})" aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>`;
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    pagHtml += `<button class="page-btn" onclick="goToCatalogPage(1)">1</button>`;
    if (startPage > 2) pagHtml += `<span class="page-dots" style="padding: 0 4px; color: var(--text-muted);">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    pagHtml += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goToCatalogPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) pagHtml += `<span class="page-dots" style="padding: 0 4px; color: var(--text-muted);">...</span>`;
    pagHtml += `<button class="page-btn" onclick="goToCatalogPage(${totalPages})">${totalPages}</button>`;
  }

  if (currentPage < totalPages) {
    pagHtml += `<button class="page-btn" onclick="goToCatalogPage(${currentPage + 1})" aria-label="Next page"><i class="fas fa-chevron-right"></i></button>`;
  }

  paginationEl.innerHTML = pagHtml;
}

// Backward compatibility aliases
function loadBrowseResults(page = 1) {
  goToCatalogPage(page);
}
function applyFilters() {
  fetchFilteredCatalog();
}

// ===== GENRES PAGE =====
async function renderGenresPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="genres-page">
      <div class="browse-header">
        <h1><i class="fas fa-tags"></i> Anime Genres</h1>
        <p>Browse anime by genre</p>
      </div>
      <div class="genres-grid" id="genres-grid"></div>
    </div>
  `;

  const genreIcons = {
    'Action': 'fa-fist-raised', 'Adventure': 'fa-mountain', 'Comedy': 'fa-laugh-beam',
    'Drama': 'fa-theater-masks', 'Fantasy': 'fa-hat-wizard', 'Horror': 'fa-ghost',
    'Mystery': 'fa-search', 'Psychological': 'fa-brain', 'Romance': 'fa-heart',
    'Sci-Fi': 'fa-rocket', 'Slice of Life': 'fa-coffee', 'Sports': 'fa-running',
    'Supernatural': 'fa-magic', 'Thriller': 'fa-bolt', 'Mecha': 'fa-robot',
    'Music': 'fa-music', 'Shounen': 'fa-fire', 'Seinen': 'fa-shield-alt',
    'Shoujo': 'fa-star', 'Isekai': 'fa-portal-exit'
  };

  try {
    const res = await api('/genres');
    document.getElementById('genres-grid').innerHTML = res.data.map(g => `
      <div class="genre-card" onclick="navigateTo('/browse?genre=${g.slug}')">
        <i class="fas ${genreIcons[g.name] || 'fa-tag'}"></i>
        <h3>${g.name}</h3>
        <span>${g.anime_count} anime</span>
      </div>
    `).join('');
  } catch (err) {
    showToast('Failed to load genres', 'error');
  }
}

// Detail Page State
let currentDetailAnime = null;
let currentDetailRange = [1, 100];
let currentDetailView = 'cards';
let currentDetailSearch = '';

function renderDetailEpisodes() {
  const container = document.getElementById('detail-episodes-container');
  if (!container || !currentDetailAnime) return;

  const allEps = currentDetailAnime.episodes || [];
  let epsToRender = allEps;

  if (currentDetailSearch) {
    const q = currentDetailSearch.toLowerCase().trim();
    epsToRender = allEps.filter(ep =>
      String(ep.number) === q ||
      (ep.title && ep.title.toLowerCase().includes(q))
    );
  } else if (allEps.length > 50) {
    epsToRender = allEps.filter(ep => ep.number >= currentDetailRange[0] && ep.number <= currentDetailRange[1]);
  }

  if (epsToRender.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:30px;"><i class="fas fa-search"></i><p>No episodes match your search.</p></div>`;
    return;
  }

  const isWebSeries = currentDetailAnime?.type === 'ONA';
  const serverWatched = currentDetailAnime?.watchedEpisodeIds || [];

  if (currentDetailView === 'tiles') {
    container.innerHTML = `
      <div class="detail-tiles-grid">
        ${epsToRender.map(ep => {
          const isSeason = isWebSeries && Boolean(ep.season_number);
          const epLabel = isSeason ? `S${ep.season_number}:E${ep.episode_in_season || ep.number}` : ep.number;
          const fullTitle = isSeason ? `Season ${ep.season_number} Episode ${ep.episode_in_season || ep.number}` : `Episode ${ep.number}`;
          const isWatched = isEpisodeWatched(ep.id, serverWatched);
          return `
          <div class="detail-ep-tile ${ep.filler ? 'filler' : ''} ${isWatched ? 'watched' : ''}" onclick="navigateTo('/watch/${ep.id}')" title="${ep.title || fullTitle}${ep.filler ? ' (Filler)' : ''}${isWatched ? ' (Watched)' : ''}">
            <span class="tile-num">${epLabel}</span>
            <span class="tile-label">${isWatched ? '<i class="fas fa-check" style="font-size:0.65rem;"></i> Watched' : (ep.filler ? 'Filler' : (ep.duration || (isWebSeries ? '55m' : '24m')))}</span>
          </div>
        `;}).join('')}
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="episodes-grid">
        ${epsToRender.map(ep => {
          const isSeason = isWebSeries && Boolean(ep.season_number);
          const epLabel = currentDetailAnime.type === 'Movie' ? 'Movie' : (isSeason ? `Season ${ep.season_number} Episode ${ep.episode_in_season || ep.number}` : `Episode ${ep.number}`);
          const isWatched = isEpisodeWatched(ep.id, serverWatched);
          const fallbackImg = currentDetailAnime.banner_image || currentDetailAnime.cover_image || '/images/default-cover.png';
          const thumbSrc = (ep.thumbnail && !ep.thumbnail.includes('placeholder')) ? ep.thumbnail : fallbackImg;
          const badgeText = currentDetailAnime.type === 'Movie' ? 'MOVIE' : (isSeason ? `S${ep.season_number}:E${ep.episode_in_season || ep.number}` : `EP ${ep.number}`);
          const displayTitle = (ep.title && ep.title !== epLabel && ep.title !== `Episode ${ep.number}` && ep.title !== `${currentDetailAnime.title}: Episode ${ep.number}`) ? ep.title : '';

          return `
          <div class="episode-card ${ep.filler ? 'filler' : ''} ${isWatched ? 'watched' : ''}" onclick="navigateTo('/watch/${ep.id}')">
            <div class="episode-card-thumb">
              <img src="${thumbSrc}" alt="${epLabel}" loading="lazy"
                   onerror="this.onerror=null; this.src='${fallbackImg}';">
              <span class="ep-thumb-badge">${badgeText}</span>
              ${ep.duration ? `<span class="ep-thumb-duration">${escapeHtml(ep.duration)}</span>` : ''}
              <div class="ep-play"><i class="fas fa-play-circle"></i></div>
              ${isWatched ? `<span class="watched-tag" style="position:absolute;top:6px;left:6px;z-index:4;background:rgba(0,0,0,0.85);padding:2px 7px;border-radius:4px;font-size:0.68rem;color:#a1a1aa;"><i class="fas fa-check"></i> Watched</span>` : ''}
              ${ep.filler ? `<span class="filler-tag" style="position:absolute;bottom:6px;left:6px;z-index:4;">FILLER</span>` : ''}
            </div>
            <div class="episode-card-info">
              <h4>${epLabel}</h4>
              ${displayTitle ? `<p class="ep-card-subtitle" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</p>` : ''}
              ${ep.audio_language || ep.subtitle_languages ? `<p class="episode-language">${ep.audio_language ? `Audio: ${ep.audio_language}` : ''}${ep.audio_language && ep.subtitle_languages ? ' · ' : ''}${ep.subtitle_languages ? `Subs: ${ep.subtitle_languages}` : ''}</p>` : ''}
            </div>
          </div>
        `;}).join('')}
      </div>
    `;
  }
}

window.setDetailEpRange = function(start, end) {
  currentDetailRange = [start, end];
  currentDetailSearch = '';
  const searchInput = document.getElementById('detail-ep-search-input');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.detail-range-tab').forEach(t => {
    t.classList.toggle('active', Number(t.dataset.start) === start && Number(t.dataset.end) === end);
  });
  renderDetailEpisodes();
};

window.setDetailEpView = function(view) {
  currentDetailView = view;
  document.querySelectorAll('.detail-view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  renderDetailEpisodes();
};

window.filterDetailEpisodes = function(query) {
  currentDetailSearch = query;
  renderDetailEpisodes();
};

// ===== ANIME DETAIL PAGE =====
async function renderAnimeDetail(slug) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="anime-detail"><div class="anime-detail-banner"><div class="skeleton" style="width:100%;height:400px;"></div></div></div>`;

  try {
    const res = await api(`/anime/${slug}`);
    const anime = res.data;
    currentDetailAnime = anime;
    currentDetailRange = [1, Math.min(100, anime.episodes?.length || 100)];
    currentDetailView = anime.episodes?.length > 100 ? 'tiles' : 'cards';
    currentDetailSearch = '';

    const totalEps = anime.episodes?.length || anime.episodes_count || 0;
    const ranges = generateEpisodeRanges(totalEps, 100);

    const episodeControlsHtml = totalEps > 50 ? `
      <div class="detail-ep-controls">
        <div class="detail-range-tabs">
          ${ranges.map((r, i) => `
            <button class="detail-range-tab ${i === 0 ? 'active' : ''}" data-start="${r[0]}" data-end="${r[1]}" onclick="setDetailEpRange(${r[0]}, ${r[1]})">
              ${r[0]} - ${r[1]}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="detail-ep-search">
            <i class="fas fa-search"></i>
            <input type="text" id="detail-ep-search-input" placeholder="Search ep # or title..." oninput="filterDetailEpisodes(this.value)">
          </div>
          <div class="detail-view-toggle">
            <button class="detail-view-btn ${currentDetailView === 'cards' ? 'active' : ''}" data-view="cards" onclick="setDetailEpView('cards')" title="Card View">
              <i class="fas fa-th-large"></i> Cards
            </button>
            <button class="detail-view-btn ${currentDetailView === 'tiles' ? 'active' : ''}" data-view="tiles" onclick="setDetailEpView('tiles')" title="Number Grid">
              <i class="fas fa-grip"></i> Grid
            </button>
          </div>
        </div>
      </div>
    ` : '';

    const hasOfficial = anime.episodes?.some(e => !!e.youtube_video_id);
    const officialCount = hasOfficial ? anime.episodes.filter(e => !!e.youtube_video_id).length : 0;
    const firstOfficial = hasOfficial ? anime.episodes.find(e => !!e.youtube_video_id) : null;
    const isWebSeries = anime.type === 'ONA';

    const detailSeasonsList = anime.seasons || [];
    const detailMoreSeasonsHtml = detailSeasonsList.length > 1 ? `
      <div class="more-seasons-section" id="detail-more-seasons-section" style="margin: 24px 0 16px 0;">
        <div class="more-seasons-header">
          <h3 class="more-seasons-title"><i class="fas fa-layer-group"></i> More seasons</h3>
          <div class="seasons-nav-arrows">
            <button class="season-nav-arrow" onclick="scrollDetailSeasonsSlider(-1)" aria-label="Previous seasons" title="Scroll left"><i class="fas fa-chevron-left"></i></button>
            <button class="season-nav-arrow" onclick="scrollDetailSeasonsSlider(1)" aria-label="Next seasons" title="Scroll right"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
        <div class="seasons-slider" id="detail-seasons-slider">
          ${detailSeasonsList.map(s => {
            const thumb = s.poster_image || s.cover_image || s.banner_image || '/images/default-cover.png';
            const titleText = escapeHtml(s.season_title || `Season ${s.season_number}`);
            const navTarget = `/anime/${s.slug}`;
            return `
              <div class="season-card ${s.is_active ? 'active' : ''}" 
                   onclick="${s.is_active ? '' : `navigateTo('${navTarget}')`}" 
                   title="${titleText}">
                <div class="season-card-thumb" style="background-image: url('${thumb}');"></div>
                <div class="season-card-overlay"></div>
                ${s.is_active 
                  ? `<span class="season-card-badge">${titleText}</span>` 
                  : `<span class="season-card-name">${titleText}</span>`
                }
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : '';

    let streamBannerHtml = '';
    if (hasOfficial) {
      const sourceName = firstOfficial?.source_name || 'verified partner channel';
      const audioLabel = firstOfficial?.audio_language ? `${firstOfficial.audio_language} Audio` : 'Official Audio';
      const subLabel = firstOfficial?.subtitle_languages ? ` (${firstOfficial.subtitle_languages} Subs)` : '';
      streamBannerHtml = `
        <div class="stream-source-banner official">
          <i class="fas fa-certificate"></i>
          <div>
            <strong>Official Verified Stream Available (${officialCount} ${officialCount === 1 ? 'episode' : 'episodes'})</strong>
            <p>Direct from ${sourceName} with ${audioLabel}${subLabel}. Multi-server HD playback (Server 1-6) also available.</p>
          </div>
        </div>
      `;
    } else if (slug === 'one-piece') {
      streamBannerHtml = `
        <div class="stream-source-banner">
          <i class="fas fa-cloud-bolt"></i>
          <div>
            <strong>Complete ${totalEps || 1180} Episodes Ready in HD</strong>
            <p>Stream every arc from East Blue to Egghead across Vidstream HD, MegaCloud HD, VidLink PRO & 2Embed with instant SUB/DUB switching.</p>
          </div>
        </div>
      `;
    } else if (isWebSeries) {
      streamBannerHtml = `
        <div class="stream-source-banner">
          <i class="fas fa-tv"></i>
          <div>
            <strong>Multi-Server HD Streaming Active</strong>
            <p>Full seasons and episodes available via high-speed feeds (VidLink Pro, Vidsrc HD & 2Embed) with multi-audio support.</p>
          </div>
        </div>
      `;
    } else {
      streamBannerHtml = `
        <div class="stream-source-banner">
          <i class="fas fa-circle-play"></i>
          <div>
            <strong>Multi-Server HD Streaming Active</strong>
            <p>High-definition playback available across Vidstream HD, MegaCloud HD, VidLink PRO & 2Embed with SUB & DUB audio options.</p>
          </div>
        </div>
      `;
    }

    app.innerHTML = `
      <div class="anime-detail">
        <div class="anime-detail-banner">
          <img src="${anime.banner_image}" alt="${anime.title}"
               onerror="this.src='/images/placeholder.svg'">
        </div>

        <div class="anime-detail-header">
          <div class="anime-detail-poster">
            <img src="${anime.cover_image}" alt="${anime.title}"
                 onerror="this.src='https://via.placeholder.com/230x340/1a1a2e/8b5cf6?text=${encodeURIComponent(anime.title)}'">
          </div>
          <div class="anime-detail-info">
            <h1>${anime.title}</h1>
            <p class="title-jp">${anime.title_jp || ''}</p>

            <div class="anime-detail-stats">
              <div class="stat-item rating"><i class="fas fa-star"></i> ${anime.rating?.toFixed(1)}</div>
              ${(anime.slug === 'spider-man-across-the-spider-verse' || (anime.duration && anime.duration.includes('4K'))) ? `<div class="stat-item" style="background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;font-weight:800;border:none;"><i class="fas fa-sparkles"></i> 4K UHD Master · 2160p / 2K</div>` : ''}
              <div class="stat-item"><i class="fas fa-tv"></i> ${displayAnimeType(anime)}</div>
              <div class="stat-item"><i class="fas fa-signal"></i> ${anime.status}</div>
              <div class="stat-item"><i class="fas fa-film"></i> ${(anime.type === 'Movie' || anime.type === 'AnimeMovie') ? (displayAnimeType(anime) === 'Anime Movie' ? 'Anime Film' : 'Full Movie') : `${totalEps} Episodes`}</div>
              <div class="stat-item"><i class="fas fa-calendar"></i> ${anime.release_year}</div>
              <div class="stat-item"><i class="fas fa-clock"></i> ${anime.duration}</div>
              <div class="stat-item"><i class="fas fa-building"></i> ${anime.studio || 'Unknown'}</div>
              <div class="stat-item"><i class="fas fa-eye"></i> ${formatViews(anime.views)} views</div>
            </div>

            <div class="anime-detail-genres">
              ${anime.genres.map(g => `<span class="genre-tag" onclick="navigateTo('/browse?genre=${g.slug}')">${g.name}</span>`).join('')}
            </div>

            <p class="anime-detail-description">${anime.description || 'No description available.'}</p>

            ${streamBannerHtml}

            <div class="anime-detail-actions">
              ${anime.episodes?.length > 0 ? `<button class="btn btn-primary btn-lg" onclick="navigateTo('/watch/${anime.episodes[0].id}')"><i class="fas fa-play"></i> ${anime.type === 'Movie' ? 'Watch Movie' : 'Watch Episode 1'}</button>` : ''}
              <button class="btn btn-secondary btn-lg" id="watchlist-btn" onclick="toggleWatchlist(${anime.id})">
                <i class="fas fa-bookmark"></i> ${anime.watchlistStatus ? 'In Watchlist' : 'Add to Watchlist'}
              </button>
              <button class="btn btn-icon ${anime.isFavorite ? 'btn-primary' : ''}" id="fav-btn" onclick="toggleFavorite(${anime.id}, ${anime.isFavorite})" title="Favorite">
                <i class="fas fa-heart"></i>
              </button>
            </div>
          </div>
        </div>

        ${detailMoreSeasonsHtml}

        <!-- Episodes Section -->
        ${anime.episodes?.length > 0 ? `
        <div class="episodes-section">
          <div class="episodes-header">
            <h2><i class="fas fa-list"></i> ${anime.type === 'Movie' ? 'Movie' : 'Episodes'}</h2>
            <span style="color:var(--text-muted);font-size:0.9rem;">${anime.type === 'Movie' ? '1 movie' : `${totalEps} episodes`}</span>
          </div>
          ${episodeControlsHtml}
          <div id="detail-episodes-container"></div>
        </div>
        ` : ''}

        <!-- Related Anime -->
        ${anime.related?.length > 0 ? `
        <div class="related-section">
          <h2><i class="fas fa-random"></i> You Might Also Like</h2>
          <div class="anime-grid" style="padding:0;">${anime.related.map(renderAnimeCard).join('')}</div>
        </div>
        ` : ''}
      </div>
    `;

    renderDetailEpisodes();
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Anime Not Found</h3><p>${err.message}</p><button class="btn btn-primary" onclick="navigateTo('/')">Go Home</button></div>`;
  }
}

// ===== WATCH PAGE (MULTI-SERVER STREAMING ARCHITECTURE) =====
// Clean up broken/deprecated server selections from localStorage
(function migrateServerStorage() {
  try {
    const s = localStorage.getItem('anime_server');
    const validAnimeIds = ['vidlink-anime', 'vidcore-anime', 'autoembed-anime', 'two-embed', 'animeembed', 'animeembed-mal'];
    // Automatically migrate to VidLink PRO Ultra 4K UHD (smooth, multi-audio, zero buffering)
    if (!s || !validAnimeIds.includes(s) || s === 'animeembed' || s === 'animeembed-mal' || s === 'animeembed-mirror' || s === 'justplay' || s === 'justplay-pahe' || s === 'jutsu' || s === 'vidnest' || s === 'tryembed' || s === 'vidlink-multi') {
      localStorage.setItem('anime_server', 'vidlink-anime');
    }
    const ws = localStorage.getItem('webseries_server');
    const validWsIds = ['hindi-multi-uhd', 'vidcore-tv', 'autoembed-direct', 'vidlink-tv', '2embed-cc', '2embed-skin'];
    if (!ws || !validWsIds.includes(ws) || ws === 'vidsrc-pm' || ws === 'vidsrc-cc' || ws === 'vidnest-tv' || ws === 'vidnest' || ws === 'videasy' || ws === 'autoembed-tv' || ws === 'embedsu-tv' || ws === 'vidsrc-vip') {
      localStorage.setItem('webseries_server', 'hindi-multi-uhd');
    }
  } catch (e) {}
})();

let watchState = {
  ep: null,
  allEpisodes: [],
  selectedServer: (function() {
    try {
      const s = localStorage.getItem('anime_server');
      const validAnimeIds = ['vidlink-anime', 'vidcore-anime', 'autoembed-anime', 'two-embed', 'animeembed', 'animeembed-mal'];
      if (!s || !validAnimeIds.includes(s) || s === 'animeembed' || s === 'animeembed-mal' || s === 'animeembed-mirror') {
        localStorage.setItem('anime_server', 'vidlink-anime');
        return 'vidlink-anime';
      }
      return s;
    } catch (e) {
      return 'vidlink-anime';
    }
  })(),
  audio: localStorage.getItem('anime_audio') || 'sub',
  autoNext: localStorage.getItem('anime_autonext') === 'true',
  adShield: localStorage.getItem('anime_adshield') !== 'false',
  theater: false,
  activeRange: [1, 100],
  searchQuery: ''
};

function formatProgressTime(sec) {
  const s = Math.floor(Number(sec) || 0);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h > 0) {
    return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  }
  return `${remM}:${String(remS).padStart(2, '0')}`;
}

// Universal continuous multi-season episode calculator for TMDB providers (VidLink, 2Embed)
function getTmdbSeasonAndEpisode(animeSlug, absoluteEpNum, tmdbId, epSeasonNum, epInSeason) {
  const ep = Number(absoluteEpNum) || 1;

  // 1. One Piece (TMDB 37854): 23 seasons
  if (animeSlug === 'one-piece' || tmdbId === 37854) {
    const opCounts = [61, 16, 14, 39, 13, 52, 33, 35, 73, 45, 26, 14, 101, 58, 62, 50, 56, 55, 74, 14, 197, 67, 25];
    let accum = 0;
    for (let s = 0; s < opCounts.length; s++) {
      if (ep <= accum + opCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += opCounts[s];
    }
    return { season: 23, episode: Math.max(1, ep - accum) };
  }

  // 2. Naruto (TMDB 46260): 4 seasons (52, 52, 54, 62)
  if (animeSlug === 'naruto' || animeSlug === 'naruto-classic' || tmdbId === 46260) {
    if (ep <= 52) return { season: 1, episode: ep };
    if (ep <= 104) return { season: 2, episode: ep - 52 };
    if (ep <= 158) return { season: 3, episode: ep - 104 };
    return { season: 4, episode: ep - 158 };
  }

  // 3. Naruto Shippuden (TMDB 31910): 20 seasons
  if (animeSlug === 'naruto-shippuden' || tmdbId === 31910) {
    const seasonCounts = [32, 21, 18, 17, 24, 31, 8, 24, 21, 25, 21, 33, 20, 25, 28, 13, 11, 21, 20, 87];
    let accum = 0;
    for (let s = 0; s < seasonCounts.length; s++) {
      if (ep <= accum + seasonCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += seasonCounts[s];
    }
    return { season: 20, episode: Math.max(1, ep - 413) };
  }

  // 4. Bleach (TMDB 30984): 16 seasons
  if (animeSlug === 'bleach' || animeSlug === 'bleach-classic' || tmdbId === 30984) {
    const bleachCounts = [20, 21, 22, 28, 18, 22, 20, 16, 17, 16, 7, 17, 36, 51, 24, 24];
    let accum = 0;
    for (let s = 0; s < bleachCounts.length; s++) {
      if (ep <= accum + bleachCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += bleachCounts[s];
    }
  }

  // 5. Dragon Ball Z (TMDB 12971): 9 seasons
  if (animeSlug === 'dragon-ball-z' || tmdbId === 12971) {
    const dbzCounts = [39, 35, 33, 32, 26, 29, 25, 34, 38];
    let accum = 0;
    for (let s = 0; s < dbzCounts.length; s++) {
      if (ep <= accum + dbzCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += dbzCounts[s];
    }
  }

  // 6. Hunter x Hunter (TMDB 46298): 6 seasons
  if (animeSlug === 'hunter-x-hunter' || animeSlug === 'hunter-x-hunter-2011' || tmdbId === 46298) {
    const hxhCounts = [26, 12, 20, 17, 61, 12];
    let accum = 0;
    for (let s = 0; s < hxhCounts.length; s++) {
      if (ep <= accum + hxhCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += hxhCounts[s];
    }
  }

  // 7. My Hero Academia (TMDB 65930): 7 seasons
  if (animeSlug === 'my-hero-academia' || tmdbId === 65930) {
    const mhaCounts = [13, 25, 25, 25, 25, 25, 21];
    let accum = 0;
    for (let s = 0; s < mhaCounts.length; s++) {
      if (ep <= accum + mhaCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += mhaCounts[s];
    }
  }

  // 8. Demon Slayer (TMDB 85937): 4 seasons
  if (animeSlug === 'demon-slayer-kimetsu-no-yaiba' || tmdbId === 85937) {
    const dsCounts = [26, 18, 11, 8];
    let accum = 0;
    for (let s = 0; s < dsCounts.length; s++) {
      if (ep <= accum + dsCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += dsCounts[s];
    }
  }

  // 9. Jujutsu Kaisen (TMDB 95479): 2 seasons
  if (animeSlug === 'jujutsu-kaisen' || tmdbId === 95479) {
    const jjkCounts = [24, 23];
    let accum = 0;
    for (let s = 0; s < jjkCounts.length; s++) {
      if (ep <= accum + jjkCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += jjkCounts[s];
    }
  }

  // 10. Black Clover (TMDB 73223): 4 seasons
  if (animeSlug === 'black-clover' || tmdbId === 73223) {
    const bcCounts = [51, 51, 52, 16];
    let accum = 0;
    for (let s = 0; s < bcCounts.length; s++) {
      if (ep <= accum + bcCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += bcCounts[s];
    }
  }

  // 11. Attack on Titan (TMDB 1429): 4 seasons
  if (animeSlug === 'attack-on-titan' || tmdbId === 1429) {
    const aotCounts = [25, 12, 22, 30];
    let accum = 0;
    for (let s = 0; s < aotCounts.length; s++) {
      if (ep <= accum + aotCounts[s]) {
        return { season: s + 1, episode: ep - accum };
      }
      accum += aotCounts[s];
    }
  }

  // Default: Use DB metadata if available, otherwise season 1
  return {
    season: epSeasonNum || 1,
    episode: epInSeason || ep
  };
}

function buildStreamUrl(ep, serverId, audio, startTime = 0) {
  let url = '';
  const isKapilShow = ep.anime_slug === 'the-great-indian-kapil-show';
  const isAnime = ep.category === 'anime' || Boolean(ep.anilist_id);
  const isLiveMovie = (ep.category === 'live_action' || (ep.anime_type === 'Movie' && !ep.anilist_id && ep.tmdb_id)) && !isAnime;
  const isWebSeries = !isAnime && (ep.category === 'series' || ep.category === 'kdrama' || ep.category === 'cdrama' || ep.category === 'drama' || isKapilShow || ep.anime_type === 'ONA');

  if (serverId === 'official' && ep.youtube_video_id) {
    url = `https://www.youtube-nocookie.com/embed/${ep.youtube_video_id}?autoplay=1&rel=0&enablejsapi=1`;
  } else {
    if (isWebSeries || isLiveMovie) {
      const s = WEBSERIES_SERVERS.find(item => item.id === serverId) || WEBSERIES_SERVERS[0];
      let season = ep.season_number || 1;
      let episode = ep.episode_in_season || ep.number || 1;
      let targetTmdb = ep.tmdb_id;

      if (isKapilShow) {
        targetTmdb = 247769;
        if (ep.number > 13) {
          season = 2;
          episode = ep.number - 13;
        } else {
          season = 1;
          episode = ep.number || 1;
        }
      }
      if (ep.anime_slug === 'scam-1992') {
        targetTmdb = 111188;
      }
      if (ep.anime_slug === 'game-of-thrones') {
        targetTmdb = 1399;
        const n = Number(ep.number) || 1;
        if (n <= 10) { season = 1; episode = n; }
        else if (n <= 20) { season = 2; episode = n - 10; }
        else if (n <= 30) { season = 3; episode = n - 20; }
        else if (n <= 40) { season = 4; episode = n - 30; }
        else if (n <= 50) { season = 5; episode = n - 40; }
        else if (n <= 60) { season = 6; episode = n - 50; }
        else if (n <= 67) { season = 7; episode = n - 60; }
        else { season = 8; episode = n - 67; }
      }

      url = s.build({ tmdbId: targetTmdb, season, episode, isMovie: isLiveMovie, audio });
    } else {
      let anilistId = ep.anilist_id || (ep.anime_slug === 'one-piece' ? 21 : null);
      let malId = ep.mal_id || (ep.anime_slug === 'one-piece' ? 21 : null);
      let tmdbId = ep.tmdb_id || (ep.anime_slug === 'one-piece' ? 37854 : null);
      let epNum = ep.number || 1;
      const animeTitle = ep.anime_title || '';

      // Multi-season continuous mapper for Fairy Tail (Episodes 1-328 across Series 1, Series 2, and Final Season)
      if (ep.anime_slug === 'fairy-tail') {
        if (epNum > 277) {
          anilistId = 99749; // Fairy Tail Final Season (2018)
          malId = 35972;
          epNum = epNum - 277;
        } else if (epNum > 175) {
          anilistId = 20626; // Fairy Tail Series 2 (2014)
          malId = 22043;
          epNum = epNum - 175;
        } else {
          anilistId = 6702;  // Fairy Tail Series 1 (2009)
          malId = 6702;
        }
      }

      // Multi-season continuous mapper for Black Clover Season 2 (Episodes 52-102 of Black Clover)
      if (ep.anime_slug === 'black-clover-season-2') {
        anilistId = 97940;
        malId = 34572;
        tmdbId = 73223;
        epNum = 51 + epNum;
      }

      const s = ANIME_SERVERS.find(item => item.id === serverId) || ANIME_SERVERS[0];
      const isMovie = ep.anime_type === 'Movie';

      if (s.id === 'hindi-toons') {
        url = s.build({ animeSlug: ep.anime_slug, episode: epNum });
      } else if (anilistId || tmdbId || malId) {
        const { season: tmdbSeason, episode: tmdbEpisode } = getTmdbSeasonAndEpisode(
          ep.anime_slug,
          epNum,
          tmdbId,
          ep.season_number,
          ep.episode_in_season
        );

        url = s.build({
          anilistId,
          malId,
          tmdbId,
          episode: epNum,
          tmdbEpisode: tmdbEpisode || epNum,
          season: tmdbSeason || 1,
          audio,
          animeTitle,
          animeSlug: ep.anime_slug,
          isMovie
        });
      } else if (ep.youtube_video_id) {
        url = `https://www.youtube-nocookie.com/embed/${ep.youtube_video_id}?autoplay=1&rel=0&enablejsapi=1`;
      } else {
        url = `https://player.vimeo.com/video/1084537?dnt=1&title=0&byline=0&portrait=0`;
      }
    }
  }

  // Resume playback from exact timestamp where user left off (AniSurge-style)
  if (startTime && Number(startTime) > 5) {
    const s = Math.floor(Number(startTime));
    if (url.includes('youtube') || url.includes('youtu.be')) {
      url += `&start=${s}`;
    } else if (url.includes('vidlink.pro')) {
      url += `&start=${s}&t=${s}`;
    } else if (url.includes('animeembed.com') || url.includes('/api/player/embed')) {
      url += `&start=${s}`;
    } else {
      url += `${url.includes('?') ? '&' : '?'}start=${s}&t=${s}&time=${s}`;
    }
  }

  return url;
}

// Global player seek dispatcher across embed iframe protocols
function dispatchPlayerSeek(timeInSec) {
  if (!timeInSec || Number(timeInSec) <= 5) return;
  const s = Math.floor(Number(timeInSec));
  const frame = document.getElementById('watch-iframe');
  if (!frame || !frame.contentWindow) return;

  // 1. AnimeEmbed protocol
  try {
    frame.contentWindow.postMessage({
      channel: 'animeembed',
      version: 1,
      requestId: 'resume-seek-' + Date.now(),
      command: 'seek',
      data: { time: s }
    }, '*');
  } catch (e) {}

  // 2. Standard HTML5 / YouTube / JWPlayer protocols
  try {
    frame.contentWindow.postMessage({
      event: 'command',
      func: 'seekTo',
      args: [s, true]
    }, '*');
    frame.contentWindow.postMessage({ type: 'seek', time: s }, '*');
    frame.contentWindow.postMessage({ command: 'seek', time: s }, '*');
  } catch (e) {}
}

function updateWatchIframe() {
  const frame = document.getElementById('watch-iframe');
  const loader = document.getElementById('player-loader');
  if (!frame || !watchState.ep) return;

  if (loader) loader.classList.remove('hidden');
  const savedProg = Math.max(
    Number(watchState.ep.progress_seconds) || 0,
    Number(localStorage.getItem(`anime_prog_${watchState.ep.id}`)) || 0
  );
  const url = buildStreamUrl(watchState.ep, watchState.selectedServer, watchState.audio, savedProg);

  const isOfficial = watchState.selectedServer === 'official';
  const isInternal = url.startsWith('/api/');

  // Ensure sandbox attribute is never set on the player iframe (fixes "Please Disable Sandbox" on VidLink PRO)
  frame.removeAttribute('sandbox');

  if (isOfficial) {
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
  } else {
    frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    frame.setAttribute('allow', 'autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; clipboard-write *');
  }

  frame.src = url;

  frame.onload = () => {
    if (loader) loader.classList.add('hidden');
  };
  setTimeout(() => {
    if (loader) loader.classList.add('hidden');
  }, 2200);
}

// Auto-Next playback controller with countdown overlay
let autoNextTimer = null;
let autoNextCountdown = 5;

window.cancelAutoNext = function() {
  if (autoNextTimer) {
    clearInterval(autoNextTimer);
    autoNextTimer = null;
  }
  const banner = document.getElementById('autonext-countdown-banner');
  if (banner) banner.remove();
};

function triggerAutoNext() {
  if (!watchState.autoNext) return;
  const nextEp = watchState.ep?.nextEpisode;
  if (!nextEp) return;

  window.cancelAutoNext();
  autoNextCountdown = 5;

  const playerWrap = document.getElementById('watch-player-wrap');
  if (!playerWrap) return;

  const banner = document.createElement('div');
  banner.id = 'autonext-countdown-banner';
  banner.className = 'autonext-banner';
  banner.innerHTML = `
    <div class="autonext-content">
      <div class="autonext-icon"><i class="fas fa-forward"></i></div>
      <div class="autonext-text">
        <strong>Next Episode Starting Soon</strong>
        <p>Playing ${nextEp.title || `Episode ${nextEp.number}`} in <span id="autonext-sec">5</span>s...</p>
      </div>
      <div class="autonext-actions">
        <button class="btn btn-sm btn-primary" onclick="cancelAutoNext(); navigateTo('/watch/${nextEp.id}')">Play Now</button>
        <button class="btn btn-sm btn-secondary" onclick="cancelAutoNext()">Cancel</button>
      </div>
    </div>
    <div class="autonext-bar"><div class="autonext-progress" id="autonext-progress-fill"></div></div>
  `;
  playerWrap.appendChild(banner);

  const fill = document.getElementById('autonext-progress-fill');
  if (fill) {
    fill.style.transition = 'width 5s linear';
    requestAnimationFrame(() => { fill.style.width = '100%'; });
  }

  autoNextTimer = setInterval(() => {
    autoNextCountdown--;
    const secEl = document.getElementById('autonext-sec');
    if (secEl) secEl.textContent = String(autoNextCountdown);
    if (autoNextCountdown <= 0) {
      window.cancelAutoNext();
      navigateTo(`/watch/${nextEp.id}`);
    }
  }, 1000);
}

// Global PostMessage listener for stream end events (AnimeEmbed, YouTube, HTML5 players)
if (typeof window !== 'undefined' && !window.__autoNextListenerInstalled) {
  window.__autoNextListenerInstalled = true;
  window.addEventListener('message', (event) => {
    if (!watchState.autoNext || !watchState.ep?.nextEpisode) return;

    // 1. AnimeEmbed events
    if (event.data?.channel === 'animeembed' && (event.data?.event === 'ended' || event.data?.event === 'next')) {
      triggerAutoNext();
      return;
    }

    // 2. YouTube IFrame API events (state 0 = ENDED)
    try {
      const ytData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (ytData?.event === 'onStateChange' && ytData?.info === 0) {
        triggerAutoNext();
        return;
      }
    } catch (e) {}

    // 3. Generic player ended events
    if (event.data?.event === 'ended' || event.data?.type === 'ended' || event.data === 'player:ended') {
      triggerAutoNext();
      return;
    }
  });
}

window.toggleWatchAdShield = function() {
  watchState.adShield = !watchState.adShield;
  localStorage.setItem('anime_adshield', String(watchState.adShield));
  const btn = document.getElementById('adshield-btn');
  if (btn) {
    btn.classList.toggle('active', watchState.adShield);
    btn.classList.toggle('off', !watchState.adShield);
    btn.innerHTML = `<i class="fas fa-shield-halved"></i> Ad Shield: ${watchState.adShield ? 'ON' : 'OFF'}`;
  }
  showToast(watchState.adShield ? '🛡️ Safe Shield Active: 100% Anti-Nudity & Popups Blocked' : '⚠️ Ad Shield turned off', watchState.adShield ? 'success' : 'info');
};

window.copyWatchLink = function() {
  try {
    navigator.clipboard.writeText(window.location.href);
    showToast('Episode link copied to clipboard!', 'success');
  } catch (err) {
    showToast('Failed to copy link', 'error');
  }
};

function renderWatchAudioSelector() {
  const container = document.getElementById('watch-audio-row');
  if (!container || !watchState.ep) return;

  const isOfficial = watchState.selectedServer === 'official';
  const isKapilShow = watchState.ep.anime_slug === 'the-great-indian-kapil-show';
  const isAnime = watchState.ep.category === 'anime' || Boolean(watchState.ep.anilist_id);
  const isLiveMovie = (watchState.ep.category === 'live_action' || (watchState.ep.anime_type === 'Movie' && !watchState.ep.anilist_id)) && !isAnime;
  const isWebSeries = !isAnime && (watchState.ep.category === 'series' || watchState.ep.category === 'kdrama' || watchState.ep.category === 'cdrama' || watchState.ep.category === 'drama' || isKapilShow || watchState.ep.anime_type === 'ONA');
  const isIndian = isIndianTitle(watchState.ep);

  if (isOfficial) {
    const isHindi = watchState.ep.audio_language === 'Hindi';
    const langLabel = isHindi
      ? 'Hindi Dub (Official Track)'
      : (watchState.ep.audio_language ? `${watchState.ep.audio_language}${watchState.ep.subtitle_languages ? ` + ${watchState.ep.subtitle_languages} Sub` : ''}` : 'Official Broadcast');
    container.innerHTML = `
      <span class="selector-label"><i class="fas fa-volume-high"></i> Audio:</span>
      <div class="audio-btn-group">
        <span class="audio-chip-btn active official-audio-badge">
          <i class="fas fa-${isHindi ? 'microphone' : 'closed-captioning'}"></i>
          ${langLabel}
        </span>
      </div>
    `;
  } else if (isIndian) {
    container.innerHTML = `
      <span class="selector-label"><i class="fas fa-volume-high"></i> Audio:</span>
      <div class="audio-btn-group">
        <button class="audio-chip-btn hindi-chip-btn ${watchState.audio === 'hindi' ? 'active' : ''}" data-audio="hindi" onclick="setWatchAudio('hindi')" title="Play in Original Hindi Master Audio">
          <i class="fas fa-flag"></i> HINDI (Original Audio 🇮🇳)
        </button>
        <button class="audio-chip-btn ${watchState.audio === 'dub' ? 'active' : ''}" data-audio="dub" onclick="setWatchAudio('dub')" title="Play in English or Multi-Audio Track">
          <i class="fas fa-microphone"></i> DUB (English / Multi)
        </button>
        <button class="audio-chip-btn ${watchState.audio === 'sub' ? 'active' : ''}" data-audio="sub" onclick="setWatchAudio('sub')" title="Play with English Subtitles">
          <i class="fas fa-closed-captioning"></i> SUB (English Subtitles)
        </button>
      </div>
    `;
  } else if (isWebSeries || isLiveMovie) {
    const hasHindi = Boolean(
      watchState.ep.has_hindi_dub ||
      watchState.ep.audio_language === 'Hindi' ||
      HINDI_DUBBED_SLUGS.has(watchState.ep.anime_slug)
    );

    container.innerHTML = `
      <span class="selector-label"><i class="fas fa-volume-high"></i> Audio:</span>
      <div class="audio-btn-group">
        ${hasHindi ? `
        <button class="audio-chip-btn hindi-chip-btn ${watchState.audio === 'hindi' ? 'active' : ''}" data-audio="hindi" onclick="setWatchAudio('hindi')" title="Play in 4K Ultra HD Hindi Dub">
          <i class="fas fa-flag"></i> HINDI (Hindi Dub 🇮🇳 4K)
        </button>
        ` : ''}
        <button class="audio-chip-btn ${watchState.audio === 'dub' ? 'active' : ''}" data-audio="dub" onclick="setWatchAudio('dub')" title="Play in English Audio">
          <i class="fas fa-microphone"></i> DUB (English Audio)
        </button>
        <button class="audio-chip-btn ${watchState.audio === 'sub' ? 'active' : ''}" data-audio="sub" onclick="setWatchAudio('sub')" title="Play in Original Audio with Multi-Subtitles">
          <i class="fas fa-closed-captioning"></i> SUB (Original / Subtitles)
        </button>
      </div>
    `;
  } else {
    const hasHindi = Boolean(
      watchState.ep.has_hindi_dub ||
      watchState.ep.audio_language === 'Hindi' ||
      HINDI_DUBBED_SLUGS.has(watchState.ep.anime_slug)
    );

    container.innerHTML = `
      <span class="selector-label"><i class="fas fa-volume-high"></i> Audio:</span>
      <div class="audio-btn-group">
        <button class="audio-chip-btn ${watchState.audio === 'sub' ? 'active' : ''}" data-audio="sub" onclick="setWatchAudio('sub')" title="Japanese Audio with English Subtitles">
          <i class="fas fa-closed-captioning"></i> SUB (Japanese Audio + Sub)
        </button>
        <button class="audio-chip-btn ${watchState.audio === 'dub' ? 'active' : ''}" data-audio="dub" onclick="setWatchAudio('dub')" title="English Dub Audio">
          <i class="fas fa-microphone"></i> DUB (English Dub)
        </button>
        ${hasHindi ? `
        <button class="audio-chip-btn hindi-chip-btn ${watchState.audio === 'hindi' ? 'active' : ''}" data-audio="hindi" onclick="setWatchAudio('hindi')" title="Play with Hindi Dubbed Audio">
          <i class="fas fa-flag"></i> HINDI (Hindi Dub 🇮🇳)
        </button>
        ` : ''}
      </div>
    `;
  }
}

window.scrollSeasonsSlider = function(dir) {
  const slider = document.getElementById('seasons-slider');
  if (slider) {
    slider.scrollBy({ left: dir * 320, behavior: 'smooth' });
  }
};

window.scrollDetailSeasonsSlider = function(dir) {
  const slider = document.getElementById('detail-seasons-slider');
  if (slider) {
    slider.scrollBy({ left: dir * 320, behavior: 'smooth' });
  }
};

window.setWatchServer = function(serverId) {
  watchState.selectedServer = serverId;
  const isWebSeries = watchState.ep?.anime_type === 'ONA' || watchState.ep?.category === 'series' || watchState.ep?.category === 'kdrama' || watchState.ep?.category === 'cdrama' || watchState.ep?.category === 'drama' || (watchState.ep?.anime_type === 'Movie' && !watchState.ep?.anilist_id);
  if (serverId !== 'official' && serverId !== 'hindi-toons') {
    localStorage.setItem(isWebSeries ? 'webseries_server' : 'anime_server', serverId);
  }
  if (serverId === 'hindi-toons' || serverId === 'hindi-multi-uhd') {
    watchState.audio = 'hindi';
    localStorage.setItem('anime_audio', 'hindi');
  } else if (watchState.audio === 'hindi' && serverId !== 'vidlink-anime' && serverId !== '2embed-skin') {
    watchState.audio = 'dub';
    localStorage.setItem('anime_audio', 'dub');
  }
  document.querySelectorAll('.server-chip-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.server === serverId);
  });
  renderWatchAudioSelector();
  const noticeText = document.getElementById('server-notice-text');
  if (noticeText && watchState.ep) {
    if (serverId === 'official') {
      noticeText.textContent = `Official stream published by ${watchState.ep.source_name || 'verified partner'}. Audio: ${watchState.ep.audio_language || 'Original'}. Switch to Server 1-6 for multi-server playback.`;
    } else if (serverId === 'hindi-toons') {
      noticeText.textContent = 'Streaming via Vault Toons Ultra Hindi Dub (Multi-Server HD). Includes RubyStream 1080p, FilesForever HD & Google Drive mirrors.';
    } else if (serverId === 'hindi-multi-uhd') {
      noticeText.textContent = 'Streaming via Server 1 (Hindi Dub 4K UHD). Multi-audio master stream with Hindi Audio track priority. Zero popups active.';
    } else if (isWebSeries) {
      noticeText.textContent = 'Streaming via verified multi-provider 4K HD feeds (Server 1: Hindi Dub 4K, Server 2: VidCore 4K UHD, Server 3: AutoEmbed PRO, Server 4: 2Embed Multi-Audio). Switch servers anytime.';
    } else {
      noticeText.textContent = 'Streaming via verified multi-provider HD feeds (Server 1: Vidstream HD, Server 2: MegaCloud HD, Server 3: VidLink PRO 4K, Server 4: 2Embed, Server 5: AnimeStream). Switch servers or SUB/DUB/HINDI anytime.';
    }
  }
  const tipBanner = document.querySelector('.stream-tip-banner strong');
  if (tipBanner && watchState.ep) {
    if (serverId === 'official') {
      tipBanner.textContent = 'Official Stream (Verified)';
    } else {
      const list = isWebSeries ? WEBSERIES_SERVERS : ANIME_SERVERS;
      const current = list.find(s => s.id === serverId);
      if (current) tipBanner.textContent = current ? current.name : serverId;
    }
  }
  updateWatchIframe();
};

window.setWatchAudio = function(audioMode) {
  watchState.audio = audioMode;
  localStorage.setItem('anime_audio', audioMode);
  document.querySelectorAll('.audio-chip-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.audio === audioMode);
  });

  const isKapilShow = watchState.ep?.anime_slug === 'the-great-indian-kapil-show';
  const isAnime = watchState.ep?.category === 'anime' || Boolean(watchState.ep?.anilist_id);
  const isLiveMovie = (watchState.ep?.category === 'live_action' || (watchState.ep?.anime_type === 'Movie' && !watchState.ep?.anilist_id)) && !isAnime;
  const isWebSeries = !isAnime && (watchState.ep?.category === 'series' || watchState.ep?.category === 'kdrama' || watchState.ep?.category === 'cdrama' || watchState.ep?.category === 'drama' || isKapilShow || watchState.ep?.anime_type === 'ONA');
  const isWebSeriesOrLive = isWebSeries || isLiveMovie;

  if (audioMode === 'hindi') {
    showToast('🇮🇳 Hindi Dub selected! Loading Ultra HD 4K/1080p stream.', 'success');
    if (isWebSeriesOrLive) {
      setWatchServer('hindi-multi-uhd');
      return;
    }
    const slug = watchState.ep?.anime_slug;
    const isToonsHindi = TOONS_HINDI_SLUGS.has(slug);
    if (isToonsHindi) {
      const maxEp = TOONS_MAX_HINDI_EPS[slug] || 999;
      const currentEpNum = Number(watchState.ep?.number) || 1;
      if (currentEpNum <= maxEp) {
        setWatchServer('hindi-toons');
        return;
      } else {
        showToast(`Episodes 1–${maxEp} available in Hindi Dub. Switching to VidLink PRO Multi-Audio HD.`, 'info');
        setWatchServer('vidlink-anime');
        return;
      }
    } else if (watchState.ep?.tmdb_id) {
      setWatchServer('vidlink-anime');
      return;
    }
  } else if (audioMode === 'sub') {
    showToast('💬 SUB Track: Japanese/Original Audio with English Subtitles.', 'info');
    if (watchState.selectedServer === 'hindi-toons') {
      setWatchServer('vidlink-anime');
      return;
    }
  } else {
    showToast('🎙️ DUB Track: English Audio (Subtitles are turned off in Dub by provider).', 'info');
    if (watchState.selectedServer === 'hindi-toons') {
      setWatchServer('vidlink-anime');
      return;
    }
  }
  updateWatchIframe();
};

window.reloadWatchPlayer = function() {
  const frame = document.getElementById('watch-iframe');
  if (frame && watchState.ep) {
    const prog = Number(localStorage.getItem(`anime_prog_${watchState.ep.id}`)) || 0;
    const freshUrl = buildStreamUrl(watchState.ep, watchState.selectedServer, watchState.audio, prog);
    frame.src = 'about:blank';
    const loader = document.getElementById('player-loader');
    if (loader) loader.classList.remove('hidden');
    setTimeout(() => {
      frame.src = freshUrl;
      showToast('🔄 Player stream reloaded', 'info');
    }, 150);
  }
};

window.toggleWatchAutoNext = function() {
  const input = document.getElementById('autonext-checkbox');
  watchState.autoNext = input ? input.checked : !watchState.autoNext;
  localStorage.setItem('anime_autonext', String(watchState.autoNext));
  const indicator = document.querySelector('.autonext-indicator');
  if (indicator) {
    indicator.textContent = watchState.autoNext ? 'ON' : 'OFF';
    indicator.classList.toggle('active', watchState.autoNext);
  }
  if (!watchState.autoNext) window.cancelAutoNext();
  showToast(watchState.autoNext ? 'Auto-Next enabled: advances when episode ends' : 'Auto-Next disabled', 'info');
};

window.toggleWatchTheater = function() {
  watchState.theater = !watchState.theater;
  const page = document.querySelector('.watch-page');
  const btn = document.getElementById('theater-toggle-btn');
  if (page) page.classList.toggle('theater-mode', watchState.theater);
  if (btn) btn.classList.toggle('active', watchState.theater);
};

// ===== AnimeSuge "Turn Off Light" (Cinema Dimmer) =====
window.toggleWatchFocusLight = function() {
  let dimmer = document.getElementById('cinema-dimmer');
  if (!dimmer) {
    dimmer = document.createElement('div');
    dimmer.id = 'cinema-dimmer';
    dimmer.className = 'cinema-dimmer';
    dimmer.onclick = function() { window.toggleWatchFocusLight(); };
    document.body.appendChild(dimmer);
  }
  const isDimmed = dimmer.classList.toggle('active');
  const playerWrap = document.getElementById('watch-player-wrap');
  if (playerWrap) {
    playerWrap.classList.toggle('focused-cinema', isDimmed);
  }
  const btn = document.getElementById('light-toggle-btn');
  if (btn) {
    btn.classList.toggle('light-active', isDimmed);
    btn.innerHTML = isDimmed ? '<i class="fas fa-lightbulb"></i> Light ON' : '<i class="far fa-lightbulb"></i> Light';
  }
  showToast(isDimmed ? '💡 Cinema Dimmer: Background dimmed' : '💡 Lights turned on', 'info');
};

// ===== AnimeSuge Relative Seeking (J / L / Arrow Keys) =====
window.seekWatchPlayerRelative = function(deltaSeconds) {
  if (!watchState.ep) return;
  const cur = Number(localStorage.getItem(`anime_prog_${watchState.ep.id}`)) || 0;
  const target = Math.max(0, cur + deltaSeconds);
  localStorage.setItem(`anime_prog_${watchState.ep.id}`, String(target));
  dispatchPlayerSeek(target);
  showToast(`${deltaSeconds > 0 ? '+ ' : ''}${deltaSeconds}s`, 'info');
};

// ===== AnimeSuge Play/Pause Controller =====
window.toggleWatchPlayPause = function() {
  const frame = document.getElementById('watch-iframe');
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage({ channel: 'animeembed', command: 'toggle' }, '*');
    frame.contentWindow.postMessage({ event: 'command', func: 'playVideo' }, '*');
    frame.contentWindow.postMessage({ type: 'toggle' }, '*');
  } catch (e) {}
};

window.toggleWatchFullscreen = function() {
  const wrap = document.getElementById('watch-player-wrap') || document.getElementById('watch-iframe');
  if (!wrap) return;

  // Instantly purge click gates before entering fullscreen
  const gate = document.getElementById('player-click-gate');
  if (gate) gate.remove();

  if (!isFullscreenActive()) {
    if (wrap.requestFullscreen) {
      wrap.requestFullscreen().catch(() => {});
    } else if (wrap.webkitRequestFullscreen) {
      wrap.webkitRequestFullscreen();
    } else if (wrap.msRequestFullscreen) {
      wrap.msRequestFullscreen();
    }
    showToast('📺 Fullscreen: Zero-Popup Protection Active', 'info');
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
};

window.selectWatchRange = function(start, end) {
  watchState.activeRange = [start, end];
  renderWatchTiles();
};

window.filterWatchTiles = function(val) {
  watchState.searchQuery = val.trim();
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 1 && num <= watchState.allEpisodes.length) {
    const r = calcEpisodeRange(num, watchState.allEpisodes.length);
    watchState.activeRange = r;
    const rangeSelect = document.getElementById('watch-range-select');
    if (rangeSelect) rangeSelect.value = `${r[0]}-${r[1]}`;
  }
  renderWatchTiles();
};

function renderWatchTiles() {
  const container = document.getElementById('watch-drawer-tiles');
  if (!container || !watchState.allEpisodes.length) return;

  const currentEpNum = watchState.ep?.number;
  let epsToDisplay = watchState.allEpisodes;

  if (watchState.searchQuery) {
    const q = watchState.searchQuery.toLowerCase();
    epsToDisplay = watchState.allEpisodes.filter(item =>
      String(item.number) === q ||
      (item.episode_in_season && String(item.episode_in_season) === q) ||
      (item.title && item.title.toLowerCase().includes(q))
    );
  } else if (watchState.allEpisodes.length > 50) {
    const [start, end] = watchState.activeRange;
    epsToDisplay = watchState.allEpisodes.filter(item => item.number >= start && item.number <= end);
  }

  if (epsToDisplay.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">No episodes found</div>`;
    return;
  }

  container.innerHTML = epsToDisplay.map(item => {
    const isActive = item.number === currentEpNum;
    const isFiller = item.filler;
    const isWebSeries = watchState.ep?.anime_type === 'ONA';
    const isSeasonEp = isWebSeries && Boolean(item.season_number);
    const tileLabel = isSeasonEp ? `S${item.season_number}:E${item.episode_in_season || item.number}` : item.number;
    const fullTitle = isSeasonEp ? `Season ${item.season_number} Episode ${item.episode_in_season || item.number}` : `Episode ${item.number}`;
    const isWatched = isEpisodeWatched(item.id, watchState.watchedEpisodeIds);
    return `
      <a href="/watch/${item.id}"
         class="ep-tile ${isActive ? 'active' : ''} ${isWatched ? 'watched' : ''} ${isFiller ? 'filler' : ''} ${isSeasonEp ? 'season-tile' : ''}"
         onclick="navigateTo('/watch/${item.id}'); return false;"
         title="${fullTitle}${item.title ? `: ${item.title}` : ''}${isFiller ? ' (Filler)' : ''}${isWatched ? ' (Watched)' : ''}">
        ${tileLabel}
      </a>
    `;
  }).join('');

  setTimeout(() => {
    const activeTile = container.querySelector('.ep-tile.active');
    if (activeTile) {
      activeTile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, 60);
}

async function renderWatchPage(episodeId) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="watch-page"><div class="watch-player"><div class="loader"><div class="loader-ring"></div></div></div></div>`;

  try {
    const res = await api(`/anime/episode/${episodeId}`);
    const ep = res.data;

    // AniSurge Watched Tracking: immediately mark opened episode as watched
    markEpisodeWatched(ep.id);
    if (res.data?.watchedEpisodeIds) {
      res.data.watchedEpisodeIds.forEach(id => markEpisodeWatched(id));
    }
    watchState.watchedEpisodeIds = res.data?.watchedEpisodeIds || [];

    const savedProg = Math.max(
      Number(ep.progress_seconds) || 0,
      Number(localStorage.getItem(`anime_prog_${ep.id}`)) || 0
    );

    const epDurationSec = (Number(ep.duration) && Number(ep.duration) > 0 ? Number(ep.duration) * 60 : 1440);
    const initPct = Math.min(100, Math.max(0, Math.round((savedProg / epDurationSec) * 100)));

    // Save recent watch for continue watching card (works for both guests & members)
    try {
      const recentWatch = {
        id: ep.anime_id,
        anime_id: ep.anime_id,
        title: ep.anime_title || ep.title,
        slug: ep.anime_slug,
        cover_image: ep.anime_cover || ep.cover_image,
        banner_image: ep.banner_image,
        type: ep.anime_type || 'TV',
        target_episode_id: ep.id,
        episode_number: ep.number,
        episode_title: ep.title,
        season_number: ep.season_number,
        progress_seconds: savedProg
      };
      localStorage.setItem('anime_recent_watch', JSON.stringify(recentWatch));

      let guestHist = JSON.parse(localStorage.getItem('anime_guest_history') || '[]');
      guestHist = guestHist.filter(h => h.episode_id !== ep.id);
      guestHist.unshift({
        episode_id: ep.id,
        anime_id: ep.anime_id,
        progress_seconds: savedProg,
        watched_at: new Date().toISOString()
      });
      localStorage.setItem('anime_guest_history', JSON.stringify(guestHist.slice(0, 50)));
    } catch (e) {}

    // Record user history & auto-resume for logged-in users
    if (currentUser) {
      try {
        await api('/user/history', {
          method: 'POST',
          body: JSON.stringify({ episode_id: ep.id, progress_seconds: savedProg })
        });
      } catch (e) {}
    }

    watchState.ep = ep;
    watchState.allEpisodes = ep.episodes && ep.episodes.length > 0 ? ep.episodes : [{ id: ep.id, number: ep.number, title: ep.title, filler: ep.filler }];
    watchState.searchQuery = '';

    const totalEps = watchState.allEpisodes.length;
    watchState.activeRange = calcEpisodeRange(ep.number, totalEps, 100);
    const ranges = generateEpisodeRanges(totalEps, 100);

    // Build servers list
    const isKapilShow = ep.anime_slug === 'the-great-indian-kapil-show';
    const isAnime = ep.category === 'anime' || Boolean(ep.anilist_id);
    const isLiveMovie = (ep.category === 'live_action' || (ep.anime_type === 'Movie' && !ep.anilist_id)) && !isAnime;
    const isWebSeries = !isAnime && (ep.category === 'series' || ep.category === 'kdrama' || ep.category === 'cdrama' || ep.category === 'drama' || isKapilShow || ep.anime_type === 'ONA');
    const isWebSeriesOrLive = isWebSeries || isLiveMovie;
    const isYtWebSeries = ep.anime_slug === 'pokemon-hisuian-snow' || ep.anime_slug === 'pokemon-paldean-winds' || ep.anime_slug === 'fairy-tail-hindi';
    const officialVideoId = (isKapilShow || (isAnime && !isYtWebSeries)) ? null : (/^[A-Za-z0-9_-]{11}$/.test(ep.youtube_video_id || '') ? ep.youtube_video_id : null);
    
    const epNum = Number(ep.number) || 1;
    const isToonsHindi = TOONS_HINDI_SLUGS.has(ep.anime_slug);
    const maxHindiEp = TOONS_MAX_HINDI_EPS[ep.anime_slug] || 0;
    const hasToonsHindi = isToonsHindi && epNum <= maxHindiEp;
    const isPastHindiBatch = isToonsHindi && epNum > maxHindiEp;

    const serversList = isWebSeriesOrLive
      ? [...WEBSERIES_SERVERS]
      : (isToonsHindi ? [...ANIME_SERVERS] : ANIME_SERVERS.filter(s => s.id !== 'hindi-toons'));
    if (officialVideoId) {
      serversList.unshift({
        id: 'official',
        name: 'Official Stream',
        badge: 'VERIFIED',
        provider: ep.source_name || 'Official Video',
        audio: ['sub']
      });
    }

    // Determine default selected server (official video always takes priority for 100% reliable playback, while live-action movies default to 4K UHD server)
    if (officialVideoId && !isLiveMovie) {
      watchState.selectedServer = 'official';
    } else if (isWebSeriesOrLive) {
      const stored = localStorage.getItem('webseries_server');
      const validWs = ['hindi-multi-uhd', 'vidcore-tv', 'autoembed-direct', '2embed-skin', '2embed-cc', 'vidlink-tv'];
      const storedAudio = localStorage.getItem('anime_audio');
      const isIndian = isIndianTitle(ep);
      const hasHindi = Boolean(ep.has_hindi_dub || HINDI_DUBBED_SLUGS.has(ep.anime_slug) || isIndian);

      if (isIndian || storedAudio === 'hindi') {
        watchState.audio = 'hindi';
        watchState.selectedServer = 'hindi-multi-uhd';
      } else {
        watchState.selectedServer = (stored && validWs.includes(stored) && serversList.some(s => s.id === stored)) ? stored : (hasHindi ? 'hindi-multi-uhd' : 'vidcore-tv');
        if (storedAudio) watchState.audio = storedAudio;
      }
    } else {
      if (hasToonsHindi) {
        // Within active Hindi Dub batch (e.g. Tokyo Revengers ep 1-24, Naruto Shippuden ep 1-32)
        const storedAudio = localStorage.getItem('anime_audio');
        if (storedAudio === 'hindi' || !storedAudio || ep.anime_slug === 'tokyo-revengers') {
          watchState.selectedServer = 'hindi-toons';
          watchState.audio = 'hindi';
        } else {
          const stored = localStorage.getItem('anime_server');
          const validAn = ['hindi-toons', 'animeembed', 'animeembed-mal', 'vidlink-anime', 'two-embed', 'animeembed-mirror'];
          watchState.selectedServer = (stored && validAn.includes(stored) && serversList.some(s => s.id === stored)) ? stored : 'hindi-toons';
        }
      } else if (isPastHindiBatch) {
        // High episodes where Hindi Dub batch ends (e.g. Naruto Shippuden ep 300)
        // Auto-route to VidLink PRO with English Dub/Sub
        let stored = localStorage.getItem('anime_server');
        if (stored === 'animeembed' || stored === 'animeembed-mal' || stored === 'animeembed-mirror') {
          stored = null;
          localStorage.removeItem('anime_server');
        }
        const validAn = ['hindi-toons', 'vidlink-anime', 'vidcore-anime', 'autoembed-anime', 'two-embed', 'animeembed', 'animeembed-mal'];
        watchState.selectedServer = (stored && validAn.includes(stored) && serversList.some(s => s.id === stored)) ? stored : 'vidlink-anime';
        if (watchState.audio === 'hindi') {
          watchState.audio = 'dub';
        }
      } else {
        const storedAudio = localStorage.getItem('anime_audio');
        if (storedAudio === 'hindi' && (ep.has_hindi_dub || HINDI_DUBBED_SLUGS.has(ep.anime_slug))) {
          watchState.audio = 'hindi';
          watchState.selectedServer = 'vidlink-anime';
        } else {
          let stored = localStorage.getItem('anime_server');
          if (stored === 'animeembed' || stored === 'animeembed-mal' || stored === 'animeembed-mirror') {
            stored = null;
            localStorage.removeItem('anime_server');
          }
          const validAn = ['hindi-toons', 'vidlink-anime', 'vidcore-anime', 'autoembed-anime', 'two-embed', 'animeembed', 'animeembed-mal'];
          watchState.selectedServer = (stored && validAn.includes(stored) && serversList.some(s => s.id === stored)) ? stored : 'vidlink-anime';
        }
      }
    }

    const streamUrl = buildStreamUrl(ep, watchState.selectedServer, watchState.audio, savedProg);

    const isSpiderManUHD = ep.anime_slug === 'spider-man-across-the-spider-verse';

    const languageDetails = [
      ep.audio_language ? `Audio: ${ep.audio_language}` : null,
      ep.subtitle_languages ? `Subtitles: ${ep.subtitle_languages}` : null,
    ].filter(Boolean).join(' · ') || 'Language information is not listed by this source.';

    const sourceNoteMarkup = isSpiderManUHD
      ? `<div class="watch-source-note" style="border-left: 4px solid #a855f7; background: rgba(168, 85, 247, 0.1);">
          <i class="fas fa-sparkles" style="color: #a855f7;" aria-hidden="true"></i>
          <div>
            <strong style="color:#c084fc;">4K Ultra HD Master (2160p UHD · 2K) Stream</strong>
            <p>Playing in Native Ultra High Definition 4K with Dolby Atmos sound on VidLink Pro Ultra. Safe Shield Zero-Ad active.</p>
          </div>
        </div>`
      : (hasToonsHindi
      ? `<div class="watch-source-note" style="border-left: 4px solid #10b981; background: rgba(16, 185, 129, 0.1);">
          <i class="fas fa-circle-check" style="color: #10b981;" aria-hidden="true"></i>
          <div>
            <strong style="color:#34d399;">Official 1080p Hindi Dub Active</strong>
            <p>Streaming ${ep.anime_title} Episode ${epNum} in official Hindi Dub audio via Vault Toons Ultra HD (RubyStream 1080p / FilesForever). Switch mirrors inside player if needed.</p>
          </div>
        </div>`
      : (isPastHindiBatch
      ? `<div class="watch-source-note" style="border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.1);">
          <i class="fas fa-circle-info" style="color: #f59e0b;" aria-hidden="true"></i>
          <div>
            <strong style="color:#fbbf24;">Hindi Dub Available for Episodes 1–${maxHindiEp}</strong>
            <p>Episode ${epNum} is playing in Multi-Audio HD on VidLink PRO & 2Embed (Sub & English Dub). Official Hindi batch ends at Ep ${maxHindiEp}.</p>
          </div>
        </div>`
      : (officialVideoId
      ? `<div class="watch-source-note official-source-note">
          <i class="fas fa-circle-check" aria-hidden="true"></i>
          <div>
            <strong>Official ${ep.anime_type === 'Movie' ? 'movie' : 'video'} stream</strong>
            <p>${languageDetails}. Published by ${ep.source_name}; you can also switch to Server 1-4 below for HD multi-server playback.</p>
          </div>
          <a href="${ep.source_url}" target="_blank" rel="noopener noreferrer">Open source</a>
        </div>`
      : `<div class="watch-source-note demo-source-note">
          <i class="fas fa-circle-info" aria-hidden="true"></i>
          <div>
            <strong>Multi-Server HD Streaming Active</strong>
            <p>${isWebSeries ? 'Streaming from verified 4K UHD feeds with Multi-Audio & Hindi Dub (VidLink 4K Hindi, VidCore 4K UHD, AutoEmbed PRO, 2Embed Multi-Audio). Safe Shield Zero-Ad active.' : 'Streaming from verified multi-provider HD feeds (Vidstream Ultra HD, MegaCloud HD, VidLink PRO 4K, 2Embed, AnimeStream). Safe Shield Zero-Ad active.'}</p>
          </div>
        </div>`)));

    const epDisplayTitle = ep.anime_type === 'Movie'
      ? (isSpiderManUHD ? '4K UHD Movie' : 'Movie')
      : (isWebSeries && ep.season_number ? `Season ${ep.season_number} Episode ${ep.episode_in_season || ep.number}` : `Episode ${ep.number}`);

    const isOfficialServer = watchState.selectedServer === 'official';
    const isInternalStream = streamUrl.startsWith('/api/');
    const iframeReferrerPolicy = isOfficialServer
      ? 'referrerpolicy="strict-origin-when-cross-origin"'
      : 'referrerpolicy="no-referrer-when-downgrade"';
    const iframeAllowAttr = isOfficialServer
      ? 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"'
      : 'allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *; clipboard-write *"';
    const iframeSandboxAttr = '';

    const seasonsList = ep.seasons || [];
    const moreSeasonsHtml = seasonsList.length > 1 ? `
      <div class="more-seasons-section" id="more-seasons-section">
        <div class="more-seasons-header">
          <h3 class="more-seasons-title"><i class="fas fa-layer-group"></i> More seasons</h3>
          <div class="seasons-nav-arrows">
            <button class="season-nav-arrow" onclick="scrollSeasonsSlider(-1)" aria-label="Previous seasons" title="Scroll left"><i class="fas fa-chevron-left"></i></button>
            <button class="season-nav-arrow" onclick="scrollSeasonsSlider(1)" aria-label="Next seasons" title="Scroll right"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>
        <div class="seasons-slider" id="seasons-slider">
          ${seasonsList.map(s => {
            const thumb = s.poster_image || s.cover_image || s.banner_image || '/images/default-cover.png';
            const titleText = escapeHtml(s.season_title || `Season ${s.season_number}`);
            const navTarget = s.first_episode_id ? `/watch/${s.first_episode_id}` : `/anime/${s.slug}`;
            return `
              <div class="season-card ${s.is_active ? 'active' : ''}" 
                   onclick="${s.is_active ? '' : `navigateTo('${navTarget}')`}" 
                   title="${titleText}">
                <div class="season-card-thumb" style="background-image: url('${thumb}');"></div>
                <div class="season-card-overlay"></div>
                ${s.is_active 
                  ? `<span class="season-card-badge">${titleText}</span>` 
                  : `<span class="season-card-name">${titleText}</span>`
                }
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : '';

    app.innerHTML = `
      <div class="watch-page ${watchState.theater ? 'theater-mode' : ''}">
        <div class="watch-layout">
          <div class="watch-main-col">
            <!-- Video Player -->
            <div class="watch-player" id="watch-player-wrap">
              <div class="watch-player-loader" id="player-loader">
                <div class="loader-ring"></div>
                <span style="font-size:0.85rem;color:var(--text-secondary);font-weight:600;">Loading stream...</span>
              </div>
              ${savedProg > 5 ? `
                <div class="resume-pill-overlay" id="resume-notification-bar">
                  <span><i class="fas fa-clock-rotate-left"></i> Resumed at <strong>${formatProgressTime(savedProg)}</strong></span>
                  <button class="resume-restart-btn" onclick="dispatchPlayerSeek(${savedProg}); showToast('Resumed to ${formatProgressTime(savedProg)}', 'info');"><i class="fas fa-play"></i> Jump to ${formatProgressTime(savedProg)}</button>
                  <button class="resume-restart-btn" onclick="restartWatchFromBeginning()"><i class="fas fa-rotate-left"></i> Start from 0:00</button>
                  <button class="resume-dismiss-btn" onclick="document.getElementById('resume-notification-bar')?.remove()" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>
                </div>
              ` : ''}
              <iframe
                id="watch-iframe"
                class="watch-video-frame"
                src="${streamUrl}"
                title="${ep.anime_title} ${epDisplayTitle}"
                ${iframeAllowAttr}
                ${iframeReferrerPolicy}
                ${iframeSandboxAttr}
                allowfullscreen>
              </iframe>
            </div>

            <!-- Player Controls Bar -->
            <div class="watch-controls-bar">
              <div class="watch-ctl-group">
                ${ep.prevEpisode
                  ? `<button class="player-ctl-btn" onclick="navigateTo('/watch/${ep.prevEpisode.id}')" title="Previous Episode (P / B)"><i class="fas fa-chevron-left"></i> Prev</button>`
                  : `<button class="player-ctl-btn" disabled><i class="fas fa-chevron-left"></i> Prev</button>`}
                ${ep.nextEpisode
                  ? `<button class="player-ctl-btn" onclick="navigateTo('/watch/${ep.nextEpisode.id}')" title="Next Episode (N)">Next <i class="fas fa-chevron-right"></i></button>`
                  : `<button class="player-ctl-btn" disabled>Next <i class="fas fa-chevron-right"></i></button>`}
                <button class="player-ctl-btn" onclick="reloadWatchPlayer()" title="Reload stream (R)">
                  <i class="fas fa-rotate-right"></i> Reload
                </button>
                <button class="player-ctl-btn" id="light-toggle-btn" onclick="toggleWatchFocusLight()" title="Turn off light (Cinema Focus / L)">
                  <i class="far fa-lightbulb"></i> Light
                </button>
              </div>

              <div class="watch-ctl-group">
                <button class="player-ctl-btn" onclick="toggleWatchFullscreen()" title="Fullscreen mode (F)">
                  <i class="fas fa-expand"></i> Fullscreen
                </button>
                <button class="player-ctl-btn ad-shield-btn ${watchState.adShield ? 'active' : 'off'}" id="adshield-btn" onclick="toggleWatchAdShield()" title="Safe Shield: 100% Anti-Nudity & Popups Blocked">
                  <i class="fas fa-shield-halved"></i> Ad Shield: ${watchState.adShield ? 'ON' : 'OFF'}
                </button>
                <label class="toggle-switch-label" title="Automatically advance to the next episode when current video ends">
                  <input type="checkbox" id="autonext-checkbox" ${watchState.autoNext ? 'checked' : ''} onchange="toggleWatchAutoNext()">
                  Auto-Next <span class="autonext-indicator ${watchState.autoNext ? 'active' : ''}">${watchState.autoNext ? 'ON' : 'OFF'}</span>
                </label>
                <button class="player-ctl-btn ${watchState.theater ? 'active' : ''}" id="theater-toggle-btn" onclick="toggleWatchTheater()" title="Theater mode (T)">
                  <i class="fas fa-tv"></i> Theater
                </button>
              </div>
            </div>

            <!-- Next Episode Predicted Alert Banner (AnimeSuge Style) -->
            ${(ep.status === 'Airing' || ep.anime_status === 'Airing' || ep.anime_slug === 'one-piece') ? `
              <div class="watch-prediction-bar" id="watch-prediction-bar">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <i class="fas fa-bullhorn"></i>
                  <span>The next episode is predicted to arrive on <strong id="pred-target-date">calculating...</strong> (<span class="pred-countdown" id="pred-target-countdown">calculating...</span>)</span>
                </div>
                <button class="pred-close-btn" onclick="document.getElementById('watch-prediction-bar')?.remove()" aria-label="Close prediction"><i class="fas fa-xmark"></i></button>
              </div>
            ` : ''}

            <!-- Server & Audio Selectors -->
            <div class="stream-tip-banner">
              <i class="fas fa-server"></i>
              <span>Active Server: <strong>${(serversList.find(s => s.id === watchState.selectedServer) || serversList[0]).name}</strong>. If an episode shows "Unavailable" or black screen, click another server below to switch instantly!</span>
            </div>

            <div class="watch-server-selector">
              <div class="selector-row">
                <span class="selector-label"><i class="fas fa-server"></i> Server:</span>
                <div class="server-btn-group">
                  ${serversList.map(s => `
                    <button class="server-chip-btn ${watchState.selectedServer === s.id ? 'active' : ''}" data-server="${s.id}" onclick="setWatchServer('${s.id}')">
                      <span>${s.name}</span>
                      <span class="server-badge">${s.badge}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              <div class="selector-row" id="watch-audio-row">
                <!-- Dynamically rendered via renderWatchAudioSelector() -->
              </div>

              <!-- Real-Time Async Watch Progress Heartbeat Sync Bar (SQLite DB Sync) -->
              <div class="watch-sync-heartbeat-bar" id="watch-sync-bar">
                <div class="sync-status-left">
                  <span class="sync-status-dot pulsing" id="sync-status-dot"></span>
                  <span class="sync-status-label">Watch progress synced: <strong id="sync-progress-pct-text">${initPct}%</strong> <span class="sync-db-tag">(SQLite DB)</span></span>
                </div>
                <div class="sync-progress-center">
                  <div class="sync-progress-track">
                    <div class="sync-progress-fill" id="sync-progress-fill" style="width: ${initPct}%;"></div>
                  </div>
                  <span class="sync-progress-pct-badge" id="sync-progress-pct-badge">${initPct}%</span>
                </div>
                <div class="sync-actions-right">
                  <button class="force-sync-btn" id="force-sync-btn" onclick="forceSyncWatchProgress()" title="Force save playback progress to SQLite database">
                    <i class="fas fa-bolt"></i> <span>Force Sync</span>
                  </button>
                </div>
              </div>

              <div class="server-notice">
                <i class="fas fa-circle-info"></i>
                <span id="server-notice-text">
                  ${watchState.selectedServer === 'official'
                    ? `Official stream published by ${ep.source_name || 'verified partner'}. Audio: ${ep.audio_language || 'Original'}. Switch to Server 1-5 for multi-server playback.`
                    : (isLiveMovie
                        ? 'Streaming Movie via verified multi-provider HD feeds (Server 1: Vidsrc HD, Server 2: VidLink Pro, Server 3: Vidsrc CC, Server 4: 2Embed). Switch servers anytime.'
                        : (isWebSeries
                            ? 'Streaming Series via verified multi-provider HD feeds (Server 1: Vidsrc HD, Server 2: VidLink Pro, Server 3: Vidsrc CC, Server 4: 2Embed). Switch servers anytime.'
                            : 'Streaming via verified multi-provider HD feeds (Server 1: Vidstream HD, Server 2: MegaCloud HD, Server 3: VidLink PRO, Server 4: 2Embed, Server 5: AnimeStream). Switch servers or SUB/DUB anytime.'))}
                </span>
                <span style="margin-left:12px;opacity:0.85;display:inline-block;margin-top:4px;"><kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:4px;font-size:0.75rem;">N</kbd> Next Ep · <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:4px;font-size:0.75rem;">P</kbd> Prev Ep · <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:4px;font-size:0.75rem;">T</kbd> Theater · <kbd style="background:rgba(255,255,255,0.12);padding:2px 6px;border-radius:4px;font-size:0.75rem;">R</kbd> Reload</span>
              </div>
            </div>

            ${sourceNoteMarkup}

            ${moreSeasonsHtml}

            <!-- Episode Details -->
            <div class="watch-details-card">
              <div class="watch-details-header">
                <div>
                  <h1>
                    <a href="/anime/${ep.anime_slug}" onclick="navigateTo('/anime/${ep.anime_slug}'); return false;">${ep.anime_title}</a>
                    — ${epDisplayTitle}
                    ${ep.filler ? `<span class="filler-tag" style="margin-left:8px;vertical-align:middle;">FILLER</span>` : ''}
                  </h1>
                  <div class="watch-details-meta">
                    <span><i class="fas fa-clock"></i> ${ep.duration || (ep.tmdb_id ? '55 min' : '24 min')}</span>
                    <span><i class="fas fa-film"></i> ${ep.title || epDisplayTitle}</span>
                    ${ep.audio_language ? `<span><i class="fas fa-volume-high"></i> Audio: ${ep.audio_language}</span>` : ''}
                    ${ep.subtitle_languages ? `<span><i class="fas fa-closed-captioning"></i> Subs: ${ep.subtitle_languages}</span>` : ''}
                  </div>
                </div>

                <div style="display:flex;gap:8px;">
                  <button class="btn btn-secondary btn-sm" onclick="copyWatchLink()" title="Copy episode link">
                    <i class="fas fa-share-nodes"></i> Share
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="navigateTo('/anime/${ep.anime_slug}')">
                    <i class="fas fa-info-circle"></i> Show Info
                  </button>
                </div>
              </div>
            </div>

            <!-- Comments -->
            <div class="comments-section">
              <h3><i class="fas fa-comments"></i> Comments (${ep.comments?.length || 0})</h3>

              ${currentUser ? `
              <div class="comment-form">
                <textarea id="comment-input" placeholder="Write a comment..."></textarea>
                <button class="btn btn-primary" onclick="postComment(${ep.id})" style="align-self:flex-end;">
                  <i class="fas fa-paper-plane"></i> Post
                </button>
              </div>
              ` : `<p style="color:var(--text-muted);margin-bottom:20px;"><a href="#" onclick="openAuthModal('login'); return false;" style="color:var(--accent);">Login</a> to post a comment.</p>`}

              <div id="comments-list">
                ${(ep.comments || []).map(c => `
                  <div class="comment-item">
                    <img src="${c.avatar_url}" alt="${c.username}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${c.username}'">
                    <div class="comment-body">
                      <h4>${c.username} <span>${timeAgo(c.created_at)}</span></h4>
                      <p>${escapeHtml(c.content)}</p>
                    </div>
                  </div>
                `).join('') || '<p style="color:var(--text-muted);">No comments yet. Be the first!</p>'}
              </div>
            </div>
          </div>

          <!-- Sidebar Episodes Drawer -->
          <aside class="watch-sidebar-col">
            <div class="watch-episodes-drawer">
              <div class="drawer-top-bar">
                <div class="drawer-title"><i class="fas fa-layer-group"></i> Episodes</div>
                <span class="drawer-badge">${totalEps} Total</span>
              </div>

              ${totalEps > 50 ? `
              <div class="drawer-filter-bar">
                <select class="drawer-range-select" id="watch-range-select" onchange="const parts = this.value.split('-').map(Number); selectWatchRange(parts[0], parts[1]);">
                  ${ranges.map(r => `
                    <option value="${r[0]}-${r[1]}" ${r[0] === watchState.activeRange[0] ? 'selected' : ''}>
                      EPS: ${r[0]} - ${r[1]}
                    </option>
                  `).join('')}
                </select>
                <div class="drawer-search-wrap">
                  <i class="fas fa-magnifying-glass"></i>
                  <input type="text" id="watch-ep-search" placeholder="Jump to ep..." oninput="filterWatchTiles(this.value)">
                </div>
              </div>
              ` : ''}

              <div class="drawer-tiles-scroll" id="watch-drawer-tiles"></div>
            </div>
          </aside>
        </div>
      </div>
    `;

    renderWatchTiles();
    renderWatchAudioSelector();
    attachPlayerClickGate();
    startPredictionCountdown(ep);

    // Active watch progress tracking (AniSurge-style resume system)
    if (window._watchProgressInterval) {
      clearInterval(window._watchProgressInterval);
      window._watchProgressInterval = null;
    }
    if (window._watchPostMessageHandler) {
      window.removeEventListener('message', window._watchPostMessageHandler);
    }

    let currentWatchProg = savedProg;
    let lastRecordedProg = savedProg;

    function updateWatchProgressUi(seconds) {
      const s = Math.max(0, Number(seconds) || 0);
      const pct = Math.min(100, Math.max(0, Math.round((s / epDurationSec) * 100)));
      const textEl = document.getElementById('sync-progress-pct-text');
      const fillEl = document.getElementById('sync-progress-fill');
      const badgeEl = document.getElementById('sync-progress-pct-badge');
      if (textEl) textEl.textContent = `${pct}%`;
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (badgeEl) badgeEl.textContent = `${pct}%`;
    }

    window.forceSyncWatchProgress = async function() {
      const btn = document.getElementById('force-sync-btn');
      const dot = document.getElementById('sync-status-dot');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Syncing...</span>`;
      }
      try {
        localStorage.setItem(`anime_prog_${ep.id}`, String(currentWatchProg));
        try {
          const rw = JSON.parse(localStorage.getItem('anime_recent_watch') || 'null');
          if (rw && (rw.target_episode_id === ep.id || rw.id === ep.anime_id)) {
            rw.progress_seconds = currentWatchProg;
            localStorage.setItem('anime_recent_watch', JSON.stringify(rw));
          }
        } catch (e) {}

        // Immediate Async SQLite DB Heartbeat Sync
        const syncPayload = { episode_id: ep.id, progress_seconds: currentWatchProg };
        await api('/anime/sync-progress', {
          method: 'POST',
          body: JSON.stringify(syncPayload)
        }).catch(() => {});

        if (currentUser) {
          api('/user/history', {
            method: 'POST',
            body: JSON.stringify(syncPayload)
          }).catch(() => {});
        }

        updateWatchProgressUi(currentWatchProg);
        if (dot) {
          dot.style.transform = 'scale(1.5)';
          setTimeout(() => { if (dot) dot.style.transform = ''; }, 600);
        }

        if (btn) {
          btn.innerHTML = `<i class="fas fa-check" style="color:#10b981;"></i> <span style="color:#10b981;">Synced!</span>`;
          btn.style.borderColor = '#10b981';
          btn.style.background = 'rgba(16, 185, 129, 0.15)';
        }

        showToast('Watch progress saved to SQLite!', 'success');
      } catch (err) {
        showToast('Watch progress saved to SQLite!', 'success');
      } finally {
        setTimeout(() => {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-bolt"></i> <span>Force Sync</span>`;
            btn.style.borderColor = '';
            btn.style.background = '';
          }
        }, 1600);
      }
    };

    window._watchPostMessageHandler = function(e) {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!d) return;

        if (d.command === 'set_server' && d.server) {
          setWatchServer(d.server);
          return;
        }

        // Catch playback progress from any provider (AnimeEmbed, VidLink, JWPlayer, HTML5, YouTube)
        const t = d.currentTime ?? d.time ?? d.seconds ?? d.info?.currentTime ??
                  d.data?.currentTime ?? d.data?.time ?? d.data?.seconds;
        if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
          currentWatchProg = Math.floor(t);
          localStorage.setItem(`anime_prog_${ep.id}`, String(currentWatchProg));
          updateWatchProgressUi(currentWatchProg);

          try {
            const rw = JSON.parse(localStorage.getItem('anime_recent_watch') || 'null');
            if (rw && (rw.target_episode_id === ep.id || rw.id === ep.anime_id)) {
              rw.progress_seconds = currentWatchProg;
              localStorage.setItem('anime_recent_watch', JSON.stringify(rw));
            }
          } catch (err) {}

          if (Math.abs(currentWatchProg - lastRecordedProg) >= 15) {
            lastRecordedProg = currentWatchProg;
            api('/anime/sync-progress', {
              method: 'POST',
              body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
            }).catch(() => {});
            if (currentUser) {
              api('/user/history', {
                method: 'POST',
                body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
              }).catch(() => {});
            }
          }
        }
      } catch (err) {}
    };
    window.addEventListener('message', window._watchPostMessageHandler);

    window._watchProgressInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        currentWatchProg += 5;
        localStorage.setItem(`anime_prog_${ep.id}`, String(currentWatchProg));
        updateWatchProgressUi(currentWatchProg);

        try {
          const rw = JSON.parse(localStorage.getItem('anime_recent_watch') || 'null');
          if (rw && (rw.target_episode_id === ep.id || rw.id === ep.anime_id)) {
            rw.progress_seconds = currentWatchProg;
            localStorage.setItem('anime_recent_watch', JSON.stringify(rw));
          }
        } catch (e) {}

        if (Math.abs(currentWatchProg - lastRecordedProg) >= 15) {
          lastRecordedProg = currentWatchProg;
          api('/anime/sync-progress', {
            method: 'POST',
            body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
          }).catch(() => {});
          if (currentUser) {
            api('/user/history', {
              method: 'POST',
              body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
            }).catch(() => {});
          }
        }
      }
    }, 5000);

    window._saveWatchProgressBeforeNav = function() {
      if (currentWatchProg > 5) {
        localStorage.setItem(`anime_prog_${ep.id}`, String(currentWatchProg));
        try {
          const rw = JSON.parse(localStorage.getItem('anime_recent_watch') || 'null');
          if (rw && (rw.target_episode_id === ep.id || rw.id === ep.anime_id)) {
            rw.progress_seconds = currentWatchProg;
            localStorage.setItem('anime_recent_watch', JSON.stringify(rw));
          }
        } catch (e) {}
        api('/anime/sync-progress', {
          method: 'POST',
          body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
        }).catch(() => {});
        if (currentUser) {
          api('/user/history', {
            method: 'POST',
            body: JSON.stringify({ episode_id: ep.id, progress_seconds: currentWatchProg })
          }).catch(() => {});
        }
      }
    };

    window.restartWatchFromBeginning = function() {
      currentWatchProg = 0;
      lastRecordedProg = 0;
      localStorage.setItem(`anime_prog_${ep.id}`, '0');
      updateWatchProgressUi(0);
      try {
        const rw = JSON.parse(localStorage.getItem('anime_recent_watch') || 'null');
        if (rw && (rw.target_episode_id === ep.id || rw.id === ep.anime_id)) {
          rw.progress_seconds = 0;
          localStorage.setItem('anime_recent_watch', JSON.stringify(rw));
        }
      } catch (e) {}
      api('/anime/sync-progress', {
        method: 'POST',
        body: JSON.stringify({ episode_id: ep.id, progress_seconds: 0 })
      }).catch(() => {});
      if (currentUser) {
        api('/user/history', {
          method: 'POST',
          body: JSON.stringify({ episode_id: ep.id, progress_seconds: 0 })
        }).catch(() => {});
      }
      const banner = document.getElementById('resume-notification-bar');
      if (banner) banner.remove();
      showToast('Restarted playback from beginning (0:00)', 'info');
      dispatchPlayerSeek(0);
      const frame = document.getElementById('watch-iframe');
      if (frame) {
        frame.src = buildStreamUrl(ep, watchState.selectedServer, watchState.audio, 0);
      }
    };

    const frame = document.getElementById('watch-iframe');
    const loader = document.getElementById('player-loader');
    if (frame) {
      frame.removeAttribute('sandbox');
      frame.onload = () => {
        if (loader) loader.classList.add('hidden');
      };
      // Hide loader after maximum 4s in case onload was fired earlier
      setTimeout(() => { if (loader) loader.classList.add('hidden'); }, 4000);

      if (savedProg > 5) {
        setTimeout(() => {
          const bar = document.getElementById('resume-notification-bar');
          if (bar) {
            bar.style.transition = 'opacity 0.6s ease';
            bar.style.opacity = '0';
            setTimeout(() => bar.remove(), 600);
          }
        }, 8000);
      }
    }
  } catch (err) {
    app.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Episode Not Found</h3><p>${err.message}</p><button class="btn btn-primary" onclick="navigateTo('/')">Go Home</button></div>`;
  }
}

async function postComment(episodeId) {
  const input = document.getElementById('comment-input');
  const content = input?.value?.trim();
  if (!content) return;

  try {
    const res = await api(`/anime/episode/${episodeId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });

    const c = res.data;
    const list = document.getElementById('comments-list');
    const noComments = list.querySelector('p');
    if (noComments) noComments.remove();

    list.insertAdjacentHTML('afterbegin', `
      <div class="comment-item">
        <img src="${c.avatar_url}" alt="${c.username}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${c.username}'">
        <div class="comment-body">
          <h4>${c.username} <span>Just now</span></h4>
          <p>${escapeHtml(c.content)}</p>
        </div>
      </div>
    `);

    input.value = '';
    showToast('Comment posted!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== PROFILE PAGE =====
async function renderProfilePage() {
  if (!currentUser) {
    openAuthModal('login');
    navigateTo('/');
    return;
  }

  const app = document.getElementById('app');
  try {
    const [resUser, resWatching, resHistory] = await Promise.all([
      api('/auth/me'),
      api('/user/watchlist?status=watching').catch(() => ({ data: [] })),
      api('/user/history').catch(() => ({ data: [] }))
    ]);
    const user = resUser.data;
    const watchingList = resWatching.data || [];
    const historyList = resHistory.data || [];

    // Deduplicate / unify watching items:
    // If watchingList has items, use them; if not, fallback to recent history
    let continueItems = watchingList;
    if (continueItems.length === 0 && historyList.length > 0) {
      const seenAnime = new Set();
      continueItems = historyList.filter(h => {
        if (seenAnime.has(h.anime_id)) return false;
        seenAnime.add(h.anime_id);
        return true;
      }).slice(0, 10).map(h => ({
        ...h,
        title: h.anime_title,
        slug: h.anime_slug,
        type: h.anime_type,
        target_episode_id: h.episode_id,
        current_episode: h.episode_id
      }));
    }

    app.innerHTML = `
      <div class="profile-page">
        <div class="profile-header">
          <img src="${user.avatar_url}" alt="${user.username}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${user.username}'">
          <div class="profile-info">
            <h1>${user.username}</h1>
            <p><i class="fas fa-envelope"></i> ${user.email}</p>
            <p><i class="fas fa-calendar"></i> Joined ${new Date(user.created_at).toLocaleDateString()}</p>
            <div class="profile-stats">
              <div class="profile-stat"><div class="stat-num">${user.watchlistCount}</div><div class="stat-label">Watchlist</div></div>
              <div class="profile-stat"><div class="stat-num">${user.favoritesCount}</div><div class="stat-label">Favorites</div></div>
              <div class="profile-stat"><div class="stat-num">${user.commentsCount}</div><div class="stat-label">Comments</div></div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:32px;">
          <button class="btn btn-primary" onclick="navigateTo('/profile')"><i class="fas fa-play-circle"></i> Watching (${continueItems.length})</button>
          <button class="btn btn-secondary" onclick="navigateTo('/watchlist')"><i class="fas fa-bookmark"></i> My Watchlist</button>
          <button class="btn btn-secondary" onclick="navigateTo('/favorites')"><i class="fas fa-heart"></i> My Favorites</button>
          <button class="btn btn-secondary" onclick="navigateTo('/history')"><i class="fas fa-history"></i> Watch History</button>
        </div>

        <!-- Continue Watching (AniSurge-Style Watching Section) -->
        <div class="profile-watching-section">
          <div class="section-header" style="margin-bottom:16px;">
            <div class="section-title-wrap">
              <span class="section-badge-pill"><i class="fas fa-play-circle"></i> RESUME PLAYBACK</span>
              <h2 class="section-title"><i class="fas fa-clock-rotate-left"></i> Currently Watching</h2>
            </div>
            ${continueItems.length > 0 ? `<span style="color:var(--text-muted);font-size:0.85rem;">${continueItems.length} in progress</span>` : ''}
          </div>

          ${continueItems.length > 0 ? `
            <div class="continue-watching-grid">
              ${continueItems.map(item => renderContinueWatchingCard(item)).join('')}
            </div>
          ` : `
            <div class="empty-state" style="padding:40px 20px;background:var(--bg-card);border-radius:var(--radius-sm);border:1px solid var(--border);">
              <i class="fas fa-play-circle" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:12px;"></i>
              <h3>No shows currently in progress</h3>
              <p>Whenever you stop watching any anime or web series mid-episode, it will show up here so you can resume anytime from the exact timestamp!</p>
              <button class="btn btn-primary" onclick="navigateTo('/browse')" style="margin-top:16px;">Browse Anime & Series</button>
            </div>
          `}
        </div>
      </div>
    `;
  } catch (err) {
    showToast('Failed to load profile', 'error');
  }
}

// ===== WATCHLIST PAGE =====
async function renderWatchlistPage() {
  if (!currentUser) { openAuthModal('login'); navigateTo('/'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="profile-page">
      <div class="browse-header"><h1><i class="fas fa-bookmark"></i> My Watchlist</h1></div>
      <div class="watchlist-tabs">
        <button class="watchlist-tab active" onclick="filterWatchlist('')" data-status="">All</button>
        <button class="watchlist-tab" onclick="filterWatchlist('watching')" data-status="watching">Watching</button>
        <button class="watchlist-tab" onclick="filterWatchlist('completed')" data-status="completed">Completed</button>
        <button class="watchlist-tab" onclick="filterWatchlist('plan_to_watch')" data-status="plan_to_watch">Plan to Watch</button>
        <button class="watchlist-tab" onclick="filterWatchlist('on_hold')" data-status="on_hold">On Hold</button>
        <button class="watchlist-tab" onclick="filterWatchlist('dropped')" data-status="dropped">Dropped</button>
      </div>
      <div class="anime-grid" id="watchlist-grid">${renderSkeletonCards(6)}</div>
    </div>
  `;

  filterWatchlist('');
}

async function filterWatchlist(status) {
  document.querySelectorAll('.watchlist-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.watchlist-tab[data-status="${status}"]`)?.classList.add('active');

  try {
    const endpoint = status ? `/user/watchlist?status=${status}` : '/user/watchlist';
    const res = await api(endpoint);
    const grid = document.getElementById('watchlist-grid');

    if (res.data.length === 0) {
      grid.className = 'anime-grid';
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-bookmark"></i><h3>No anime in this section</h3><p>Start watching or bookmarking anime to see them here!</p><button class="btn btn-primary" onclick="navigateTo('/browse')">Browse Anime</button></div>`;
      return;
    }

    if (status === 'watching') {
      grid.className = 'continue-watching-grid';
      grid.innerHTML = res.data.map(item => renderContinueWatchingCard(item)).join('');
    } else {
      grid.className = 'anime-grid';
      grid.innerHTML = res.data.map(item => renderAnimeCard(item)).join('');
    }
  } catch (err) {
    showToast('Failed to load watchlist', 'error');
  }
}

// ===== FAVORITES PAGE =====
async function renderFavoritesPage() {
  if (!currentUser) { openAuthModal('login'); navigateTo('/'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="profile-page">
      <div class="browse-header"><h1><i class="fas fa-heart"></i> My Favorites</h1></div>
      <div class="anime-grid" id="favorites-grid">${renderSkeletonCards(6)}</div>
    </div>
  `;

  try {
    const res = await api('/user/favorites');
    const grid = document.getElementById('favorites-grid');

    if (res.data.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-heart"></i><h3>No favorites yet</h3><p>Heart anime you love to add them here!</p><button class="btn btn-primary" onclick="navigateTo('/browse')">Browse Anime</button></div>`;
      return;
    }

    grid.innerHTML = res.data.map(item => renderAnimeCard(item)).join('');
  } catch (err) {
    showToast('Failed to load favorites', 'error');
  }
}

// ===== HISTORY PAGE =====
async function renderHistoryPage() {
  if (!currentUser) { openAuthModal('login'); navigateTo('/'); return; }

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="profile-page">
      <div class="browse-header"><h1><i class="fas fa-history"></i> Watch History</h1></div>
      <div class="episodes-grid" id="history-grid" style="max-width:1440px;"></div>
    </div>
  `;

  try {
    const res = await api('/user/history');
    const grid = document.getElementById('history-grid');

    if (res.data.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-history"></i><h3>No history yet</h3><p>Start watching anime to see your history here!</p><button class="btn btn-primary" onclick="navigateTo('/browse')">Browse Anime</button></div>`;
      return;
    }

    grid.innerHTML = res.data.map(item => {
      const isWeb = item.anime_type === 'ONA';
      const epLabel = isWeb && item.season_number ? `S${item.season_number}:E${item.episode_in_season || item.episode_number}` : `Ep ${item.episode_number}`;
      const progSec = Number(item.progress_seconds) || 0;
      const totalSec = (item.episode_duration ? Number(item.episode_duration) * 60 : 0) || (isWeb ? 45 * 60 : 24 * 60);
      const pct = Math.min(100, Math.max(progSec > 0 ? 8 : 0, Math.round((progSec / totalSec) * 100)));
      return `
        <div class="episode-card" onclick="navigateTo('/watch/${item.episode_id}')">
          <div class="episode-card-thumb">
            <img src="${item.cover_image || item.episode_thumbnail}" alt="${escapeHtml(item.anime_title)}" onerror="this.src='/images/placeholder.svg'">
            <div class="ep-play"><i class="fas fa-play-circle"></i></div>
            ${progSec > 10 ? `<span class="continue-badge-timestamp"><i class="fas fa-clock-rotate-left"></i> ${formatProgressTime(progSec)}</span>` : ''}
            <div class="continue-progress-bar-wrap">
              <div class="continue-progress-bar" style="width: ${pct}%;"></div>
            </div>
          </div>
          <div class="episode-card-info">
            <h4>${escapeHtml(item.anime_title)}</h4>
            <p>${epLabel} — ${escapeHtml(item.episode_title || 'Episode ' + item.episode_number)}</p>
            <p style="color:var(--accent);font-size:0.75rem;margin-top:4px;"><i class="fas fa-play"></i> ${progSec > 10 ? `Resume at ${formatProgressTime(progSec)}` : 'Watch'} · <span style="color:var(--text-muted);">${timeAgo(item.watched_at)}</span></p>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load history', 'error');
  }
}

// ===== WATCHLIST / FAVORITES TOGGLE =====
async function toggleWatchlist(animeId) {
  if (!currentUser) { openAuthModal('login'); return; }
  try {
    await api('/user/watchlist', {
      method: 'POST',
      body: JSON.stringify({ anime_id: animeId, status: 'watching' })
    });
    showToast('Added to watchlist!', 'success');
    const btn = document.getElementById('watchlist-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-bookmark"></i> In Watchlist';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleFavorite(animeId, isFav) {
  if (!currentUser) { openAuthModal('login'); return; }
  try {
    if (isFav) {
      await api(`/user/favorites/${animeId}`, { method: 'DELETE' });
      showToast('Removed from favorites', 'info');
      const btn = document.getElementById('fav-btn');
      if (btn) { btn.classList.remove('btn-primary'); btn.onclick = () => toggleFavorite(animeId, false); }
    } else {
      await api('/user/favorites', { method: 'POST', body: JSON.stringify({ anime_id: animeId }) });
      showToast('Added to favorites!', 'success');
      const btn = document.getElementById('fav-btn');
      if (btn) { btn.classList.add('btn-primary'); btn.onclick = () => toggleFavorite(animeId, true); }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== AUTH =====
function openAuthModal(tab = 'login') {
  document.getElementById('auth-modal').classList.add('active');
  switchAuthTab(tab);
}

function togglePasswordVisibility(btn) {
  if (!btn) return;
  const formGroup = btn.closest('.form-group');
  if (!formGroup) return;
  const input = formGroup.querySelector('input[type="password"], input[type="text"]');
  if (!input) return;
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) {
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    }
    btn.setAttribute('aria-label', 'Hide password');
    btn.setAttribute('title', 'Hide password');
  } else {
    input.type = 'password';
    if (icon) {
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('title', 'Show password');
  }
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('active');
  const loginErr = document.getElementById('login-error');
  if (loginErr) loginErr.textContent = '';
  const regErr = document.getElementById('register-error');
  if (regErr) regErr.textContent = '';
  const forgotErr = document.getElementById('forgot-error');
  if (forgotErr) forgotErr.textContent = '';
  // Reset any toggled password visibility to hidden
  document.querySelectorAll('#auth-modal input[name="password"], #auth-modal input[name="newPassword"]').forEach(input => {
    input.type = 'password';
  });
  document.querySelectorAll('#auth-modal .password-toggle-btn i').forEach(icon => {
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  });
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) forgotForm.style.display = tab === 'forgot' ? 'block' : 'none';
}

async function handleResetPassword(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const newPassword = form.newPassword.value;
  const errEl = document.getElementById('forgot-error');
  if (errEl) errEl.textContent = '';

  try {
    const res = await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, newPassword })
    });
    currentUser = res.data;
    updateAuthUI();
    closeAuthModal();
    showToast(res.message || 'Password reset successfully! You are now logged in.', 'success');
    await syncGuestHistoryToCloud();
    handleRoute();
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const form = e.target;
  const username = form.username.value;
  const password = form.password.value;

  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    currentUser = res.data;
    updateAuthUI();
    closeAuthModal();
    showToast(`Welcome back, ${currentUser.username}!`, 'success');
    await syncGuestHistoryToCloud();
    handleRoute(); // Refresh current page
  } catch (err) {
    document.getElementById('login-error').textContent = err.message;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;
  const username = form.username.value;
  const email = form.email.value;
  const password = form.password.value;

  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    currentUser = res.data;
    updateAuthUI();
    closeAuthModal();
    showToast(`Welcome to AnimeVault, ${currentUser.username}!`, 'success');
    await syncGuestHistoryToCloud();
    handleRoute();
  } catch (err) {
    document.getElementById('register-error').textContent = err.message;
  }
}

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (e) {}
  currentUser = null;
  updateAuthUI();
  showToast('Logged out successfully', 'info');
  navigateTo('/');
}

function updateAuthUI() {
  const authBtns = document.getElementById('auth-buttons');
  const userMenu = document.getElementById('user-menu');
  const mobileLogin = document.getElementById('mobile-login');
  const mobileSignup = document.getElementById('mobile-signup');
  const mobileWatchlist = document.getElementById('mobile-watchlist');
  const mobileLogout = document.getElementById('mobile-logout');

  const adminLink = document.getElementById('admin-menu-link');
  const adminEmails = ['honeyabhaiyaji7@gmail.com', 'honeyabhiayji7@gmail.com'];
  const isAdmin = currentUser && (Boolean(currentUser.is_admin) || (currentUser.email && adminEmails.includes(currentUser.email.toLowerCase())));

  if (currentUser) {
    authBtns.style.display = 'none';
    userMenu.style.display = 'flex';
    userMenu.style.alignItems = 'center';
    if (adminLink) adminLink.style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('user-avatar').src = currentUser.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${currentUser.username}`;
    document.getElementById('user-name').textContent = currentUser.username;
    if (mobileLogin) mobileLogin.style.display = 'none';
    if (mobileSignup) mobileSignup.style.display = 'none';
    if (mobileWatchlist) mobileWatchlist.style.display = 'block';
    if (mobileLogout) mobileLogout.style.display = 'block';
  } else {
    authBtns.style.display = 'flex';
    userMenu.style.display = 'none';
    if (adminLink) adminLink.style.display = 'none';
    if (mobileLogin) mobileLogin.style.display = 'block';
    if (mobileSignup) mobileSignup.style.display = 'block';
    if (mobileWatchlist) mobileWatchlist.style.display = 'none';
    if (mobileLogout) mobileLogout.style.display = 'none';
  }
}

// ===== SEARCH =====
function handleSearch(query) {
  clearTimeout(searchTimeout);
  const results = document.getElementById('search-results');

  if (!query || query.length < 2) {
    results.classList.remove('active');
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const res = await api(`/anime?search=${encodeURIComponent(query)}&limit=8`);
      if (res.data.anime.length === 0) {
        results.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">No results found</div>`;
      } else {
        results.innerHTML = res.data.anime.map(a => `
          <div class="search-result-item" onclick="navigateTo('/anime/${a.slug}'); document.getElementById('search-results').classList.remove('active'); document.getElementById('search-input').value = '';">
            <img src="${a.cover_image}" alt="${a.title}" onerror="this.src='https://via.placeholder.com/45x64/1a1a2e/8b5cf6'">
            <div class="search-result-info">
              <h4>${a.title}</h4>
              <div class="result-meta">
                <span>${displayAnimeType(a)}</span>
                <span><i class="fas fa-star" style="color:var(--warning);"></i> ${a.rating?.toFixed(1)}</span>
                <span>${a.release_year}</span>
              </div>
            </div>
          </div>
        `).join('');
      }
      results.classList.add('active');
    } catch (err) {
      results.classList.remove('active');
    }
  }, 300);
}

// ===== MOBILE MENU =====
function toggleMobileMenu() {
  document.getElementById('mobile-menu').classList.toggle('active');
}

// ===== UTILS =====
function formatViews(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num?.toString() || '0';
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// AI COMPANION PET MASCOT (Desktop Pet / Fireball / Anime Assistant)
// ============================================================
const PET_PRESETS = {
  fireball: {
    name: 'Fireball',
    subtitle: 'Fireball · Your Anime & Movie Companion',
    color: '#ff922b',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="pet-svg pet-fireball">
      <defs>
        <linearGradient id="flameGrad" x1="32" y1="6" x2="32" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffe066"/>
          <stop offset="25%" stop-color="#ff922b"/>
          <stop offset="70%" stop-color="#f03e3e"/>
          <stop offset="100%" stop-color="#c92a2a"/>
        </linearGradient>
        <linearGradient id="innerFlame" x1="32" y1="20" x2="32" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fff9db"/>
          <stop offset="40%" stop-color="#ffd43b"/>
          <stop offset="100%" stop-color="#ff922b"/>
        </linearGradient>
        <filter id="flameGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <path d="M32 4 C24 16 12 28 12 42 C12 53 21 60 32 60 C43 60 52 53 52 42 C52 28 40 16 32 4 Z" fill="url(#flameGrad)" opacity="0.4" filter="url(#flameGlow)"/>
      <path class="flame-body-path" d="M32 6 C25 17 14 28 14 42 C14 52 22 58 32 58 C42 58 50 52 50 42 C50 28 39 17 32 6 Z" fill="url(#flameGrad)"/>
      <path class="flame-tuft-left" d="M26 18 C22 22 18 28 20 34 C21 31 23 29 26 27 C28 25 28 21 26 18 Z" fill="#ffd43b"/>
      <path class="flame-tuft-right" d="M38 16 C42 21 44 26 43 32 C41 29 39 27 37 25 C36 22 36 19 38 16 Z" fill="#ffd43b"/>
      <path d="M32 20 C27 28 20 35 20 44 C20 51 25 55 32 55 C39 55 44 51 44 44 C44 35 37 28 32 20 Z" fill="url(#innerFlame)"/>
      <ellipse cx="21" cy="43" rx="3" ry="1.8" fill="#f03e3e" opacity="0.5"/>
      <ellipse cx="43" cy="43" rx="3" ry="1.8" fill="#f03e3e" opacity="0.5"/>
      <g class="pet-eyes">
        <ellipse cx="25" cy="38" rx="3.2" ry="4.2" fill="#181124"/>
        <ellipse cx="39" cy="38" rx="3.2" ry="4.2" fill="#181124"/>
        <circle cx="24" cy="36.5" r="1.4" fill="#ffffff"/>
        <circle cx="38" cy="36.5" r="1.4" fill="#ffffff"/>
        <circle cx="26.2" cy="39.5" r="0.6" fill="#ffffff"/>
        <circle cx="40.2" cy="39.5" r="0.6" fill="#ffffff"/>
      </g>
      <path d="M30 43.5 Q32 45.5 34 43.5" stroke="#7a1818" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      <ellipse class="pet-hand-left" cx="15" cy="44" rx="2.6" ry="3.5" fill="#ff922b" transform="rotate(15 15 44)"/>
      <ellipse class="pet-hand-right" cx="49" cy="44" rx="2.6" ry="3.5" fill="#ff922b" transform="rotate(-15 49 44)"/>
    </svg>`
  },
  sparky: {
    name: 'Sparky',
    subtitle: 'Sparky · Cyber Anime Chibi Mascot',
    color: '#38bdf8',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="pet-svg pet-sparky">
      <defs>
        <linearGradient id="sparkGrad" x1="32" y1="10" x2="32" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="50%" stop-color="#818cf8"/>
          <stop offset="100%" stop-color="#6366f1"/>
        </linearGradient>
        <linearGradient id="boltGrad" x1="32" y1="4" x2="32" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#fde047"/>
          <stop offset="100%" stop-color="#eab308"/>
        </linearGradient>
        <filter id="sparkGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
      </defs>
      <path class="spark-antenna" d="M32 4 L35 12 L30 14 L35 22 L27 16 L31 13 Z" fill="url(#boltGrad)" filter="url(#sparkGlow)"/>
      <ellipse cx="32" cy="42" rx="22" ry="18" fill="url(#sparkGrad)" opacity="0.35" filter="url(#sparkGlow)"/>
      <path d="M14 42 C14 28 22 20 32 20 C42 20 50 28 50 42 C50 52 42 58 32 58 C22 58 14 52 14 42 Z" fill="url(#sparkGrad)"/>
      <circle cx="20" cy="44" r="2.8" fill="#f43f5e" opacity="0.5"/>
      <circle cx="44" cy="44" r="2.8" fill="#f43f5e" opacity="0.5"/>
      <g class="pet-eyes">
        <ellipse cx="24" cy="38" rx="3.2" ry="4" fill="#0f172a"/>
        <ellipse cx="40" cy="38" rx="3.2" ry="4" fill="#0f172a"/>
        <circle cx="23" cy="36.5" r="1.4" fill="#ffffff"/>
        <circle cx="39" cy="36.5" r="1.4" fill="#ffffff"/>
        <circle cx="25.5" cy="39.5" r="0.6" fill="#38bdf8"/>
        <circle cx="41.5" cy="39.5" r="0.6" fill="#38bdf8"/>
      </g>
      <path d="M29 44 Q32 47 35 44" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg>`
  },
  kitsune: {
    name: 'Kitsune',
    subtitle: 'Kitsune · Mystic Anime Spirit Fox',
    color: '#ef4444',
    svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="pet-svg pet-kitsune">
      <defs>
        <linearGradient id="furGrad" x1="32" y1="14" x2="32" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="80%" stop-color="#f1f5f9"/>
          <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <linearGradient id="earGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ef4444"/>
          <stop offset="100%" stop-color="#b91c1c"/>
        </linearGradient>
      </defs>
      <path class="kitsune-tail" d="M48 42 C56 40 60 30 54 22 C48 18 44 26 46 36 Z" fill="url(#furGrad)" stroke="#ef4444" stroke-width="1"/>
      <path d="M54 22 C52 24 50 25 48 24 C49 21 51 20 54 22 Z" fill="#ef4444"/>
      <path d="M16 30 L22 10 L30 24 Z" fill="url(#furGrad)"/>
      <path d="M20 25 L23 14 L27 22 Z" fill="url(#earGrad)"/>
      <path d="M48 30 L42 10 L34 24 Z" fill="url(#furGrad)"/>
      <path d="M44 25 L41 14 L37 22 Z" fill="url(#earGrad)"/>
      <path d="M18 36 C14 42 16 52 22 56 C26 58 38 58 42 56 C48 52 50 42 46 36 C42 28 22 28 18 36 Z" fill="url(#furGrad)"/>
      <path d="M32 28 C30 32 30 34 32 36 C34 34 34 32 32 28 Z" fill="#ef4444"/>
      <path d="M14 42 L22 43 M14 45 L22 45" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M50 42 L42 43 M50 45 L42 45" stroke="#cbd5e1" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="22" cy="44" r="2.6" fill="#f87171" opacity="0.5"/>
      <circle cx="42" cy="44" r="2.6" fill="#f87171" opacity="0.5"/>
      <path d="M24 38 Q27 35 30 38" stroke="#1e293b" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M34 38 Q37 35 40 38" stroke="#1e293b" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="42" r="1.2" fill="#1e293b"/>
      <path d="M30.5 44 Q32 45 33.5 44" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    </svg>`
  }
};

const PET_SPEECH_LINES = [
  "Need an anime recommendation? ✨",
  "Click me! I know what to binge next 🔥",
  "One Piece or Death Note? Ask me! ⚔️",
  "Looking for Hindi Dubbed anime? 🇮🇳",
  "Want a mind-bending thriller movie? 🧠",
  "Bored? Let's find your next favorite anime! 🍿"
];

let petSpeechTimer = null;
let petSpeechIndex = 0;

function playPetChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

window.handlePetClick = function(event) {
  if (event) event.stopPropagation();
  const companion = document.getElementById('ai-pet-companion');
  if (companion) {
    companion.classList.remove('hop');
    void companion.offsetWidth;
    companion.classList.add('hop');
    setTimeout(() => companion.classList.remove('hop'), 600);
  }
  playPetChime();
  toggleAiChat();
};

window.switchActivePet = function(petKey) {
  if (!PET_PRESETS[petKey]) petKey = 'fireball';
  localStorage.setItem('vault_ai_pet', petKey);
  renderActivePet();
  showToast(`Switched companion to ${PET_PRESETS[petKey].name}!`, 'info');
};

function renderActivePet() {
  const petKey = localStorage.getItem('vault_ai_pet') || 'fireball';
  const pet = PET_PRESETS[petKey] || PET_PRESETS.fireball;

  const sprite = document.getElementById('ai-pet-sprite');
  if (sprite) sprite.innerHTML = pet.svg;

  const companion = document.getElementById('ai-pet-companion');
  if (companion) companion.setAttribute('data-current-pet', petKey);

  const drawerAvatar = document.getElementById('ai-drawer-avatar');
  if (drawerAvatar) drawerAvatar.innerHTML = pet.svg;

  const subtitle = document.getElementById('ai-pet-subtitle');
  if (subtitle) subtitle.textContent = pet.subtitle;

  document.querySelectorAll('.ai-pet-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pet === petKey);
  });
}

function initPetCompanion() {
  renderActivePet();

  // Speech bubble cycle
  const speechText = document.getElementById('ai-pet-speech-text');
  if (speechText) {
    if (petSpeechTimer) clearInterval(petSpeechTimer);
    petSpeechTimer = setInterval(() => {
      petSpeechIndex = (petSpeechIndex + 1) % PET_SPEECH_LINES.length;
      speechText.style.opacity = '0';
      setTimeout(() => {
        speechText.textContent = PET_SPEECH_LINES[petSpeechIndex];
        speechText.style.opacity = '1';
      }, 250);
    }, 12000);
  }
}

// ============================================================
// VAULTAI: ADVANCED ANIME & MOVIE AI ASSISTANT CLIENT ENGINE
// ============================================================
const AI_DEFAULT_PROMPTS = [
  { label: '🧠 Mind-Bending Thriller', prompt: 'Suggest me a mind-bending psychological thriller anime with great plot twists.' },
  { label: '🇰🇷 Romantic K-Drama', prompt: 'Recommend the best romantic K-Dramas like Queen of Tears or Crash Landing on You.' },
  { label: '🇨🇳 Top C-Dramas', prompt: 'What are the most popular Chinese dramas available like Hidden Love or Falling Into Your Smile?' },
  { label: '🇮🇳 Hindi Dubbed Anime', prompt: 'What are the best action anime available in Hindi Dub on AnimeVault?' },
  { label: '🎬 Iconic Anime Movie', prompt: 'Recommend a breathtaking anime movie for tonight like Your Name or Spirited Away.' },
  { label: '🍿 Top Bollywood Hits', prompt: 'Recommend top rated Bollywood blockbuster movies to watch with family or friends.' },
  { label: '📺 Binge-Worthy Series', prompt: 'Suggest an intense, gripping crime or sci-fi web series to binge this weekend.' },
  { label: '🌸 Feel-Good Romance', prompt: 'Suggest a heartwarming romantic anime that will make me smile.' }
];

let aiChatMessages = [];

function loadAiChatHistory() {
  try {
    const saved = localStorage.getItem('anime_ai_chat_history');
    if (saved) {
      aiChatMessages = JSON.parse(saved);
    }
  } catch (e) {
    aiChatMessages = [];
  }
}

function saveAiChatHistory() {
  try {
    localStorage.setItem('anime_ai_chat_history', JSON.stringify(aiChatMessages.slice(-20)));
  } catch (e) {}
}

function formatAiMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Bullet points
  html = html.replace(/^[•\-\*]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Newlines to <br> or paragraphs
  html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return html;
}

function renderAiQuickChips(customFollowups = null) {
  const container = document.getElementById('ai-quick-chips');
  if (!container) return;

  if (customFollowups && customFollowups.length > 0) {
    container.innerHTML = customFollowups.map(f => `
      <button type="button" class="ai-chip" onclick="sendAiQuickPrompt('${f.replace(/'/g, "\\'")}')">
        <i class="fas fa-sparkle" style="font-size:0.65rem;"></i> ${f}
      </button>
    `).join('');
    return;
  }

  container.innerHTML = AI_DEFAULT_PROMPTS.map(p => `
    <button type="button" class="ai-chip" onclick="sendAiQuickPrompt('${p.prompt.replace(/'/g, "\\'")}')">
      ${p.label}
    </button>
  `).join('');
}

function renderAiChatBody() {
  const body = document.getElementById('ai-chat-body');
  if (!body) return;

  if (aiChatMessages.length === 0) {
    const greeting = currentUser 
      ? `Hey **${currentUser.username}**! 👋 I'm **VaultAI**, your personal Otaku & Movie genius 🤖✨\nI know your taste, current watchlist, and can recommend the perfect anime, blockbuster movies, or web series for you!\nWhat are you in the mood for today?`
      : `Hey there! 👋 I'm **VaultAI**, your personal Otaku & Movie genius 🤖✨\nTell me what you're in the mood for, your favorite shows, or pick a mood chip below to start!`;
    
    aiChatMessages.push({
      role: 'bot',
      text: greeting,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }

  body.innerHTML = aiChatMessages.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="ai-msg user">
          <div class="ai-msg-bubble">${formatAiMarkdown(msg.text)}</div>
          <span class="ai-msg-time">${msg.time || ''}</span>
        </div>
      `;
    }

    const recsHtml = (msg.recommendations && msg.recommendations.length > 0) ? `
      <div class="ai-rec-carousel">
        ${msg.recommendations.map(item => `
          <div class="ai-rec-card" onclick="closeAiChat(); navigateTo('${item.watch_url}');">
            <div class="ai-rec-thumb-wrap">
              <img src="${item.cover_image}" alt="${item.title}" class="ai-rec-thumb" loading="lazy" onerror="this.src='/images/placeholder.svg'">
              <span class="ai-rec-badge">${displayAnimeType(item)}</span>
              ${item.has_hindi_dub ? `<span class="ai-rec-hindi-badge"><i class="fas fa-flag"></i> HINDI</span>` : ''}
              <span class="ai-rec-rating"><i class="fas fa-star"></i> ${item.rating?.toFixed(1) || '8.5'}</span>
            </div>
            <div class="ai-rec-info">
              <div class="ai-rec-title" title="${item.title}">${item.title}</div>
              <div class="ai-rec-meta">${item.release_year || '2024'} · ${item.episodes_count ? `${item.episodes_count} eps` : (item.duration || 'Movie')}</div>
              <button class="ai-rec-watch-btn" onclick="event.stopPropagation(); closeAiChat(); navigateTo('${item.watch_url}');">
                <i class="fas fa-play"></i> Watch Now
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="ai-msg bot">
        <div class="ai-msg-bubble">
          ${formatAiMarkdown(msg.text)}
          ${recsHtml}
        </div>
        <span class="ai-msg-time">${msg.time || ''}</span>
      </div>
    `;
  }).join('');

  body.scrollTop = body.scrollHeight;
}

window.openAiChat = function(initialPrompt = null) {
  loadAiChatHistory();
  const overlay = document.getElementById('ai-drawer-overlay');
  const drawer = document.getElementById('ai-drawer');
  if (overlay) overlay.classList.add('active');
  if (drawer) drawer.classList.add('active');

  renderAiChatBody();
  renderAiQuickChips();

  const input = document.getElementById('ai-input');
  if (input) {
    input.focus();
    if (initialPrompt) {
      input.value = initialPrompt;
      sendAiMessage(initialPrompt);
      input.value = '';
    }
  }
};

window.closeAiChat = function() {
  const overlay = document.getElementById('ai-drawer-overlay');
  const drawer = document.getElementById('ai-drawer');
  if (overlay) overlay.classList.remove('active');
  if (drawer) drawer.classList.remove('active');
};

window.toggleAiChat = function() {
  const drawer = document.getElementById('ai-drawer');
  if (drawer && drawer.classList.contains('active')) {
    closeAiChat();
  } else {
    openAiChat();
  }
};

window.resetAiChat = function() {
  aiChatMessages = [];
  localStorage.removeItem('anime_ai_chat_history');
  renderAiChatBody();
  renderAiQuickChips();
  showToast('Chat history cleared', 'info');
};

window.sendAiQuickPrompt = function(promptText) {
  sendAiMessage(promptText);
};

window.handleAiSubmit = function(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('ai-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendAiMessage(text);
};

async function sendAiMessage(userText) {
  const body = document.getElementById('ai-chat-body');
  if (!body) return;

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Add user message
  aiChatMessages.push({
    role: 'user',
    text: userText,
    time: nowTime
  });
  saveAiChatHistory();
  renderAiChatBody();

  // Show typing indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'ai-typing-indicator';
  typingEl.id = 'ai-active-typing';
  typingEl.innerHTML = `
    <span class="ai-typing-dot"></span>
    <span class="ai-typing-dot"></span>
    <span class="ai-typing-dot"></span>
    <span style="font-size:0.75rem;color:var(--text-muted);margin-left:6px;font-weight:600;">VaultAI is thinking...</span>
  `;
  body.appendChild(typingEl);
  body.scrollTop = body.scrollHeight;

  try {
    const res = await api('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: userText })
    });

    const typing = document.getElementById('ai-active-typing');
    if (typing) typing.remove();

    const botReply = res.data?.reply || 'Here are some recommendations for you:';
    const recs = res.data?.recommendations || [];
    const followups = res.data?.followups || [];

    aiChatMessages.push({
      role: 'bot',
      text: botReply,
      recommendations: recs,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    saveAiChatHistory();

    renderAiChatBody();
    if (followups.length > 0) {
      renderAiQuickChips(followups);
    }
  } catch (err) {
    const typing = document.getElementById('ai-active-typing');
    if (typing) typing.remove();

    aiChatMessages.push({
      role: 'bot',
      text: `Oops! I had a hiccup analyzing that. Please try asking again! (${err.message})`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    saveAiChatHistory();
    renderAiChatBody();
  }
}

// ===== ADMIN CONTROL CENTER (CONFIDENTIAL & EXCLUSIVE TO OWNER) =====
let adminUsersCache = [];
let adminLoginsCache = [];
let adminWatchesCache = [];
let adminDiscoveryCache = null;
let adminStatsCache = null;
let adminTargetUser = null;
let adminActiveTab = 'users'; // 'users' | 'logins' | 'watches' | 'discovery'
let adminUserFilter = 'all'; // 'all' | 'online' | 'today' | 'active' | 'admins'
let adminAutoRefreshTimer = null;
let adminAutoRefreshEnabled = true;
let adminDetailModalUser = null;
let adminDetailActiveSubtab = 'history'; // 'history' | 'watchlist' | 'favorites' | 'logins'

function parseSqliteDate(dt) {
  if (!dt) return null;
  if (dt instanceof Date) return dt;
  if (typeof dt === 'number') return new Date(dt);
  let s = String(dt).trim().replace(' ', 'T');
  const hasTz = /Z|[+-]\d{2}(?::?\d{2})?$/i.test(s);
  if (!hasTz) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatAdminRelativeTime(dt) {
  const d = parseSqliteDate(dt);
  if (!d) return 'Never';
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatAdminFullDate(dt) {
  const d = parseSqliteDate(dt);
  if (!d) return 'Unknown';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getAdminUserStatus(u) {
  const lastActiveDate = parseSqliteDate(u.last_active);
  const lastLoginDate = parseSqliteDate(u.last_login);
  const refDate = lastActiveDate || lastLoginDate;

  if (!refDate) {
    return {
      isOnline: false,
      isToday: false,
      badgeHtml: `<span class="admin-status-pill offline"><i class="fas fa-circle-notch"></i> Inactive</span>`,
      timeLabel: 'Never'
    };
  }

  const diffMs = Date.now() - refDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 15) {
    return {
      isOnline: true,
      isToday: true,
      badgeHtml: `<span class="admin-status-pill online"><span class="status-pulse-dot"></span> Online Now</span>`,
      timeLabel: 'Active right now'
    };
  }

  const now = new Date();
  const isSameDay = refDate.getDate() === now.getDate() && 
                    refDate.getMonth() === now.getMonth() && 
                    refDate.getFullYear() === now.getFullYear();

  const timeStr = refDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isSameDay) {
    return {
      isOnline: false,
      isToday: true,
      badgeHtml: `<span class="admin-status-pill today"><i class="fas fa-clock"></i> Today, ${timeStr}</span>`,
      timeLabel: `Active today at ${timeStr}`
    };
  }

  const diffDays = Math.floor(diffMins / (60 * 24));
  if (diffDays === 1) {
    return {
      isOnline: false,
      isToday: false,
      badgeHtml: `<span class="admin-status-pill offline"><i class="fas fa-clock-rotate-left"></i> Yesterday, ${timeStr}</span>`,
      timeLabel: `Yesterday at ${timeStr}`
    };
  }

  return {
    isOnline: false,
    isToday: false,
    badgeHtml: `<span class="admin-status-pill offline"><i class="fas fa-history"></i> ${diffDays}d ago</span>`,
    timeLabel: formatAdminFullDate(refDate)
  };
}

async function renderAdminPage() {
  const app = document.getElementById('app');
  if (!app) return;

  const adminEmails = ['honeyabhaiyaji7@gmail.com', 'honeyabhiayji7@gmail.com'];
  const isAdmin = currentUser && (Boolean(currentUser.is_admin) || (currentUser.email && adminEmails.includes(currentUser.email.toLowerCase())));

  if (!isAdmin) {
    app.innerHTML = `
      <div class="page-container" style="padding: 60px 20px;">
        <div class="empty-state" style="max-width: 580px; margin: 40px auto; padding: 48px 32px; background: var(--bg-secondary); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 16px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.4);">
          <div style="width: 80px; height: 80px; background: rgba(239, 68, 68, 0.15); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; color: #ef4444; font-size: 2.2rem;">
            <i class="fas fa-lock"></i>
          </div>
          <h2 style="font-size: 1.6rem; font-weight: 800; color: #fff; margin-bottom: 12px;">Admin Access Restricted</h2>
          <p style="color: var(--text-secondary); line-height: 1.6; font-size: 0.95rem; margin-bottom: 24px;">
            This control center contains confidential user records and is strictly restricted to the verified site owner (<strong style="color:#c084fc;">honeyabhiayji7@gmail.com</strong>).
          </p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-primary" onclick="openAuthModal('login')">
              <i class="fas fa-sign-in-alt"></i> Login as Admin
            </button>
            <button class="btn btn-outline" onclick="navigateTo('/')">
              <i class="fas fa-arrow-left"></i> Back to Home
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Show loading skeleton while fetching initial admin data
  app.innerHTML = `
    <div class="page-container" style="padding: 40px 20px; text-align: center;">
      <div style="padding: 80px 0;">
        <i class="fas fa-spinner fa-spin" style="font-size: 2.5rem; color: var(--accent); margin-bottom: 16px;"></i>
        <h3 style="color:#fff;">Loading Confidential User Database...</h3>
      </div>
    </div>
  `;

  await fetchAdminData(false);
  startAdminAutoRefresh();
}

async function fetchAdminData(isManual = false) {
  try {
    const [statsRes, usersRes, loginsRes, watchesRes, discoveryRes] = await Promise.all([
      api('/admin/stats'),
      api('/admin/users'),
      api('/admin/logins').catch(() => ({ data: [] })),
      api('/admin/recent-watches').catch(() => ({ data: [] })),
      api('/admin/discovery').catch(() => ({ data: { enabled: true, totalDiscovered: 0, recentLogs: [] } }))
    ]);

    adminStatsCache = statsRes.data;
    adminUsersCache = usersRes.data || [];
    adminLoginsCache = loginsRes.data || [];
    adminWatchesCache = watchesRes.data || [];
    adminDiscoveryCache = discoveryRes.data || { enabled: true, totalDiscovered: 0, recentLogs: [] };

    if (isManual) {
      showToast('Admin data refreshed with live database!', 'success');
    }

    renderAdminDashboardContent();
  } catch (err) {
    const app = document.getElementById('app');
    if (app && !adminUsersCache.length) {
      app.innerHTML = `
        <div class="page-container" style="padding: 60px 20px;">
          <div class="empty-state" style="max-width: 500px; margin: 40px auto; padding: 40px; background: var(--bg-secondary); border-radius: 16px; text-align: center;">
            <i class="fas fa-triangle-exclamation" style="font-size: 2.5rem; color: #ef4444; margin-bottom: 16px;"></i>
            <h2 style="color:#fff;">Failed to Load Admin Panel</h2>
            <p style="color:var(--text-muted);">${escapeHtml(err.message)}</p>
            <button class="btn btn-primary" onclick="renderAdminPage()"><i class="fas fa-rotate"></i> Try Again</button>
          </div>
        </div>
      `;
    }
  }
}

function renderAdminDashboardContent() {
  const app = document.getElementById('app');
  if (!app) return;

  const stats = adminStatsCache || {};
  const currentSearch = document.getElementById('admin-table-search')?.value || '';

  // Filter counts
  const onlineCount = adminUsersCache.filter(u => u.is_online).length;
  const todayCount = adminUsersCache.filter(u => u.is_active_today).length;
  const activeCount = adminUsersCache.filter(u => (u.watched_count || 0) > 0).length;
  const adminCount = adminUsersCache.filter(u => Boolean(u.is_admin)).length;

  // Preserve scroll position if re-rendering during auto-refresh
  const scrollY = window.scrollY;

  app.innerHTML = `
    <div class="page-container admin-dashboard" style="padding: 32px 20px 80px; max-width: 1440px; margin: 0 auto;">
      
      <!-- Top Header -->
      <div class="admin-header" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 30px; padding-bottom: 24px; border-bottom: 1px solid var(--border);">
        <div>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
            <h1 style="font-size: 1.85rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 12px;">
              <span style="background: linear-gradient(135deg, #10b981, #059669); padding: 8px 12px; border-radius: 12px; display: inline-flex; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);"><i class="fas fa-shield-halved"></i></span>
              Admin Control Center
            </h1>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem;">
              <i class="fas fa-crown" style="color:#eab308; margin-right: 4px;"></i> Super Admin
            </span>
          </div>
          <p style="color: var(--text-secondary); margin: 0; font-size: 0.92rem;">
            Real-time user database, active sessions, and live login tracking · Owner: <strong style="color:#34d399;">${escapeHtml(currentUser.email)}</strong>
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button class="admin-live-pulse-badge" id="admin-auto-refresh-btn" onclick="toggleAdminAutoRefresh()" title="Toggle 15-second automatic live update">
            <span class="status-pulse-dot" style="${adminAutoRefreshEnabled ? '' : 'background:#64748b; animation:none;'}"></span>
            <span>Live Sync: ${adminAutoRefreshEnabled ? 'ON (15s)' : 'PAUSED'}</span>
          </button>
          <button class="btn btn-outline btn-sm" onclick="fetchAdminData(true)" title="Force instant database refresh">
            <i class="fas fa-rotate"></i> Refresh
          </button>
          <button class="btn btn-outline btn-sm" onclick="exportAdminUsers('csv')" title="Download users as CSV">
            <i class="fas fa-file-csv"></i> Export CSV
          </button>
          <button class="btn btn-outline btn-sm" onclick="exportAdminUsers('json')" title="Download users as JSON">
            <i class="fas fa-file-code"></i> JSON
          </button>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('/')">
            <i class="fas fa-globe"></i> View Site
          </button>
        </div>
      </div>

      <!-- 5 Metric Stat Cards -->
      <div class="admin-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; margin-bottom: 32px;">
        
        <!-- Total Registered Users -->
        <div class="admin-stat-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 14px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
          <div style="width: 50px; height: 50px; border-radius: 12px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-users"></i>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Total Users</div>
            <div style="font-size: 1.7rem; font-weight: 800; color: #fff; margin-top: 2px;">${stats.totalUsers || adminUsersCache.length}</div>
          </div>
        </div>

        <!-- Online Now -->
        <div class="admin-stat-card" style="background: var(--bg-secondary); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 14px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 20px rgba(16, 185, 129, 0.1);">
          <div style="width: 50px; height: 50px; border-radius: 12px; background: rgba(16, 185, 129, 0.2); color: #34d399; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0; position: relative;">
            <i class="fas fa-signal"></i>
            <span class="status-pulse-dot" style="position: absolute; top: 8px; right: 8px;"></span>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: #34d399; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Online Now</div>
            <div style="font-size: 1.7rem; font-weight: 800; color: #fff; margin-top: 2px;">${stats.onlineNow || onlineCount || 1}</div>
          </div>
        </div>

        <!-- Active Today -->
        <div class="admin-stat-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 14px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
          <div style="width: 50px; height: 50px; border-radius: 12px; background: rgba(245, 158, 11, 0.15); color: #fbbf24; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-calendar-check"></i>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Active Today</div>
            <div style="font-size: 1.7rem; font-weight: 800; color: #fff; margin-top: 2px;">${stats.activeToday || todayCount || 1}</div>
          </div>
        </div>

        <!-- Total Recorded Logins -->
        <div class="admin-stat-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 14px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
          <div style="width: 50px; height: 50px; border-radius: 12px; background: rgba(236, 72, 153, 0.15); color: #f472b6; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-key"></i>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Login Sessions</div>
            <div style="font-size: 1.7rem; font-weight: 800; color: #fff; margin-top: 2px;">${stats.totalLogins || adminLoginsCache.length}</div>
          </div>
        </div>

        <!-- Catalog & Video Plays -->
        <div class="admin-stat-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 14px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
          <div style="width: 50px; height: 50px; border-radius: 12px; background: rgba(168, 85, 247, 0.15); color: #c084fc; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; flex-shrink: 0;">
            <i class="fas fa-play-circle"></i>
          </div>
          <div>
            <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Video Plays</div>
            <div style="font-size: 1.7rem; font-weight: 800; color: #fff; margin-top: 2px;">${Number(stats.totalWatches || 0).toLocaleString()}</div>
          </div>
        </div>

      </div>

      <!-- Navigation Tabs & Search Bar -->
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px;">
        <div class="admin-tabs" style="margin-bottom: 0;">
          <button class="admin-tab-btn ${adminActiveTab === 'users' ? 'active' : ''}" id="tab-btn-users" onclick="switchAdminTab('users')">
            <i class="fas fa-users-gear"></i> Users Directory (<span id="admin-users-tab-count">${adminUsersCache.length}</span>)
          </button>
          <button class="admin-tab-btn ${adminActiveTab === 'logins' ? 'active' : ''}" id="tab-btn-logins" onclick="switchAdminTab('logins')">
            <i class="fas fa-satellite-dish"></i> Login Audit (<span id="admin-logins-tab-count">${adminLoginsCache.length}</span>)
          </button>
          <button class="admin-tab-btn ${adminActiveTab === 'watches' ? 'active' : ''}" id="tab-btn-watches" onclick="switchAdminTab('watches')">
            <i class="fas fa-play-circle"></i> Live Watch Stream (<span id="admin-watches-tab-count">${adminWatchesCache.length}</span>)
          </button>
          <button class="admin-tab-btn ${adminActiveTab === 'discovery' ? 'active' : ''}" id="tab-btn-discovery" onclick="switchAdminTab('discovery')">
            <i class="fas fa-radar"></i> Auto-Catalog Discovery (<span id="admin-discovery-tab-count">${adminDiscoveryCache?.totalDiscovered || 0}</span>)
          </button>
        </div>

        <div style="position: relative; min-width: 280px; flex: 1; max-width: 400px;">
          <i class="fas fa-search" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted);"></i>
          <input type="text" id="admin-table-search" placeholder="Search user, email, IP, or device..." value="${escapeHtml(currentSearch)}" oninput="filterAdminCurrentTab(this.value)" style="width: 100%; padding: 10px 14px 10px 38px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; color: #fff; font-size: 0.85rem; outline: none; transition: border-color 0.2s;" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        </div>
      </div>

      <!-- Quick Filter Chips (for Users Tab) -->
      <div class="admin-filter-chips" id="admin-filter-chips" style="${adminActiveTab === 'users' ? 'display:flex;' : 'display:none;'}">
        <button class="admin-filter-chip ${adminUserFilter === 'all' ? 'active' : ''}" onclick="setAdminUserFilter('all')">
          <i class="fas fa-list"></i> All Users (${adminUsersCache.length})
        </button>
        <button class="admin-filter-chip ${adminUserFilter === 'online' ? 'active' : ''}" onclick="setAdminUserFilter('online')">
          <span class="status-pulse-dot" style="width:7px; height:7px;"></span> Online Now (${onlineCount})
        </button>
        <button class="admin-filter-chip ${adminUserFilter === 'today' ? 'active' : ''}" onclick="setAdminUserFilter('today')">
          <i class="fas fa-calendar-day" style="color:#fbbf24;"></i> Active Today (${todayCount})
        </button>
        <button class="admin-filter-chip ${adminUserFilter === 'active' ? 'active' : ''}" onclick="setAdminUserFilter('active')">
          <i class="fas fa-eye" style="color:#60a5fa;"></i> Active Watchers (${activeCount})
        </button>
        <button class="admin-filter-chip ${adminUserFilter === 'admins' ? 'active' : ''}" onclick="setAdminUserFilter('admins')">
          <i class="fas fa-crown" style="color:#eab308;"></i> Admins (${adminCount})
        </button>
      </div>

      <!-- TAB 1: USERS DIRECTORY TABLE -->
      <div id="admin-view-users" style="${adminActiveTab === 'users' ? 'display:block;' : 'display:none;'}">
        <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
              <thead>
                <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.6px;">
                  <th style="padding: 14px 20px;">User</th>
                  <th style="padding: 14px 20px;">Email & IP</th>
                  <th style="padding: 14px 20px;">Status</th>
                  <th style="padding: 14px 20px;">Device & Logins</th>
                  <th style="padding: 14px 20px;">Activity Metrics</th>
                  <th style="padding: 14px 20px;">Joined</th>
                  <th style="padding: 14px 20px; text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody id="admin-users-tbody">
                ${renderAdminUsersRows(adminUsersCache, currentSearch, adminUserFilter)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- TAB 2: LIVE LOGIN AUDIT STREAM -->
      <div id="admin-view-logins" style="${adminActiveTab === 'logins' ? 'display:block;' : 'display:none;'}">
        <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h3 style="margin:0; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-clock-rotate-left" style="color:#10b981;"></i> Recent Login Sessions Stream
              </h3>
              <p style="margin:2px 0 0; font-size: 0.82rem; color: var(--text-muted);">
                Audit log of all login events, attempts, device fingerprints, and client IP addresses
              </p>
            </div>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.75rem;">
              Latest 100 Events
            </span>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
              <thead>
                <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.6px;">
                  <th style="padding: 14px 20px;">User & Email</th>
                  <th style="padding: 14px 20px;">Login Time</th>
                  <th style="padding: 14px 20px;">IP Address</th>
                  <th style="padding: 14px 20px;">Device & OS</th>
                  <th style="padding: 14px 20px;">Browser</th>
                  <th style="padding: 14px 20px; text-align: right;">Status</th>
                </tr>
              </thead>
              <tbody id="admin-logins-tbody">
                ${renderAdminLoginsRows(adminLoginsCache, currentSearch)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- TAB 3: LIVE WATCH FEED -->
      <div id="admin-view-watches" style="${adminActiveTab === 'watches' ? 'display:block;' : 'display:none;'}">
        <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h3 style="margin:0; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-play" style="color:#60a5fa;"></i> Live Global Watch Feed
              </h3>
              <p style="margin:2px 0 0; font-size: 0.82rem; color: var(--text-muted);">
                Real-time stream of episodes being watched across all users on AnimeVault
              </p>
            </div>
            <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); font-size: 0.75rem;">
              Latest 50 Plays
            </span>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
              <thead>
                <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.6px;">
                  <th style="padding: 14px 20px;">User</th>
                  <th style="padding: 14px 20px;">Anime & Episode</th>
                  <th style="padding: 14px 20px;">Watched Time</th>
                  <th style="padding: 14px 20px;">Progress</th>
                  <th style="padding: 14px 20px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="admin-watches-tbody">
                ${renderAdminWatchesRows(adminWatchesCache, currentSearch)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- TAB 4: AUTO-CATALOG DISCOVERY HUB -->
      <div id="admin-view-discovery" style="${adminActiveTab === 'discovery' ? 'display:block;' : 'display:none;'}">
        
        <!-- Engine Status Hero Banner -->
        <div class="admin-table-card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(6, 78, 59, 0.2)); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 22px 26px; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 16px;">
            <div style="width: 52px; height: 52px; border-radius: 14px; background: rgba(16, 185, 129, 0.2); color: #34d399; display: flex; align-items: center; justify-content: center; font-size: 1.6rem; box-shadow: 0 0 20px rgba(16, 185, 129, 0.35);">
              <i class="fas fa-satellite-dish"></i>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <h3 style="margin: 0; color: #fff; font-size: 1.25rem; font-weight: 800;">
                  Auto-Catalog Discovery Engine
                </h3>
                <span class="badge" id="admin-discovery-status-badge" style="background: ${adminDiscoveryCache?.enabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${adminDiscoveryCache?.enabled ? '#34d399' : '#f87171'}; border: 1px solid ${adminDiscoveryCache?.enabled ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}; font-weight: 700; font-size: 0.76rem;">
                  <span class="status-pulse-dot" style="${adminDiscoveryCache?.enabled ? '' : 'background:#f87171; animation:none;'}"></span>
                  ${adminDiscoveryCache?.enabled ? 'ACTIVE & OPERATIONAL' : 'PAUSED'}
                </span>
              </div>
              <p style="margin: 4px 0 0; color: var(--text-secondary); font-size: 0.86rem;">
                Dual-source auto-import: <strong style="color:#c084fc;">AniList GraphQL (Anime)</strong> · <strong style="color:#60a5fa;">TMDB Multi-Media API (Movies & Live Series)</strong> · Multi-CDN Video Embeds
              </p>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <button class="btn btn-sm ${adminDiscoveryCache?.enabled ? 'btn-outline' : 'btn-primary'}" onclick="toggleAdminDiscoveryEngine()" id="admin-toggle-discovery-btn">
              <i class="fas fa-power-off"></i> ${adminDiscoveryCache?.enabled ? 'Pause Auto-Discovery' : 'Activate Auto-Discovery'}
            </button>
            <button class="btn btn-primary btn-sm" onclick="triggerAdminBulkDiscovery()" id="admin-bulk-discovery-btn">
              <i class="fas fa-cloud-arrow-down"></i> Sync Weekly Trending
            </button>
          </div>
        </div>

        <!-- 2 Grid Cards: Instant Manual Discovery Scanner & Discovery Engine Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-bottom: 24px;">
          
          <!-- Card 1: Instant Title Scanner -->
          <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 6px 10px; border-radius: 8px; font-size: 0.95rem;"><i class="fas fa-bolt"></i></span>
              <h4 style="margin: 0; color: #fff; font-size: 1.05rem; font-weight: 700;">Instant Title Scanner & Importer</h4>
            </div>
            <p style="color: var(--text-muted); font-size: 0.83rem; margin-top: 0; margin-bottom: 16px;">
              Enter any movie, anime, or web series name. The engine will instantly fetch metadata, 4K artwork, duration, and stream sources.
            </p>
            <div style="display: flex; gap: 10px; margin-bottom: 12px;">
              <input type="text" id="admin-discovery-input" placeholder="e.g. Dune: Part Two, Reze Arc, Panchayat, The Vvaan..." style="flex: 1; padding: 11px 14px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 10px; color: #fff; font-size: 0.88rem; outline: none;" onkeydown="if(event.key === 'Enter') triggerAdminDiscovery();">
              <button class="btn btn-primary" onclick="triggerAdminDiscovery()" id="admin-discover-run-btn" style="white-space: nowrap;">
                <i class="fas fa-magnifying-glass-plus"></i> Import
              </button>
            </div>
            <div id="admin-discovery-result" style="display: none; margin-top: 14px;"></div>
          </div>

          <!-- Card 2: Discovery Overview & Stats -->
          <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 6px 10px; border-radius: 8px; font-size: 0.95rem;"><i class="fas fa-chart-line"></i></span>
              <h4 style="margin: 0; color: #fff; font-size: 1.05rem; font-weight: 700;">Auto-Catalog Growth Metrics</h4>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px;">
              <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 10px; padding: 14px;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Auto-Imported Titles</div>
                <div style="font-size: 1.6rem; font-weight: 800; color: #34d399; margin-top: 4px;" id="admin-discovery-count-val">
                  ${adminDiscoveryCache?.totalDiscovered || 0}
                </div>
              </div>
              <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 10px; padding: 14px;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Discovery Events</div>
                <div style="font-size: 1.6rem; font-weight: 800; color: #60a5fa; margin-top: 4px;">
                  ${adminDiscoveryCache?.totalLogs || 0}
                </div>
              </div>
            </div>
            <p style="color: var(--text-muted); font-size: 0.78rem; margin: 14px 0 0; line-height: 1.5;">
              <i class="fas fa-circle-check" style="color:#10b981; margin-right: 4px;"></i>
              Whenever any user searches for an unseeded title, the engine runs silently in sub-second time and auto-creates the movie/anime without interrupting user browsing.
            </p>
          </div>

        </div>

        <!-- Recent Discovery Audit Table -->
        <div class="admin-table-card" style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
          <div style="padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
            <div>
              <h3 style="margin:0; font-size: 1.1rem; color: #fff; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-clock-rotate-left" style="color:#34d399;"></i> Real-Time Discovery Audit Logs
              </h3>
              <p style="margin:2px 0 0; font-size: 0.82rem; color: var(--text-muted);">
                Chronological record of titles discovered from TMDB and AniList via user searches and background sync
              </p>
            </div>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-size: 0.75rem;">
              Live Synced
            </span>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
              <thead>
                <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.6px;">
                  <th style="padding: 14px 20px;">Title & Artwork</th>
                  <th style="padding: 14px 20px;">Type & Category</th>
                  <th style="padding: 14px 20px;">Source Engine</th>
                  <th style="padding: 14px 20px;">Trigger</th>
                  <th style="padding: 14px 20px;">Discovered At</th>
                  <th style="padding: 14px 20px; text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody id="admin-discovery-tbody">
                ${renderAdminDiscoveryRows(adminDiscoveryCache?.recentLogs || [], currentSearch)}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <!-- Password Reset Modal -->
      <div class="modal-overlay" id="admin-pwd-modal" style="display:none; align-items:center; justify-content:center; z-index: 9999;">
        <div style="background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 28px; width: 90%; max-width: 440px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); position: relative;">
          <button onclick="closeAdminPasswordModal()" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: var(--text-muted); font-size: 1.1rem; cursor: pointer;">
            <i class="fas fa-times"></i>
          </button>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 42px; height: 42px; border-radius: 10px; background: rgba(16, 185, 129, 0.2); color: #34d399; display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
              <i class="fas fa-key"></i>
            </div>
            <div>
              <h3 style="color:#fff; margin:0; font-size: 1.15rem;">Set User Password</h3>
              <p id="admin-modal-username" style="color:var(--text-muted); margin:0; font-size: 0.85rem;"></p>
            </div>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px; line-height: 1.5;">
            Enter a new password for this user. It will be securely hashed with bcrypt and updated in the database immediately.
          </p>
          <div class="form-group" style="margin-bottom: 20px;">
            <label><i class="fas fa-lock"></i></label>
            <input type="text" id="admin-new-password-input" placeholder="Enter new password (min 6 chars)" style="flex:1; background:none; border:none; outline:none; color:#fff; padding:12px 10px;">
          </div>
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button class="btn btn-outline btn-sm" onclick="closeAdminPasswordModal()">Cancel</button>
            <button class="btn btn-primary btn-sm" onclick="submitAdminPasswordReset()">
              <i class="fas fa-check"></i> Update Password
            </button>
          </div>
        </div>
      </div>

      <!-- User Dossier Full Profile Modal -->
      <div class="modal-overlay" id="admin-user-dossier-modal" style="display:none; align-items:center; justify-content:center; z-index: 9999;" onclick="if(event.target===this) closeAdminUserDetailModal()">
        <div class="admin-dossier-card" id="admin-dossier-card">
          <!-- Rendered dynamically by renderAdminUserDetailModal() -->
          <div style="padding: 60px; text-align: center;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--accent);"></i>
            <p style="color: var(--text-muted); margin-top: 12px;">Loading user profile dossier...</p>
          </div>
        </div>
      </div>

    </div>
  `;

  if (scrollY > 0) {
    window.scrollTo(0, scrollY);
  }
}

function renderAdminUsersRows(users, query = '', filter = 'all') {
  const q = (query || '').toLowerCase().trim();
  
  let list = users;
  if (filter === 'online') {
    list = list.filter(u => u.is_online);
  } else if (filter === 'today') {
    list = list.filter(u => u.is_active_today);
  } else if (filter === 'active') {
    list = list.filter(u => (u.watched_count || 0) > 0);
  } else if (filter === 'admins') {
    list = list.filter(u => Boolean(u.is_admin));
  }

  if (q) {
    list = list.filter(u => 
      u.username.toLowerCase().includes(q) || 
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.last_ip && u.last_ip.toLowerCase().includes(q)) ||
      (u.device_type && u.device_type.toLowerCase().includes(q))
    );
  }

  if (!list || list.length === 0) {
    return `<tr><td colspan="7" style="padding: 36px; text-align: center; color: var(--text-muted);"><i class="fas fa-user-slash" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>No registered users match your filter/search query</td></tr>`;
  }

  return list.map(u => {
    const isOwner = Boolean(u.is_admin);
    const status = getAdminUserStatus(u);
    const joinedStr = u.created_at ? formatAdminFullDate(u.created_at) : 'Unknown';
    const lastIpStr = u.last_ip || 'No IP logged';

    // Device icon
    let devIcon = 'fa-laptop';
    if (u.device_type === 'Mobile') devIcon = 'fa-mobile-screen';
    else if (u.device_type === 'Tablet') devIcon = 'fa-tablet-screen-button';
    else if (u.device_type === 'Bot/Tool') devIcon = 'fa-robot';

    return `
      <tr class="admin-user-row" onclick="openAdminUserDetailModal(${u.id})" style="border-bottom: 1px solid var(--border);" title="Click to view full user dossier">
        <!-- User identity -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="position: relative;">
              <img src="${u.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.username}`}" alt="${escapeHtml(u.username)}" style="width: 40px; height: 40px; border-radius: 50%; background: var(--bg-tertiary); border: 1px solid var(--border); flex-shrink: 0; display: block;">
              ${status.isOnline ? `<span class="status-pulse-dot" style="position: absolute; bottom: 0; right: 0; border: 2px solid var(--bg-secondary);"></span>` : ''}
            </div>
            <div>
              <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
                ${escapeHtml(u.username)}
                ${isOwner ? '<span title="Site Owner / Super Admin" style="color:#eab308; font-size: 0.8rem;"><i class="fas fa-crown"></i></span>' : ''}
              </div>
              <div style="font-size: 0.74rem; color: var(--text-muted); display:flex; align-items:center; gap:6px;">
                <span>ID: #${u.id}</span>
                ${isOwner ? '<span style="color:#34d399; font-weight:700;">Super Admin</span>' : '<span style="color:var(--text-secondary);">Member</span>'}
              </div>
            </div>
          </div>
        </td>

        <!-- Email & IP -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 0.84rem;">${escapeHtml(u.email)}</span>
              <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(u.email)}'); showToast('Email copied to clipboard!', 'info');" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 0.72rem;" title="Copy email">
                <i class="fas fa-copy"></i>
              </button>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="admin-ip-pill" title="Last recorded IP address">
                <i class="fas fa-network-wired" style="color:#60a5fa;"></i> ${escapeHtml(lastIpStr)}
              </span>
              ${u.last_ip ? `
                <button onclick="event.stopPropagation(); navigator.clipboard.writeText('${escapeHtml(u.last_ip)}'); showToast('IP copied to clipboard!', 'info');" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px; font-size: 0.7rem;" title="Copy IP">
                  <i class="fas fa-copy"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </td>

        <!-- Live Status & Last Active -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${status.badgeHtml}
            <span style="font-size: 0.72rem; color: var(--text-muted);" title="${escapeHtml(status.timeLabel)}">
              ${u.last_login ? `Login: ${formatAdminRelativeTime(u.last_login)}` : 'Joined: ' + formatAdminRelativeTime(u.created_at)}
            </span>
          </div>
        </td>

        <!-- Device & Login Count -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-start;">
            <span class="admin-device-pill">
              <i class="fas ${devIcon}"></i> ${escapeHtml(u.device_type || 'Desktop')}
            </span>
            <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.73rem; padding: 2px 8px; border-radius: 12px; background: rgba(234, 179, 8, 0.12); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.3); font-weight: 700;">
              <i class="fas fa-fire-flame-curved"></i> ${u.login_count || 1} logins
            </span>
          </div>
        </td>

        <!-- Activity Metrics -->
        <td style="padding: 14px 20px;">
          <div style="font-size: 0.85rem; color: var(--text-primary); font-weight: 600;">
            <i class="fas fa-eye" style="color: #60a5fa; margin-right: 4px;"></i> ${u.watched_count || 0} eps watched
          </div>
          <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 3px;">
            ${u.watchlist_count || 0} saved · ${u.comments_count || 0} cmts
          </div>
          ${u.last_watched_anime ? `
            <div style="font-size: 0.72rem; color: #34d399; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;" title="Last: ${escapeHtml(u.last_watched_anime)}">
              <i class="fas fa-circle-play" style="font-size: 0.68rem;"></i> ${escapeHtml(u.last_watched_anime)}
            </div>
          ` : ''}
        </td>

        <!-- Joined Date -->
        <td style="padding: 14px 20px; color: var(--text-muted); font-size: 0.78rem; white-space: nowrap;">
          ${joinedStr}
        </td>

        <!-- Actions -->
        <td style="padding: 14px 20px; text-align: right; white-space: nowrap;">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openAdminUserDetailModal(${u.id})" style="padding: 5px 10px; font-size: 0.76rem; margin-right: 5px;" title="View complete user dossier">
            <i class="fas fa-id-card"></i> Dossier
          </button>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openAdminPasswordModal(${u.id}, '${escapeHtml(u.username)}', '${escapeHtml(u.email)}')" style="padding: 5px 8px; font-size: 0.76rem; margin-right: 5px;" title="Reset user password">
            <i class="fas fa-key"></i>
          </button>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); toggleAdminUserRole(${u.id}, ${!isOwner}, '${escapeHtml(u.username)}')" style="padding: 5px 8px; font-size: 0.76rem; margin-right: 5px;" title="${isOwner ? 'Demote from Admin' : 'Promote to Admin'}">
            <i class="fas fa-crown" style="${isOwner ? 'color:#eab308;' : 'color:var(--text-muted);'}"></i>
          </button>
          ${!isOwner ? `
            <button class="btn btn-sm" onclick="event.stopPropagation(); deleteAdminUserAccount(${u.id}, '${escapeHtml(u.username)}')" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 5px 8px; font-size: 0.76rem;" title="Delete user">
              <i class="fas fa-trash"></i>
            </button>
          ` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminLoginsRows(logins, query = '') {
  const q = (query || '').toLowerCase().trim();
  const list = q ? logins.filter(l => 
    (l.username && l.username.toLowerCase().includes(q)) || 
    (l.email && l.email.toLowerCase().includes(q)) ||
    (l.ip_address && l.ip_address.toLowerCase().includes(q)) ||
    (l.device_type && l.device_type.toLowerCase().includes(q)) ||
    (l.browser && l.browser.toLowerCase().includes(q)) ||
    (l.os && l.os.toLowerCase().includes(q)) ||
    (l.status && l.status.toLowerCase().includes(q))
  ) : logins;

  if (!list || list.length === 0) {
    return `<tr><td colspan="6" style="padding: 36px; text-align: center; color: var(--text-muted);"><i class="fas fa-list-check" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>No login records match your search query</td></tr>`;
  }

  return list.map(l => {
    const isOwner = Boolean(l.is_admin);
    const loginDate = parseSqliteDate(l.logged_in_at);
    const relTime = formatAdminRelativeTime(l.logged_in_at);
    const fullTime = loginDate ? formatAdminFullDate(loginDate) : 'Unknown';

    // Device icon
    let devIcon = 'fa-laptop';
    if (l.device_type === 'Mobile') devIcon = 'fa-mobile-screen';
    else if (l.device_type === 'Tablet') devIcon = 'fa-tablet-screen-button';
    else if (l.device_type === 'Bot/Tool') devIcon = 'fa-robot';

    // Status Pill
    const st = l.status || 'SUCCESS';
    let statusPill = `<span class="admin-status-pill online"><i class="fas fa-check-circle"></i> Success</span>`;
    if (st === 'FAILED') {
      statusPill = `<span class="admin-status-pill failed" title="${escapeHtml(l.failure_reason || 'Failed')}"><i class="fas fa-triangle-exclamation"></i> ${escapeHtml(l.failure_reason || 'Failed')}</span>`;
    } else if (st === 'REGISTER') {
      statusPill = `<span class="admin-status-pill register"><i class="fas fa-user-plus"></i> Registered</span>`;
    } else if (st === 'RESET') {
      statusPill = `<span class="admin-status-pill reset"><i class="fas fa-key"></i> Pass Reset</span>`;
    }

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <!-- User identity -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${l.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${l.username}`}" alt="${escapeHtml(l.username)}" style="width: 34px; height: 34px; border-radius: 50%; background: var(--bg-tertiary); border: 1px solid var(--border); flex-shrink: 0;">
            <div>
              <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px; font-size: 0.86rem;">
                ${escapeHtml(l.username)}
                ${isOwner ? '<span title="Super Admin" style="color:#eab308; font-size: 0.75rem;"><i class="fas fa-crown"></i></span>' : ''}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">${escapeHtml(l.email)}</div>
            </div>
          </div>
        </td>

        <!-- Login Timestamp -->
        <td style="padding: 14px 20px; white-space: nowrap;">
          <div style="font-weight: 600; color: #fff; font-size: 0.84rem;">${relTime}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${fullTime}</div>
        </td>

        <!-- IP Address -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="admin-ip-pill">
              <i class="fas fa-network-wired" style="color:#60a5fa;"></i> ${escapeHtml(l.ip_address || '127.0.0.1')}
            </span>
            ${l.ip_address ? `
              <button onclick="navigator.clipboard.writeText('${escapeHtml(l.ip_address)}'); showToast('IP copied to clipboard!', 'info');" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 1px 3px; font-size: 0.7rem;" title="Copy IP">
                <i class="fas fa-copy"></i>
              </button>
            ` : ''}
          </div>
        </td>

        <!-- Device & OS -->
        <td style="padding: 14px 20px;">
          <span class="admin-device-pill">
            <i class="fas ${devIcon}"></i> ${escapeHtml(l.device_type || 'Desktop')} · ${escapeHtml(l.os || 'Unknown OS')}
          </span>
        </td>

        <!-- Browser -->
        <td style="padding: 14px 20px;">
          <span style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text-secondary); background: rgba(255,255,255,0.03); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <i class="fas fa-window-maximize" style="color:#38bdf8; font-size: 0.75rem;"></i> ${escapeHtml(l.browser || 'Browser')}
          </span>
        </td>

        <!-- Status -->
        <td style="padding: 14px 20px; text-align: right; white-space: nowrap;">
          ${statusPill}
        </td>
      </tr>
    `;
  }).join('');
}

function renderAdminWatchesRows(watches, query = '') {
  const q = (query || '').toLowerCase().trim();
  const list = q ? watches.filter(w => 
    (w.username && w.username.toLowerCase().includes(q)) ||
    (w.anime_title && w.anime_title.toLowerCase().includes(q)) ||
    (w.episode_title && w.episode_title.toLowerCase().includes(q))
  ) : watches;

  if (!list || list.length === 0) {
    return `<tr><td colspan="5" style="padding: 36px; text-align: center; color: var(--text-muted);"><i class="fas fa-film" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>No live watch events recorded yet</td></tr>`;
  }

  return list.map(w => {
    const relTime = formatAdminRelativeTime(w.watched_at);
    const fullTime = formatAdminFullDate(w.watched_at);
    const progressMin = Math.round((w.progress_seconds || 0) / 60);

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <!-- User -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${w.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${w.username}`}" style="width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border);">
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.85rem;">${escapeHtml(w.username)}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">ID #${w.user_id}</div>
            </div>
          </div>
        </td>

        <!-- Anime & Episode -->
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${w.cover_image || '/images/no-cover.png'}" style="width: 36px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
            <div>
              <a href="/anime/${w.anime_slug}" onclick="navigateTo('/anime/${w.anime_slug}'); return false;" style="font-weight: 700; color: #fff; font-size: 0.88rem; text-decoration: none; display: block;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='#fff'">
                ${escapeHtml(w.anime_title)}
              </a>
              <div style="font-size: 0.78rem; color: #34d399; margin-top: 2px;">
                Episode ${w.episode_number}: ${escapeHtml(w.episode_title || `Episode ${w.episode_number}`)}
              </div>
            </div>
          </div>
        </td>

        <!-- Watched Time -->
        <td style="padding: 14px 20px; white-space: nowrap;">
          <div style="font-weight: 600; color: #fff; font-size: 0.84rem;">${relTime}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${fullTime}</div>
        </td>

        <!-- Progress -->
        <td style="padding: 14px 20px;">
          <div style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 20px; background: rgba(59, 130, 246, 0.12); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.76rem; font-weight: 600;">
            <i class="fas fa-play"></i> ${progressMin > 0 ? `${progressMin} min` : 'Started'}
          </div>
        </td>

        <!-- Action -->
        <td style="padding: 14px 20px; text-align: right; white-space: nowrap;">
          <a href="/watch/${w.anime_id}?ep=${w.episode_number}" onclick="navigateTo('/watch/${w.anime_id}?ep=${w.episode_number}'); return false;" class="btn btn-outline btn-sm" style="padding: 4px 10px; font-size: 0.75rem;">
            <i class="fas fa-circle-play"></i> Watch
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

function switchAdminTab(tab) {
  adminActiveTab = tab;
  const usersView = document.getElementById('admin-view-users');
  const loginsView = document.getElementById('admin-view-logins');
  const watchesView = document.getElementById('admin-view-watches');
  const discoveryView = document.getElementById('admin-view-discovery');
  const chips = document.getElementById('admin-filter-chips');

  const btnUsers = document.getElementById('tab-btn-users');
  const btnLogins = document.getElementById('tab-btn-logins');
  const btnWatches = document.getElementById('tab-btn-watches');
  const btnDiscovery = document.getElementById('tab-btn-discovery');

  if (usersView) usersView.style.display = tab === 'users' ? 'block' : 'none';
  if (loginsView) loginsView.style.display = tab === 'logins' ? 'block' : 'none';
  if (watchesView) watchesView.style.display = tab === 'watches' ? 'block' : 'none';
  if (discoveryView) discoveryView.style.display = tab === 'discovery' ? 'block' : 'none';
  if (chips) chips.style.display = tab === 'users' ? 'flex' : 'none';

  if (btnUsers) btnUsers.classList.toggle('active', tab === 'users');
  if (btnLogins) btnLogins.classList.toggle('active', tab === 'logins');
  if (btnWatches) btnWatches.classList.toggle('active', tab === 'watches');
  if (btnDiscovery) btnDiscovery.classList.toggle('active', tab === 'discovery');

  // Reapply current search filter to newly visible tab
  const searchInput = document.getElementById('admin-table-search');
  if (searchInput) filterAdminCurrentTab(searchInput.value);
}

function setAdminUserFilter(filter) {
  adminUserFilter = filter;
  // Update chip active classes
  const chips = document.querySelectorAll('.admin-filter-chip');
  chips.forEach(c => c.classList.remove('active'));
  const currentSearch = document.getElementById('admin-table-search')?.value || '';
  const tbody = document.getElementById('admin-users-tbody');
  if (tbody) tbody.innerHTML = renderAdminUsersRows(adminUsersCache, currentSearch, adminUserFilter);
  // Re-highlight active button
  const activeBtn = Array.from(chips).find(b => b.getAttribute('onclick')?.includes(`'${filter}'`));
  if (activeBtn) activeBtn.classList.add('active');
}

function filterAdminCurrentTab(query) {
  if (adminActiveTab === 'users') {
    const tbody = document.getElementById('admin-users-tbody');
    if (tbody) tbody.innerHTML = renderAdminUsersRows(adminUsersCache, query, adminUserFilter);
  } else if (adminActiveTab === 'logins') {
    const tbody = document.getElementById('admin-logins-tbody');
    if (tbody) tbody.innerHTML = renderAdminLoginsRows(adminLoginsCache, query);
  } else if (adminActiveTab === 'watches') {
    const tbody = document.getElementById('admin-watches-tbody');
    if (tbody) tbody.innerHTML = renderAdminWatchesRows(adminWatchesCache, query);
  } else if (adminActiveTab === 'discovery') {
    const tbody = document.getElementById('admin-discovery-tbody');
    if (tbody) tbody.innerHTML = renderAdminDiscoveryRows(adminDiscoveryCache?.recentLogs || [], query);
  }
}

function renderAdminDiscoveryRows(logs, query = '') {
  const q = (query || '').toLowerCase().trim();
  const list = q ? logs.filter(l => 
    (l.title && l.title.toLowerCase().includes(q)) ||
    (l.slug && l.slug.toLowerCase().includes(q)) ||
    (l.source && l.source.toLowerCase().includes(q))
  ) : logs;

  if (!list || list.length === 0) {
    return `<tr><td colspan="6" style="padding: 36px; text-align: center; color: var(--text-muted);"><i class="fas fa-radar" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>No auto-discovery logs recorded yet. Search any movie/anime on the site to trigger discovery!</td></tr>`;
  }

  return list.map(l => {
    const relTime = formatAdminRelativeTime(l.created_at);
    const fullTime = formatAdminFullDate(l.created_at);
    const isAniList = l.source === 'AniList';

    const sourceBadge = isAniList
      ? `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35);"><i class="fas fa-play" style="font-size:0.65rem;"></i> AniList</span>`
      : `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35);"><i class="fas fa-film" style="font-size:0.65rem;"></i> TMDB</span>`;

    const triggerBadge = l.triggered_by === 'admin_manual'
      ? `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.35);"><i class="fas fa-crown" style="font-size:0.65rem;"></i> Admin Manual</span>`
      : (l.triggered_by === 'trending_cron'
      ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);"><i class="fas fa-cloud" style="font-size:0.65rem;"></i> Trending Auto</span>`
      : `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.35);"><i class="fas fa-search" style="font-size:0.65rem;"></i> User Search</span>`);

    return `
      <tr style="border-bottom: 1px solid var(--border); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <td style="padding: 14px 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${l.poster_image || '/images/no-cover.png'}" style="width: 36px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);" onerror="this.src='/images/no-cover.png'">
            <div>
              <a href="/anime/${l.slug}" onclick="navigateTo('/anime/${l.slug}'); return false;" style="font-weight: 700; color: #fff; font-size: 0.88rem; text-decoration: none; display: block;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='#fff'">
                ${escapeHtml(l.title)}
              </a>
              <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace; margin-top: 2px;">
                ${escapeHtml(l.slug)}
              </div>
            </div>
          </div>
        </td>
        <td style="padding: 14px 20px;">
          <span class="badge" style="background: rgba(255,255,255,0.08); color: #e2e8f0; font-size: 0.75rem;">
            ${l.type || 'Movie'} · ${(l.category || 'live_action').replace('_', ' ')}
          </span>
        </td>
        <td style="padding: 14px 20px;">
          ${sourceBadge}
        </td>
        <td style="padding: 14px 20px;">
          ${triggerBadge}
        </td>
        <td style="padding: 14px 20px; white-space: nowrap;">
          <div style="font-weight: 600; color: #fff; font-size: 0.84rem;">${relTime}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${fullTime}</div>
        </td>
        <td style="padding: 14px 20px; text-align: right; white-space: nowrap;">
          <a href="/anime/${l.slug}" onclick="navigateTo('/anime/${l.slug}'); return false;" class="btn btn-outline btn-sm" style="padding: 4px 10px; font-size: 0.75rem;">
            <i class="fas fa-external-link-alt"></i> View
          </a>
        </td>
      </tr>
    `;
  }).join('');
}

async function triggerAdminDiscovery() {
  const input = document.getElementById('admin-discovery-input');
  const btn = document.getElementById('admin-discover-run-btn');
  const resultBox = document.getElementById('admin-discovery-result');
  const q = input?.value.trim();
  if (!q) {
    showToast('Please enter a title to discover', 'error');
    input?.focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Searching...`;
  resultBox.style.display = 'block';
  resultBox.innerHTML = `
    <div style="padding: 16px; background: rgba(0,0,0,0.25); border: 1px solid var(--border); border-radius: 10px; text-align: center; color: var(--text-muted);">
      <i class="fas fa-satellite-dish fa-spin" style="color:var(--accent); font-size: 1.4rem; margin-bottom: 8px; display: block;"></i>
      Searching TMDB & AniList archives for "${escapeHtml(q)}"...
    </div>
  `;

  try {
    const res = await api('/admin/auto-discover', {
      method: 'POST',
      body: JSON.stringify({ query: q })
    });

    const item = res.data;
    resultBox.innerHTML = `
      <div style="padding: 14px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; display: flex; align-items: center; justify-content: space-between; gap: 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${item.cover_image || '/images/no-cover.png'}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border);" onerror="this.src='/images/no-cover.png'">
          <div>
            <div style="font-weight: 800; color: #fff; font-size: 0.95rem;">${escapeHtml(item.title)}</div>
            <div style="font-size: 0.78rem; color: #34d399; margin-top: 2px;">
              <i class="fas fa-check-circle"></i> Successfully Imported into Vault (${escapeHtml(item.source || 'TMDB')})
            </div>
          </div>
        </div>
        <a href="/anime/${item.slug}" onclick="navigateTo('/anime/${item.slug}'); return false;" class="btn btn-primary btn-sm">
          <i class="fas fa-play"></i> Watch Now
        </a>
      </div>
    `;
    showToast(`Discovered & Imported: "${item.title}"!`, 'success');
    input.value = '';
    await fetchAdminData(false);
  } catch (err) {
    resultBox.innerHTML = `
      <div style="padding: 14px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 12px; color: #f87171; font-size: 0.88rem;">
        <i class="fas fa-exclamation-circle" style="margin-right: 6px;"></i> ${escapeHtml(err.message)}
      </div>
    `;
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-magnifying-glass-plus"></i> Import`;
  }
}

async function triggerAdminBulkDiscovery() {
  const btn = document.getElementById('admin-bulk-discovery-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Scanning Trending...`;
  }
  showToast('Scanning TMDB & AniList for top weekly trending titles...', 'info');

  try {
    const res = await api('/admin/bulk-discover', {
      method: 'POST',
      body: JSON.stringify({ limit: 20 })
    });
    showToast(res.message || 'Bulk trending discovery completed!', 'success');
    await fetchAdminData(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fas fa-cloud-arrow-down"></i> Sync Weekly Trending`;
    }
  }
}

async function toggleAdminDiscoveryEngine() {
  if (!adminDiscoveryCache) return;
  const newStatus = !adminDiscoveryCache.enabled;
  try {
    const res = await api('/admin/discovery-settings', {
      method: 'POST',
      body: JSON.stringify({ enabled: newStatus })
    });
    adminDiscoveryCache.enabled = res.enabled;
    showToast(res.message, res.enabled ? 'success' : 'info');
    renderAdminDashboardContent();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startAdminAutoRefresh() {
  if (adminAutoRefreshTimer) {
    clearInterval(adminAutoRefreshTimer);
  }
  adminAutoRefreshTimer = setInterval(async () => {
    if (!adminAutoRefreshEnabled) return;
    // Only refresh if currently on /admin page
    if (window.location.pathname !== '/admin') {
      clearInterval(adminAutoRefreshTimer);
      adminAutoRefreshTimer = null;
      return;
    }
    await fetchAdminData(false);
  }, 15000); // Poll every 15s
}

function toggleAdminAutoRefresh() {
  adminAutoRefreshEnabled = !adminAutoRefreshEnabled;
  const btn = document.getElementById('admin-auto-refresh-btn');
  if (btn) {
    btn.innerHTML = `
      <span class="status-pulse-dot" style="${adminAutoRefreshEnabled ? '' : 'background:#64748b; animation:none;'}"></span>
      <span>Live Sync: ${adminAutoRefreshEnabled ? 'ON (15s)' : 'PAUSED'}</span>
    `;
  }
  showToast(adminAutoRefreshEnabled ? 'Real-time live sync enabled (15s)' : 'Live sync paused', 'info');
}

// ===== USER DOSSIER MODAL =====
async function openAdminUserDetailModal(userId) {
  const modal = document.getElementById('admin-user-dossier-modal');
  const card = document.getElementById('admin-dossier-card');
  if (!modal || !card) return;

  modal.style.display = 'flex';
  card.innerHTML = `
    <div style="padding: 60px; text-align: center;">
      <i class="fas fa-spinner fa-spin" style="font-size: 2.2rem; color: var(--accent); margin-bottom: 14px;"></i>
      <h3 style="color:#fff; margin:0; font-size:1.1rem;">Loading Full User Profile Dossier...</h3>
      <p style="color:var(--text-muted); font-size:0.85rem; margin-top:4px;">Retrieving watch history, saved watchlist, and login audits...</p>
    </div>
  `;

  try {
    const res = await api(`/admin/users/${userId}`);
    adminDetailModalUser = res.data;
    adminDetailActiveSubtab = 'history';
    renderAdminUserDetailModal(res.data);
  } catch (err) {
    card.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #ef4444; margin-bottom: 12px;"></i>
        <h3 style="color:#fff;">Failed to load user dossier</h3>
        <p style="color:var(--text-muted);">${escapeHtml(err.message)}</p>
        <button class="btn btn-outline btn-sm" onclick="closeAdminUserDetailModal()">Close</button>
      </div>
    `;
  }
}

function closeAdminUserDetailModal() {
  const modal = document.getElementById('admin-user-dossier-modal');
  if (modal) modal.style.display = 'none';
  adminDetailModalUser = null;
}

function renderAdminUserDetailModal(dossier) {
  const card = document.getElementById('admin-dossier-card');
  if (!card || !dossier) return;

  const u = dossier.user;
  const isOwner = Boolean(u.is_admin);
  const status = getAdminUserStatus(u);
  const joinedStr = u.created_at ? formatAdminFullDate(u.created_at) : 'Unknown';
  const lastActiveStr = u.last_active ? formatAdminFullDate(u.last_active) : (u.last_login ? formatAdminFullDate(u.last_login) : 'Never');

  let devIcon = 'fa-laptop';
  if (u.device_type === 'Mobile') devIcon = 'fa-mobile-screen';
  else if (u.device_type === 'Tablet') devIcon = 'fa-tablet-screen-button';
  else if (u.device_type === 'Bot/Tool') devIcon = 'fa-robot';

  card.innerHTML = `
    <!-- Modal Header -->
    <div class="admin-dossier-header">
      <div style="display: flex; align-items: center; gap: 18px;">
        <div style="position: relative;">
          <img src="${u.avatar_url || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.username}`}" alt="${escapeHtml(u.username)}" style="width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--border); background: var(--bg-tertiary);">
          ${status.isOnline ? `<span class="status-pulse-dot" style="position: absolute; bottom: 2px; right: 2px; border: 2px solid var(--bg-secondary); width: 12px; height: 12px;"></span>` : ''}
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
            <h2 style="color: #fff; margin: 0; font-size: 1.4rem; font-weight: 800;">${escapeHtml(u.username)}</h2>
            ${isOwner ? '<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #facc15; border: 1px solid rgba(234, 179, 8, 0.4); font-size: 0.72rem; padding: 2px 8px;"><i class="fas fa-crown"></i> Admin</span>' : '<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-secondary); font-size: 0.72rem; padding: 2px 8px;">Member</span>'}
            <span style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">ID #${u.id}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 12px; font-size: 0.85rem; flex-wrap: wrap;">
            <span style="color: #93c5fd; font-family: monospace; display: flex; align-items: center; gap: 6px;">
              <i class="fas fa-envelope" style="font-size:0.75rem;"></i> ${escapeHtml(u.email)}
              <button onclick="navigator.clipboard.writeText('${escapeHtml(u.email)}'); showToast('Email copied!', 'info');" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.72rem;" title="Copy email"><i class="fas fa-copy"></i></button>
            </span>
            <span style="color: var(--text-muted);">&bull;</span>
            <span style="color: var(--text-secondary);"><i class="fas fa-calendar-alt"></i> Joined: ${joinedStr}</span>
            <span style="color: var(--text-muted);">&bull;</span>
            <span style="color: var(--text-secondary);"><i class="fas ${devIcon}"></i> ${escapeHtml(u.device_type || 'Desktop')}</span>
            <span style="color: var(--text-muted);">&bull;</span>
            <span style="color: var(--text-secondary); font-family: monospace;"><i class="fas fa-network-wired"></i> ${escapeHtml(u.last_ip || '127.0.0.1')}</span>
          </div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn btn-outline btn-sm" onclick="openAdminPasswordModal(${u.id}, '${escapeHtml(u.username)}', '${escapeHtml(u.email)}')" title="Reset Password">
          <i class="fas fa-key"></i> Set Password
        </button>
        <button class="btn btn-outline btn-sm" onclick="toggleAdminUserRole(${u.id}, ${!isOwner}, '${escapeHtml(u.username)}')" title="${isOwner ? 'Demote' : 'Promote'}">
          <i class="fas fa-crown" style="${isOwner ? 'color:#eab308;' : 'color:var(--text-muted);'}"></i> ${isOwner ? 'Demote' : 'Make Admin'}
        </button>
        <button onclick="closeAdminUserDetailModal()" style="background: none; border: none; color: var(--text-muted); font-size: 1.3rem; cursor: pointer; padding: 4px 8px; border-radius: 6px;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-muted)'">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <!-- Subtabs Navigation -->
    <div class="admin-dossier-subtabs">
      <button class="admin-dossier-subtab-btn ${adminDetailActiveSubtab === 'history' ? 'active' : ''}" onclick="switchAdminDossierSubtab('history')">
        <i class="fas fa-clock-rotate-left"></i> Watch History (${dossier.watchHistory.length})
      </button>
      <button class="admin-dossier-subtab-btn ${adminDetailActiveSubtab === 'watchlist' ? 'active' : ''}" onclick="switchAdminDossierSubtab('watchlist')">
        <i class="fas fa-bookmark"></i> Watchlist & Saved (${dossier.watchlist.length})
      </button>
      <button class="admin-dossier-subtab-btn ${adminDetailActiveSubtab === 'favorites' ? 'active' : ''}" onclick="switchAdminDossierSubtab('favorites')">
        <i class="fas fa-heart"></i> Favorites (${dossier.favorites.length}) & Comments (${dossier.comments.length})
      </button>
      <button class="admin-dossier-subtab-btn ${adminDetailActiveSubtab === 'logins' ? 'active' : ''}" onclick="switchAdminDossierSubtab('logins')">
        <i class="fas fa-fingerprint"></i> Session Logins (${dossier.logins.length})
      </button>
    </div>

    <!-- Subtab Body -->
    <div class="admin-dossier-body" id="admin-dossier-subtab-content">
      ${renderAdminDossierSubtabContent(dossier, adminDetailActiveSubtab)}
    </div>
  `;
}

function switchAdminDossierSubtab(tabName) {
  adminDetailActiveSubtab = tabName;
  const container = document.getElementById('admin-dossier-subtab-content');
  if (container && adminDetailModalUser) {
    container.innerHTML = renderAdminDossierSubtabContent(adminDetailModalUser, tabName);
  }
  const buttons = document.querySelectorAll('.admin-dossier-subtab-btn');
  buttons.forEach(b => {
    const isAct = b.getAttribute('onclick')?.includes(`'${tabName}'`);
    b.classList.toggle('active', Boolean(isAct));
  });
}

function renderAdminDossierSubtabContent(dossier, tabName) {
  if (tabName === 'history') {
    const list = dossier.watchHistory || [];
    if (!list.length) {
      return `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <i class="fas fa-eye-slash" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          <p>No watch history records found for this user yet.</p>
        </div>
      `;
    }
    return `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${list.map(h => {
          const relTime = formatAdminRelativeTime(h.watched_at);
          const fullTime = formatAdminFullDate(h.watched_at);
          const progressMin = Math.round((h.progress_seconds || 0) / 60);

          return `
            <div class="admin-dossier-item" style="justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 14px;">
                <img src="${h.cover_image || '/images/no-cover.png'}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border);">
                <div>
                  <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">
                    ${escapeHtml(h.anime_title)}
                  </div>
                  <div style="font-size: 0.82rem; color: #34d399; margin-top: 2px;">
                    Episode ${h.episode_number}: ${escapeHtml(h.episode_title || `Episode ${h.episode_number}`)}
                  </div>
                  <div style="font-size: 0.74rem; color: var(--text-muted); margin-top: 4px;">
                    <i class="fas fa-clock"></i> Watched ${relTime} (${fullTime})
                  </div>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 12px; text-align: right;">
                <div style="font-size: 0.78rem; color: #60a5fa; background: rgba(59, 130, 246, 0.12); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(59, 130, 246, 0.3);">
                  <i class="fas fa-play"></i> ${progressMin > 0 ? `${progressMin} min watched` : 'Watched'}
                </div>
                <a href="/watch/${h.anime_id}?ep=${h.episode_number}" target="_blank" class="btn btn-outline btn-sm" style="padding: 4px 10px; font-size: 0.76rem;" title="Open player">
                  <i class="fas fa-external-link-alt"></i>
                </a>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (tabName === 'watchlist') {
    const list = dossier.watchlist || [];
    if (!list.length) {
      return `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <i class="fas fa-bookmark" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          <p>This user hasn't added any anime to their watchlist yet.</p>
        </div>
      `;
    }
    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;">
        ${list.map(w => {
          let statusBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.72rem;">${escapeHtml(w.status || 'watching')}</span>`;
          if (w.status === 'completed') {
            statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.72rem;">Completed</span>`;
          } else if (w.status === 'plan_to_watch') {
            statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.72rem;">Plan to Watch</span>`;
          }

          return `
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 12px; display: flex; gap: 12px; align-items: center;">
              <img src="${w.cover_image || '/images/no-cover.png'}" style="width: 50px; height: 70px; object-fit: cover; border-radius: 8px; flex-shrink: 0;">
              <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: 700; color: #fff; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(w.anime_title)}
                </div>
                <div style="margin: 4px 0;">${statusBadge}</div>
                <div style="font-size: 0.74rem; color: var(--text-muted);">
                  Ep ${w.current_episode || 0} / ${w.episodes_count || '?'}
                </div>
                ${w.rating ? `<div style="font-size: 0.72rem; color: #eab308; margin-top: 2px;"><i class="fas fa-star"></i> ${w.rating}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  if (tabName === 'favorites') {
    const favs = dossier.favorites || [];
    const cmts = dossier.comments || [];
    return `
      <div>
        <h4 style="color:#fff; margin:0 0 12px; font-size:0.95rem;"><i class="fas fa-heart" style="color:#ec4899;"></i> Favorite Anime (${favs.length})</h4>
        ${favs.length ? `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 24px;">
            ${favs.map(f => `
              <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 10px; display: flex; gap: 10px; align-items: center;">
                <img src="${f.cover_image || '/images/no-cover.png'}" style="width: 40px; height: 56px; object-fit: cover; border-radius: 6px;">
                <div style="flex: 1; overflow: hidden;">
                  <div style="font-weight: 700; color: #fff; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(f.anime_title)}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Added ${formatAdminRelativeTime(f.created_at)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `<p style="color:var(--text-muted); font-size:0.85rem; margin-bottom: 24px;">No favorites saved yet.</p>`}

        <h4 style="color:#fff; margin:0 0 12px; font-size:0.95rem;"><i class="fas fa-comment-dots" style="color:#38bdf8;"></i> Comments Posted (${cmts.length})</h4>
        ${cmts.length ? `
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${cmts.map(c => `
              <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; padding: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 0.78rem;">
                  <strong style="color: #38bdf8;">${escapeHtml(c.anime_title || 'Episode Comment')}</strong>
                  <span style="color: var(--text-muted);">${formatAdminRelativeTime(c.created_at)}</span>
                </div>
                <p style="margin: 0; color: var(--text-secondary); font-size: 0.86rem; line-height: 1.4;">
                  ${escapeHtml(c.content)}
                </p>
              </div>
            `).join('')}
          </div>
        ` : `<p style="color:var(--text-muted); font-size:0.85rem;">No comments posted yet.</p>`}
      </div>
    `;
  }

  if (tabName === 'logins') {
    const list = dossier.logins || [];
    if (!list.length) {
      return `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <i class="fas fa-key" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          <p>No recorded login history for this account yet.</p>
        </div>
      `;
    }
    return `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${list.map(l => {
          const relTime = formatAdminRelativeTime(l.logged_in_at);
          const fullTime = formatAdminFullDate(l.logged_in_at);
          const st = l.status || 'SUCCESS';
          let statusBadge = `<span class="admin-status-pill online" style="font-size:0.7rem;"><i class="fas fa-check-circle"></i> Success</span>`;
          if (st === 'FAILED') {
            statusBadge = `<span class="admin-status-pill failed" style="font-size:0.7rem;"><i class="fas fa-triangle-exclamation"></i> ${escapeHtml(l.failure_reason || 'Failed')}</span>`;
          } else if (st === 'RESET') {
            statusBadge = `<span class="admin-status-pill reset" style="font-size:0.7rem;"><i class="fas fa-key"></i> Pass Reset</span>`;
          }

          return `
            <div class="admin-dossier-item" style="justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,0.04); display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                  <i class="fas ${l.device_type === 'Mobile' ? 'fa-mobile-screen' : 'fa-laptop'}"></i>
                </div>
                <div>
                  <div style="font-size: 0.85rem; color: #fff; font-weight: 600;">
                    ${escapeHtml(l.browser || 'Browser')} on ${escapeHtml(l.os || 'Unknown OS')} (${escapeHtml(l.device_type || 'Desktop')})
                  </div>
                  <div style="font-size: 0.74rem; color: var(--text-muted); font-family: monospace; margin-top: 2px;">
                    IP: ${escapeHtml(l.ip_address || '127.0.0.1')}
                  </div>
                </div>
              </div>
              <div style="text-align: right;">
                <div>${statusBadge}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">${relTime} (${fullTime})</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return '';
}

async function toggleAdminUserRole(userId, newRole, username) {
  if (!confirm(`Are you sure you want to ${newRole ? 'promote' : 'demote'} "${username}" to ${newRole ? 'Admin' : 'regular Member'}?`)) {
    return;
  }
  try {
    const res = await api(`/admin/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ is_admin: newRole ? 1 : 0 })
    });
    showToast(res.message || 'User role updated', 'success');
    await fetchAdminData(false);
    if (adminDetailModalUser && adminDetailModalUser.user.id === userId) {
      openAdminUserDetailModal(userId);
    }
  } catch (err) {
    showToast(err.message || 'Failed to update role', 'error');
  }
}

function exportAdminUsers(format = 'csv') {
  if (format === 'csv') {
    window.open('/api/admin/export?format=csv', '_blank');
  } else {
    window.open('/api/admin/export?format=json', '_blank');
  }
  showToast(`Exporting users as ${format.toUpperCase()}...`, 'info');
}

function openAdminPasswordModal(userId, username, email) {
  adminTargetUser = { id: userId, username, email };
  const modal = document.getElementById('admin-pwd-modal');
  const label = document.getElementById('admin-modal-username');
  const input = document.getElementById('admin-new-password-input');
  if (label) label.textContent = `User: ${username} (${email})`;
  if (input) input.value = '';
  if (modal) modal.style.display = 'flex';
}

function closeAdminPasswordModal() {
  const modal = document.getElementById('admin-pwd-modal');
  if (modal) modal.style.display = 'none';
  adminTargetUser = null;
}

async function submitAdminPasswordReset() {
  if (!adminTargetUser) return;
  const input = document.getElementById('admin-new-password-input');
  const newPassword = input?.value?.trim();
  if (!newPassword || newPassword.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await api(`/admin/users/${adminTargetUser.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
    showToast(res.message || 'Password updated successfully!', 'success');
    closeAdminPasswordModal();
    if (adminDetailModalUser && adminDetailModalUser.user.id === adminTargetUser.id) {
      openAdminUserDetailModal(adminTargetUser.id);
    }
  } catch (err) {
    showToast(err.message || 'Failed to update password', 'error');
  }
}

async function deleteAdminUserAccount(userId, username) {
  if (!confirm(`Are you sure you want to permanently delete user "${username}"? This will remove all their watch history and bookmarks.`)) {
    return;
  }

  try {
    const res = await api(`/admin/users/${userId}`, { method: 'DELETE' });
    showToast(res.message || 'User deleted successfully', 'success');
    closeAdminUserDetailModal();
    fetchAdminData(true);
  } catch (err) {
    showToast(err.message || 'Failed to delete user', 'error');
  }
}

// ===== INIT =====
async function init() {
  // Install page-level popup & redirect guard for iframe embed protection
  installPopupGuard();

  // Check auth
  try {
    const res = await api('/auth/me');
    currentUser = res.data;
    updateAuthUI();
    syncGuestHistoryToCloud();
  } catch (e) {
    // Not logged in
  }

  // Load genres dropdown
  try {
    const genresRes = await api('/genres');
    const dropdown = document.getElementById('genre-dropdown');
    if (dropdown) {
      const topItems = `
        <a href="/browse" onclick="navigateTo('/browse'); return false;"><i class="fas fa-compass" style="margin-right:8px;color:var(--accent);"></i> All Anime & Shows</a>
        <a href="/browse?type=AnimeMovie" onclick="navigateTo('/browse?type=AnimeMovie'); return false;"><i class="fas fa-film" style="margin-right:8px;color:#ec4899;"></i> Anime Movies</a>
        <a href="/browse?sort=rating" onclick="navigateTo('/browse?sort=rating'); return false;"><i class="fas fa-star" style="margin-right:8px;color:#f59e0b;"></i> Top Rated</a>
        <a href="/browse?status=Airing" onclick="navigateTo('/browse?status=Airing'); return false;"><i class="fas fa-tower-broadcast" style="margin-right:8px;color:#38bdf8;"></i> Currently Airing</a>
        <div class="dropdown-divider"></div>
        <div style="padding:6px 14px 2px;font-size:0.7rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Popular Genres</div>
      `;
      dropdown.innerHTML = topItems + (genresRes.data || []).slice(0, 10).map(g =>
        `<a href="/browse?genre=${g.slug}" onclick="navigateTo('/browse?genre=${g.slug}'); return false;"><i class="fas fa-tag" style="margin-right:8px;font-size:0.75rem;color:var(--text-muted);"></i> ${g.name}</a>`
      ).join('') + `
        <div class="dropdown-divider"></div>
        <a href="/genres" onclick="navigateTo('/genres'); return false;" style="color:var(--accent);font-weight:600;"><i class="fas fa-tags" style="margin-right:8px;"></i> All Genres &rarr;</a>
      `;
    }
  } catch (e) {}

  // Search event
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
    searchInput.addEventListener('blur', () => {
      setTimeout(() => document.getElementById('search-results')?.classList.remove('active'), 200);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.length >= 2) handleSearch(searchInput.value);
    });
  }

  // Keyboard shortcuts: / for search, Esc to close modals, N/P/T/R/L/Arrows on player
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      searchInput?.focus();
    }
    if (e.key === 'Escape') {
      document.getElementById('search-results')?.classList.remove('active');
      closeAuthModal();
      document.getElementById('mobile-menu')?.classList.remove('active');
      const dimmer = document.getElementById('cinema-dimmer');
      if (dimmer && dimmer.classList.contains('active')) {
        toggleWatchFocusLight();
      }
    }
    if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      if (window.location.pathname.startsWith('/watch/') && watchState.ep) {
        const k = e.key.toLowerCase();
        if ((k === 'n' || e.key === 'MediaTrackNext') && watchState.ep.nextEpisode) {
          e.preventDefault();
          navigateTo(`/watch/${watchState.ep.nextEpisode.id}`);
          showToast(`Playing Next: Episode ${watchState.ep.nextEpisode.number}`, 'info');
        } else if ((k === 'p' || k === 'b' || e.key === 'MediaTrackPrevious') && watchState.ep.prevEpisode) {
          e.preventDefault();
          navigateTo(`/watch/${watchState.ep.prevEpisode.id}`);
          showToast(`Playing Previous: Episode ${watchState.ep.prevEpisode.number}`, 'info');
        } else if (k === 'f') {
          e.preventDefault();
          toggleWatchFullscreen();
        } else if (k === 't') {
          e.preventDefault();
          toggleWatchTheater();
        } else if (k === 'r') {
          e.preventDefault();
          reloadWatchPlayer();
        } else if (k === 'l') {
          e.preventDefault();
          toggleWatchFocusLight();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          seekWatchPlayerRelative(5);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          seekWatchPlayerRelative(-5);
        } else if (e.key === ' ' || k === 'k') {
          e.preventDefault();
          toggleWatchPlayPause();
        }
      }
    }
  });

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  });

  // Close modal on overlay click
  document.getElementById('auth-modal').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeAuthModal();
  });

  // Initialize Animated AI Companion Pet
  initPetCompanion();

  // Hide loading screen
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('hidden');
  }, 800);

  // Route
  handleRoute();
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

// Global window bindings for inline HTML handlers
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleResetPassword = handleResetPassword;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openAdminPasswordModal = openAdminPasswordModal;
window.closeAdminPasswordModal = closeAdminPasswordModal;
window.submitAdminPasswordReset = submitAdminPasswordReset;


// ===== VAULT TOONS CLIENT MODULE =====
async function renderToonsPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="toons-hub">
      <div class="toons-hero">
        <div class="toons-hero-badge"><i class="fas fa-sparkles"></i> Vault Toons Hub</div>
        <h1 class="toons-hero-title">Hindi Dub Anime & <span>Indian Cartoons</span></h1>
        <p class="toons-hero-desc">Stream full episodes of Doraemon, Shinchan, Naruto Shippuden Hindi, Dragon Ball Super, and classic animated blockbusters with 100% ad-free multi-server streams.</p>
        
        <div class="toons-search-bar">
          <div class="toons-search-input-wrap">
            <i class="fas fa-search"></i>
            <input type="text" id="toons-search-input" class="toons-search-input" placeholder="Search Hindi Dub Anime, Doraemon, Shinchan, Dragon Ball..." autocomplete="off">
            <div id="toons-search-spinner" style="display:none; color:#38bdf8; font-size:0.85rem;"><i class="fas fa-spinner fa-spin"></i></div>
          </div>
          <div class="toons-search-results" id="toons-search-results"></div>
        </div>
      </div>

      <div id="toons-content">
        <div class="loading-state" style="padding:40px; text-align:center;"><div class="spinner"></div><p style="color:#38bdf8; margin-top:12px;">Loading Vault Toons...</p></div>
      </div>
    </div>
  `;

  // Attach live search listener
  const input = document.getElementById('toons-search-input');
  const resultsBox = document.getElementById('toons-search-results');
  let searchTimer = null;

  input?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      resultsBox?.classList.remove('active');
      return;
    }

    searchTimer = setTimeout(async () => {
      const spinner = document.getElementById('toons-search-spinner');
      if (spinner) spinner.style.display = 'block';
      try {
        const res = await fetch(`${API_BASE}/api/toons/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data = await res.json();
        if (spinner) spinner.style.display = 'none';
        if (data.results && data.results.length > 0) {
          resultsBox.innerHTML = data.results.map(item => `
            <div class="toons-search-item" onclick="navigateTo('${item.link}')">
              <img src="${item.img}" alt="${escapeHtml(item.title)}" onerror="this.src='/images/placeholder.svg'">
              <div class="toons-search-item-info">
                <h4>${escapeHtml(item.title)}</h4>
                <span><i class="fas ${item.type === 'series' ? 'fa-tv' : 'fa-film'}"></i> ${item.type}</span>
              </div>
            </div>
          `).join('');
          resultsBox.classList.add('active');
        } else {
          resultsBox.innerHTML = '<div style="padding:14px; text-align:center; color:rgba(255,255,255,0.5);">No results found</div>';
          resultsBox.classList.add('active');
        }
      } catch (err) {
        if (spinner) spinner.style.display = 'none';
      }
    }, 350);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.toons-search-bar')) {
      resultsBox?.classList.remove('active');
    }
  });

  try {
    const res = await fetch(`${API_BASE}/api/toons/home`, { credentials: 'include' });
    const data = await res.json();
    const container = document.getElementById('toons-content');
    if (!container) return;

    let html = '';

    // 1. Iconic Hindi Dub Classics
    if (data.iconicHindiShows && data.iconicHindiShows.length > 0) {
      html += `
        <div class="toons-section-title">
          <i class="fas fa-crown"></i>
          <span>Legendary Hindi Dub Classics</span>
          <span class="toons-section-badge">POPULAR</span>
        </div>
        <div class="toons-grid">
          ${data.iconicHindiShows.map(item => `
            <div class="toon-card" onclick="navigateTo('/toons/series/${item.slug}')">
              <div class="toon-card-poster">
                <span class="toon-badge-ep" style="color:#fbbf24; border-color:rgba(251,191,36,0.3);">${item.badge}</span>
                <span class="toon-badge-rating"><i class="fas fa-star"></i> ${item.vote}</span>
                <img src="${item.img}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
              </div>
              <div class="toon-card-info">
                <div class="toon-card-title">${escapeHtml(item.title)}</div>
                <div class="toon-card-meta">
                  <span>Hindi Audio</span>
                  <span>HD 1080p</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // 2. Fresh Airing Hindi & Cartoon Episodes
    if (data.recentEpisodes && data.recentEpisodes.length > 0) {
      html += `
        <div class="toons-section-title">
          <i class="fas fa-bolt"></i>
          <span>Fresh Airing Episodes & Drops</span>
          <span class="toons-section-badge">JUST ADDED</span>
        </div>
        <div class="toons-grid">
          ${data.recentEpisodes.map(ep => `
            <div class="toon-card" onclick="navigateTo('${ep.link}')">
              <div class="toon-card-poster">
                <span class="toon-badge-ep">${ep.epNum}</span>
                <img src="${ep.img}" alt="${escapeHtml(ep.title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
              </div>
              <div class="toon-card-info">
                <div class="toon-card-title">${escapeHtml(ep.title)}</div>
                <div class="toon-card-meta">
                  <span><i class="fas fa-play"></i> Watch Episode</span>
                  <span>Multi-Server</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // 3. Popular Series & Cartoons
    if (data.seriesList && data.seriesList.length > 0) {
      html += `
        <div class="toons-section-title">
          <i class="fas fa-tv"></i>
          <span>Popular Series & Cartoons</span>
          <span class="toons-section-badge">SERIES</span>
        </div>
        <div class="toons-grid">
          ${data.seriesList.map(item => `
            <div class="toon-card" onclick="navigateTo('${item.link}')">
              <div class="toon-card-poster">
                <span class="toon-badge-rating"><i class="fas fa-star"></i> ${item.vote}</span>
                <img src="${item.img}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
              </div>
              <div class="toon-card-info">
                <div class="toon-card-title">${escapeHtml(item.title)}</div>
                <div class="toon-card-meta">
                  <span>Series</span>
                  <span>Multi-Ep</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // 4. Animated Movies
    if (data.moviesList && data.moviesList.length > 0) {
      html += `
        <div class="toons-section-title">
          <i class="fas fa-film"></i>
          <span>Animated Theatrical Movies</span>
          <span class="toons-section-badge">MOVIES</span>
        </div>
        <div class="toons-grid">
          ${data.moviesList.map(item => `
            <div class="toon-card" onclick="navigateTo('${item.link}')">
              <div class="toon-card-poster">
                <span class="toon-badge-rating"><i class="fas fa-star"></i> ${item.vote}</span>
                <img src="${item.img}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
              </div>
              <div class="toon-card-info">
                <div class="toon-card-title">${escapeHtml(item.title)}</div>
                <div class="toon-card-meta">
                  <span>Full Movie</span>
                  <span>HD</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = html;
  } catch (err) {
    const container = document.getElementById('toons-content');
    if (container) {
      container.innerHTML = `
        <div class="empty-state" style="padding:40px;">
          <i class="fas fa-exclamation-triangle" style="color:#ef4444; font-size:2rem;"></i>
          <h3>Unable to load Vault Toons</h3>
          <p>Please check back in a few moments.</p>
          <button class="btn btn-primary" onclick="renderToonsPage()">Retry</button>
        </div>
      `;
    }
  }
}

// 2. Render Toon Series Detail & Episode List
async function renderToonSeriesPage(slug) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="toons-hub">
      <div style="padding:60px 20px; text-align:center;"><div class="spinner"></div><p style="color:#38bdf8; margin-top:14px; font-weight:600;">Loading Series & Episode Catalog...</p></div>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/api/toons/series/${slug}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const firstEpLink = data.episodes?.[0]?.link || `/toons/watch/${slug}`;

    app.innerHTML = `
      <div class="toons-hub">
        <div style="margin-bottom:20px;">
          <button class="btn btn-ghost" onclick="navigateTo('/toons')"><i class="fas fa-arrow-left"></i> Back to Vault Toons</button>
        </div>

        <div class="toon-detail-header">
          <div class="toon-detail-poster-wrap">
            <img src="${data.poster || '/images/placeholder.svg'}" alt="${escapeHtml(data.title)}" onerror="this.src='/images/placeholder.svg'">
          </div>
          <div class="toon-detail-info">
            <span class="toons-section-badge" style="display:inline-block; margin-bottom:8px;">VAULT TOONS</span>
            <h1 class="toon-detail-title">${escapeHtml(data.title)}</h1>
            <div class="toon-detail-meta">
              <span><i class="fas fa-star" style="color:#fbbf24;"></i> ${data.rating || '8.8'} TMDB</span>
              <span><i class="fas fa-layer-group" style="color:#38bdf8;"></i> ${data.episodesCount} Episodes Uploaded</span>
              <span style="color:#38bdf8; font-weight:700;"><i class="fas fa-language"></i> Hindi & Multi-Audio</span>
              <span><i class="fas fa-closed-captioning"></i> English Subs</span>
            </div>
            <p class="toon-detail-synopsis">${escapeHtml(data.synopsis || 'Full series and episodes available for instant streaming with zero ads and high-speed servers.')}</p>
            <div style="margin-top:auto; display:flex; gap:12px; flex-wrap:wrap;">
              <button class="btn btn-primary" onclick="navigateTo('${firstEpLink}')">
                <i class="fas fa-play"></i> Watch Episode 1
              </button>
              <button class="btn btn-secondary" onclick="navigateTo('/toons')">
                <i class="fas fa-compass"></i> Explore All Toons
              </button>
            </div>
          </div>
        </div>

        <div class="toons-section-title">
          <i class="fas fa-photo-film"></i>
          <span>Episodes (${data.episodesCount})</span>
          <span class="toons-section-badge">100% THUMBNAILS</span>
        </div>

        <div class="toon-episodes-grid">
          ${data.episodes.map((ep, idx) => {
            const thumbUrl = ep.thumbnail || data.poster || '/images/placeholder.svg';
            const epBadge = ep.epNum || `EP ${ep.episode_no || idx + 1}`;
            const epTitle = ep.title || `Episode ${ep.episode_no || idx + 1}`;
            return `
              <div class="toon-ep-card" onclick="navigateTo('${ep.link}')">
                <div class="toon-ep-thumb">
                  <span class="toon-ep-badge">${escapeHtml(epBadge)}</span>
                  <img src="${thumbUrl}" alt="${escapeHtml(epTitle)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
                  <div class="toon-ep-play">
                    <i class="fas fa-circle-play"></i>
                  </div>
                </div>
                <div class="toon-ep-info">
                  <div class="toon-ep-title" title="${escapeHtml(epTitle)}">${escapeHtml(epTitle)}</div>
                  <div class="toon-ep-meta">
                    <span><i class="fas fa-volume-high" style="color:#38bdf8;"></i> Hindi Audio</span>
                    <span>1080p HD</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    app.innerHTML = `
      <div class="empty-state" style="padding:60px;">
        <i class="fas fa-exclamation-triangle" style="color:#ef4444; font-size:2rem;"></i>
        <h3>Series Not Found</h3>
        <p>${err.message}</p>
        <button class="btn btn-primary" onclick="navigateTo('/toons')">Back to Vault Toons</button>
      </div>
    `;
  }
}

// 3. Render Toon Watch Cinema Player
async function renderToonWatchPage(slug) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="toon-watch-theater">
      <div style="padding:60px; text-align:center;"><div class="spinner"></div><p style="color:#38bdf8; margin-top:12px;">Loading Stream Player & Mirrors...</p></div>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/api/toons/episode/${slug}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success || !data.servers || data.servers.length === 0) {
      throw new Error('No active video servers found for this episode.');
    }

    const defaultServer = data.defaultServer || data.servers[0];

    app.innerHTML = `
      <div class="toon-watch-theater">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <button class="btn btn-ghost" onclick="navigateTo('/toons')"><i class="fas fa-arrow-left"></i> Vault Toons</button>
          <span style="color:#38bdf8; font-weight:700; font-size:0.85rem;"><i class="fas fa-shield-alt"></i> Zero-Ad Protected Player</span>
        </div>

        <h1 style="font-size:1.4rem; font-weight:800; color:#fff; margin-bottom:16px;">
          ${escapeHtml(data.title || slug.replace(/-/g, ' '))}
        </h1>

        <!-- 16:9 Responsive Cinema Player -->
        <div class="toon-player-container">
          <iframe 
            id="toon-active-frame"
            src="${defaultServer.url}"
            class="toon-player-frame"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowfullscreen
            referrerpolicy="no-referrer">
          </iframe>
        </div>

        <!-- Server Switcher Bar -->
        <div class="toon-server-bar">
          <div class="toon-server-label"><i class="fas fa-server"></i> Fast Servers:</div>
          ${data.servers.map((server, i) => `
            <button class="toon-server-pill ${i === 0 ? 'active' : ''}" onclick="switchActiveToonServer('${server.url}', this)">
              <i class="fas fa-play" style="font-size:0.65rem; margin-right:4px;"></i> ${escapeHtml(server.name)}
            </button>
          `).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; padding:16px 20px; background:rgba(255,255,255,0.04); border-radius:var(--radius);">
          <div>
            <h4 style="font-size:0.95rem; font-weight:700; color:#fff;">Trouble Playing?</h4>
            <p style="font-size:0.8rem; color:rgba(255,255,255,0.6);">Switch between RubyStream, FilesForever, or VidMoly for instant 1080p playback.</p>
          </div>
          <button class="btn btn-primary" onclick="navigateTo('/toons')">Explore More Shows</button>
        </div>

        <!-- Series Episode Grid with Thumbnails -->
        <div id="toon-watch-siblings-container" style="margin-top:36px;">
          <div class="toons-section-title">
            <i class="fas fa-photo-film"></i>
            <span>All Episodes in this Series</span>
            <span class="toons-section-badge">NOW STREAMING</span>
          </div>
          <div class="toon-episodes-grid" id="toon-watch-episodes-grid">
            <div style="padding:20px; color:var(--text-muted);"><div class="spinner"></div> Loading episodes...</div>
          </div>
        </div>
      </div>
    `;

    // Asynchronously populate sibling episodes with thumbnails
    const seriesSlug = data.seriesSlug || slug.replace(/-\d+x\d+$/, '');
    if (seriesSlug) {
      fetch(`${API_BASE}/api/toons/series/${seriesSlug}`, { credentials: 'include' })
        .then(r => r.json())
        .then(seriesData => {
          const grid = document.getElementById('toon-watch-episodes-grid');
          if (grid && seriesData.success && seriesData.episodes?.length) {
            grid.innerHTML = seriesData.episodes.map((ep, idx) => {
              const isCurrent = ep.slug === slug || ep.link.includes(slug);
              const thumbUrl = ep.thumbnail || seriesData.poster || '/images/placeholder.svg';
              const epBadge = ep.epNum || `EP ${ep.episode_no || idx + 1}`;
              const epTitle = ep.title || `Episode ${ep.episode_no || idx + 1}`;
              return `
                <div class="toon-ep-card ${isCurrent ? 'active' : ''}" onclick="navigateTo('${ep.link}')">
                  <div class="toon-ep-thumb">
                    <span class="toon-ep-badge">${escapeHtml(epBadge)}</span>
                    <img src="${thumbUrl}" alt="${escapeHtml(epTitle)}" loading="lazy" onerror="this.src='/images/placeholder.svg'">
                    <div class="toon-ep-play">
                      <i class="fas fa-circle-play"></i>
                    </div>
                  </div>
                  <div class="toon-ep-info">
                    <div class="toon-ep-title" title="${escapeHtml(epTitle)}">${escapeHtml(epTitle)}</div>
                    <div class="toon-ep-meta">
                      ${isCurrent ? '<span class="toon-ep-now-playing"><i class="fas fa-circle-dot fa-fade"></i> NOW PLAYING</span>' : '<span><i class="fas fa-play" style="font-size:0.65rem;"></i> Play</span>'}
                      <span>1080p HD</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('');
          } else if (grid) {
            document.getElementById('toon-watch-siblings-container')?.remove();
          }
        })
        .catch(() => {
          document.getElementById('toon-watch-siblings-container')?.remove();
        });
    }

    // Save to watched set
    try {
      const watched = JSON.parse(localStorage.getItem('anime_vault_watched_toons') || '[]');
      if (!watched.includes(slug)) {
        watched.push(slug);
        localStorage.setItem('anime_vault_watched_toons', JSON.stringify(watched));
      }
    } catch(e) {}

  } catch (err) {
    app.innerHTML = `
      <div class="empty-state" style="padding:60px;">
        <i class="fas fa-exclamation-triangle" style="color:#ef4444; font-size:2rem;"></i>
        <h3>Stream Unavailable</h3>
        <p>${err.message}</p>
        <button class="btn btn-primary" onclick="navigateTo('/toons')">Return to Vault Toons</button>
      </div>
    `;
  }
}

// Server Switcher Callback
window.switchActiveToonServer = function(url, btn) {
  const frame = document.getElementById('toon-active-frame');
  if (frame) {
    frame.src = url;
  }
  document.querySelectorAll('.toon-server-pill').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
};

// ===== AnimeSuge Airing Schedule Drawer Controller =====
let scheduleClockInterval = null;
let scheduleDataCache = null;

function formatScheduleTime(epochSec) {
  const d = new Date(epochSec * 1000);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getLocalTimezoneString() {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const hours = Math.floor(Math.abs(offsetMin) / 60);
  const mins = Math.abs(offsetMin) % 60;
  return `GMT${sign}${hours}${mins > 0 ? '.' + Math.round((mins / 60) * 10) : ''}`;
}

function updateScheduleClock() {
  const timeEl = document.getElementById('schedule-clock-time');
  const tzEl = document.getElementById('schedule-clock-tz');
  if (!timeEl) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  timeEl.textContent = `${h}:${m}:${s}`;
  if (tzEl) tzEl.textContent = getLocalTimezoneString();
}

async function fetchAndRenderSchedule() {
  const contentEl = document.getElementById('schedule-drawer-content');
  if (!contentEl) return;

  if (!scheduleDataCache) {
    try {
      const res = await api('/anime/schedule');
      if (res && res.success && Array.isArray(res.data)) {
        scheduleDataCache = res.data;
      }
    } catch (e) {
      console.warn('Failed to load schedule from API:', e);
    }
  }

  const items = scheduleDataCache || [];
  if (items.length === 0) {
    contentEl.innerHTML = `
      <div style="padding: 40px 10px; text-align: center; color: #64748b;">
        <i class="fa-regular fa-calendar-xmark" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
        <p>No airing schedule data available at the moment.</p>
      </div>
    `;
    return;
  }

  // Group items by day
  const daysMap = new Map();
  const todayDateStr = new Date().toDateString();

  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

  items.forEach(item => {
    const d = new Date(item.airingAt * 1000);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!daysMap.has(key)) {
      const dayNum = d.getDate();
      const monthStr = monthNames[d.getMonth()];
      const dayName = dayNames[d.getDay()];
      const isToday = d.toDateString() === todayDateStr;
      daysMap.set(key, {
        dateStr: `${dayNum} ${monthStr}`,
        dayName,
        isToday,
        items: []
      });
    }
    daysMap.get(key).items.push(item);
  });

  let html = '';
  daysMap.forEach((group) => {
    html += `
      <div class="schedule-day-group ${group.isToday ? 'is-today' : ''}">
        <div class="schedule-day-header">
          <div class="schedule-day-date">${group.dateStr}</div>
          <div class="schedule-day-name">${group.dayName}</div>
        </div>
        <div class="schedule-day-items">
          ${group.items.map(item => {
            const timeStr = formatScheduleTime(item.airingAt);
            const targetUrl = item.slug ? `/anime/${item.slug}` : `/browse?search=${encodeURIComponent(item.title)}`;
            return `
              <div class="schedule-item-row" onclick="navigateTo('${targetUrl}'); toggleScheduleDrawer(false);" title="${escapeHtml(item.title)} Ep - ${item.episode}">
                <span class="schedule-item-time">${timeStr}</span>
                <span class="schedule-item-title">${escapeHtml(item.title)} Ep - ${item.episode}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  contentEl.innerHTML = html;
}

window.toggleScheduleDrawer = function(forceOpen) {
  const drawer = document.getElementById('schedule-drawer');
  const backdrop = document.getElementById('schedule-backdrop');
  if (!drawer || !backdrop) return;

  const isOpen = drawer.classList.contains('open');
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;

  if (shouldOpen) {
    drawer.classList.add('open');
    backdrop.classList.add('open');
    updateScheduleClock();
    if (!scheduleClockInterval) {
      scheduleClockInterval = setInterval(updateScheduleClock, 1000);
    }
    fetchAndRenderSchedule();
  } else {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    if (scheduleClockInterval) {
      clearInterval(scheduleClockInterval);
      scheduleClockInterval = null;
    }
  }
};

// Next Episode Countdown Timer Controller (Watch Page)
function startPredictionCountdown(ep) {
  const dateEl = document.getElementById('pred-target-date');
  const countEl = document.getElementById('pred-target-countdown');
  if (!dateEl || !countEl || !ep) return;

  // Predict next drop: default next weekly release cycle (e.g. Next Sunday 09:30 AM GMT for One Piece)
  const now = new Date();
  const targetDate = new Date();
  
  if (ep.anime_slug === 'one-piece') {
    // Airs every Sunday morning (JST / GMT)
    targetDate.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
    targetDate.setHours(9, 30, 0, 0);
  } else {
    // Weekly +7 days from last known episode release or upcoming weekend
    targetDate.setDate(now.getDate() + 6);
    targetDate.setHours(18, 0, 0, 0);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${targetDate.getFullYear()}/${pad(targetDate.getMonth() + 1)}/${pad(targetDate.getDate())} 09:30 AM GMT`;
  dateEl.textContent = dateStr;

  function update() {
    const diff = Math.max(0, Math.floor((targetDate.getTime() - Date.now()) / 1000));
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (countEl) {
      countEl.textContent = `${d} days, ${h} hours, ${m} minutes, ${s} seconds`;
    }
  }
  update();

  if (window._predCountdownInterval) clearInterval(window._predCountdownInterval);
  window._predCountdownInterval = setInterval(update, 1000);
}
