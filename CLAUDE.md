# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static personal website for gmoralesc.me, hosted on GitHub Pages. No build process required.

## Development

Open `index.html` directly in a browser or use any local server:
```bash
python3 -m http.server 8000
```

## Architecture

- **No build tools** - Pure HTML, no JavaScript framework
- **CSS Framework** - Tailwind CSS loaded from CDN (`cdn.tailwindcss.com`)
- **Pages** - `index.html` (home), `books/index.html` (books page)
- **Assets** - `public/` directory for images
- **Analytics** - Google Analytics (gtag.js) embedded in each HTML file

## Deployment

Push to `main` branch. GitHub Pages serves the site at the custom domain configured in `CNAME`.
