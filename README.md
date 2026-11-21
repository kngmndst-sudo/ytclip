# CapCut Studio — Web Video Editor

A CapCut-style, in-browser video editor built with HTML5 Canvas, JavaScript and CSS.
No backend required — everything runs locally in your browser.

## Run
```
cd capcut-web
python server.py
```
Open http://127.0.0.1:8099

The Flask server also powers the **YouTube downloader** tab (requires yt-dlp + ffmpeg, both installed).

## 🌐 Make it online (anyone can use, even when your laptop is OFF)

### Option 1 — Render.com (FREE, recommended)
1. Create a free account at https://render.com
2. Push this folder to a GitHub repo (or upload as zip)
3. Click "New +" → "Web Service" → connect your repo
4. Render auto-detects the `Dockerfile` and deploys
5. You get a public link like `https://ytclip.onrender.com` — share with anyone!

### Option 2 — Railway.app (FREE trial)
1. https://railway.app → "New Project" → "Deploy from GitHub"
2. Select repo → Railway builds via Dockerfile automatically
3. Get public URL under Settings → Domains

### Option 3 — Fly.io (FREE tier)
```
fly launch
fly deploy
```

### Option 4 — VPS (DigitalOcean / AWS) with Docker
```
docker build -t ytclip .
docker run -d -p 80:8099 --name ytclip ytclip
```

### Run locally
```
python server.py
```
Open http://127.0.0.1:8099

## Features
- Import video / image / audio media
- Multi-track timeline (video, audio, text, sticker)
- Play / pause / seek, zoom
- Trim clips (drag edges), move clips (drag), split at playhead, delete
- Text overlays (draggable on preview, font size, color)
- Stickers (emoji, draggable)
- Filters (grayscale, sepia, vintage, warm/cool, contrast, blur, cinematic) with intensity
- Properties panel for selected clip / text / sticker
- Undo / redo
- Export to WebM via MediaRecorder
- Resolution & FPS settings

## Notes
- Export records the preview canvas; audio is not mixed in this version.
- Best in Chromium-based browsers (Chrome / Edge).