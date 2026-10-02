# ChatSketch

Chat it. Sketch it. Draw with AI on a shared board.

Type in chat, the AI draws with you on the same canvas. Pick sketch mode for freehand strokes or SVG mode for clean vectors, then export to PDF / JPG / SVG.

## What it does

- Dashboard with all your drawings, Create button asks sketch or svg, 3-dot card menu for open, rename, export, delete
- Full-screen board on a fixed 0-1000 plane (integers, origin top-left), so AI and human strokes always line up
- Bottom floating toolbar: brush, eraser, hand (pan), line, rect, circle, text, fill toggle, color, stroke width, undo / redo, clear
- Left floating Doodle chat with plan / build switch, model picker, context meter, and MCQ questions when it needs details
- Zoom with scroll (0.5x-8x), pan with hand tool, space, or middle-drag, minimap shows when zoomed
- Drawings save in your browser (localStorage), nothing uploaded unless you export
- more comiing soon







## Quick start

Needs Node 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Fill `.env.local` with your key, go to seetings and chose your provider:

```put api key 
```

You can also paste keys in the in-app Settings popup instead. Settings supports NVIDIA, OpenAI, Anthropic, Gemini, or a custom OpenAI-compatible endpoint. Keys stay in your browser and are only sent to our own `/api` routes per request.

## How it works

- Same op system for AI and human: `line`, `polyline`, `bezier`, `circle`, `rect`, `text`, plus `svg` (SVG mode only, sanitized with an allowlist)
- `POST /api/draw` validates every op with safe defaults, `GET /api/models` lists provider models and checks the key
- `lib/` holds the shared pieces: drawing store, settings store, context meter math, export to svg / jpg / pdf, svg sanitizer
- No drawing database — `ai-board-drawings-v1` and `ai-board-settings-v1` in localStorage, capped at 100 drawings

## Scripts

```bash
npm run dev    # local dev
npm run build  # production build
npm run start  # run built app
npm run lint   # eslint
```

Built with Next.js 16, React 19, Tailwind 4.
