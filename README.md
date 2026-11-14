# ⛩️ AnimeVault — Frontend

[![Live Demo](https://img.shields.io/badge/Demo-AnimeVault-emerald?style=for-the-badge&logo=vercel)](https://offanime.cc)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow?style=for-the-badge&logo=javascript)](https://developer.mozilla.org)
[![CSS3](https://img.shields.io/badge/CSS3-Modern_Grid-purple?style=for-the-badge&logo=css3)](https://www.w3.org/Style/CSS/)

AnimeVault is a modern, ultra-responsive anime, 4K movie & Indian cartoons streaming platform frontend featuring an **OffAnime-inspired symmetrical UI**, floating capsule navbar, AniSurge-style episode greyout shading, and multi-server streaming controls.

---

## ✨ Key Features

- **🏯 Symmetrical OffAnime UI**: 100% pixel-perfect responsive container alignment (`max-width: 1440px`) across all sections.
- **🛸 Floating Capsule Navbar**: 3-zone balanced capsule layout (`Home`, `Anime`, `Movies`, `Vault Toons`, `Hindi Dub`) with zero overlap.
- **✨ Vault Toons Hub**: Dedicated section for Hindi Dubbed Anime & Indian Cartoons (Doraemon, Shinchan, Dragon Ball Super, Naruto Shippuden Hindi) with 10+ fast video mirrors.
- **🎬 Netflix-style TOP 10 Rail**: Giant 170px outlined rank numbers tucked behind posters with smooth horizontal glide.
- **🛡️ 100% Zero-Ad & Anti-Nudity Shield**: Strict client-side interception blocking unauthorized popups and adult redirect URLs.
- **🔥 Animated AI Companion Mascot**: Interactive floating desktop-pet companion (`Fireball`, `Sparky`, `Kitsune`) providing smart anime recommendations.
- **👁️ AniSurge-Style Watched Shading**: Automatically shades watched episodes in dimmed grey and remembers exact resume positions.

---

## 🛠️ Architecture

```
anime-vault-frontend/
├── index.html        # Main SPA shell & SEO metadata
├── vercel.json       # SPA routing rewrites & caching rules
├── css/
│   └── style.css     # OffAnime dark aesthetic styling
├── js/
│   ├── app.js        # Core SPA router & interactive controllers
│   └── seo.js        # Dynamic OpenGraph & structured data
└── images/           # Badges, emblems, and visual assets
```

### Backend Integration

This frontend connects to the private **AnimeVault Backend API** via dynamic API configuration:

```javascript
window.ANIME_VAULT_API_BASE = 'https://your-backend-api.onrender.com';
```

---

## 🚀 Quick Start

### 1. Clone & Run Locally

```bash
git clone https://github.com/honeyji333/anime-vault-frontend.git
cd anime-vault-frontend

# Run local preview
npx serve -s . -l 5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 2. Deploy to Vercel (1-Click)

1. Go to [Vercel](https://vercel.com).
2. Click **Add New Project** -> Import `honeyji333/anime-vault-frontend`.
3. Framework Preset: **Other** -> Click **Deploy**!

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
