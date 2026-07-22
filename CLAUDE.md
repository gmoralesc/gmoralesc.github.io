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
- **Styles** - Hand-written CSS in `styles.css`, shared by every page. Design
  tokens are CSS custom properties on `:root` / `:root.dark`. No CSS framework,
  no webfonts (system font stacks only)
- **Theming** - Light/dark switch. An inline script in each `<head>` sets
  `.dark` on `<html>` before first paint; `theme.js` wires up the control.
  Appearance derives from the `.dark` class in CSS, never from JS
- **Pages** - `index.html` (home), `books/index.html` (books page)
- **Assets** - `public/` directory for images
- **Analytics** - Google Analytics (gtag.js) embedded in each HTML file
- **`nand/`** - Self-contained project with its own styles; not part of the
  main site's design system

## Deployment

Push to `main` branch. GitHub Pages serves the site at the custom domain configured in `CNAME`.
