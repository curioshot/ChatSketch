# ChatSketch

Chat it. Sketch it. Draw with AI on a shared board.

Type in chat, the AI draws with you on the same canvas. Open-source AI whiteboard with chat-to-draw, sketch + SVG modes, self-hostable with Next.js.

[![Stars](https://img.shields.io/github/stars/curioshot/ChatSketch?style=social)](https://github.com/curioshot/ChatSketch)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Build](https://github.com/curioshot/ChatSketch/actions/workflows/ci.yml/badge.svg)](https://github.com/curioshot/ChatSketch/actions)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

## Demo

<!-- Record 10s: type in chat -> AI draws -> export. Save as public/demo.gif, then uncomment below. -->
<!-- <p align="center"><img src="public/demo.gif" alt="ChatSketch demo" width="600" /></p> -->

Dashboard → open a board → ask Doodle to draw → export to PDF / JPG / SVG.

## Features

| What | How |
| ---- | --- |
| Dashboard | All drawings, Create asks sketch or svg, 3-dot menu for open, rename, export, delete |
| Board | Fixed 0-1000 plane (integers, origin top-left), AI and human strokes always line up |
| Toolbar | Brush, eraser, hand (pan), line, rect, circle, ellipse, triangle, star, arrow, text, fill toggle, color, stroke width, undo / redo, clear |
| Doodle chat | Plan / build switch, model picker, context meter, MCQ questions when it needs details |
| Zoom + pan | Scroll zooms 0.5x-8x, hand tool / space / middle-drag pans, minimap when zoomed |
| Private by default | Drawings save in your browser (localStorage), nothing uploaded unless you export |

## Quick start

Needs Node 20+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

Add your key to `.env.local` (default is NVIDIA):

```
NVIDIA_API_KEY=nvapi-xxxx
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
```

Or paste keys in the in-app Settings popup instead. Supports NVIDIA, OpenAI, Anthropic, Gemini, or a custom OpenAI-compatible endpoint. Keys stay in your browser and are only sent to our own `/api` routes per request.

## Examples

Plan mode asks questions first:

```
you: draw a login card
doodle: got it — light or dark? rounded or sharp? [mcq]
```

Build mode draws directly:

```json
{"op":"rect","tool":"brush","color":"#000000","strokeWidth":4,"fill":false,"center":[500,400],"w":320,"h":200}
{"op":"circle","tool":"brush","color":"#ff0000","strokeWidth":5,"fill":false,"center":[500,650],"r":80}
{"op":"arrow","tool":"brush","color":"#000000","strokeWidth":5,"from":[400,500],"to":[600,500]}
```

## How it works

- Same op system for AI and human: `line`, `polyline`, `bezier`, `circle`, `ellipse`, `rect`, `triangle`, `star`, `arrow`, `text`, plus `svg` (SVG mode only, sanitized with an allowlist)
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

## Contributing

Contributions welcome.

1. Fork the repo
2. Create your branch (`git checkout -b feature/my-idea`)
3. Commit (`git commit -m 'Add my idea'`)
4. Push (`git push origin feature/my-idea`)
5. Open a Pull Request

## License

MIT — see [LICENSE](./LICENSE) for details.

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=curioshot/ChatSketch&type=Date)](https://star-history.com/#curioshot/ChatSketch&Date)
