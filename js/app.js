/* CapCut Studio â€” web video editor (client-side) */
const $ = (id) => document.getElementById(String(id).replace(/^#/, ''));

// ---------- State ----------
const state = {
  media: [],        // {id, type, name, url, duration, el (video/audio/img)}
  clips: [],        // {id, mediaId, track, start, duration, trimStart, speed, volume, filter}
  texts: [],        // {id, text, start, duration, x, y, size, color}
  stickers: [],     // {id, emoji, start, duration, x, y, size}
  selected: null,   // {type:'clip'|'text'|'sticker', id}
  playhead: 0,
  playing: false,
  zoom: 40,         // px per second
  filter: 'none',
  filterIntensity: 1,
  transition: 'none',
  resolution: { w: 1280, h: 720 },
  fps: 30,
  history: [],
  historyIdx: -1,
};

let rafId = null;
let lastTs = 0;
let drag = null; // {kind, id, startX, origStart, origDur, handle}

// ---------- Utils ----------
function uid() { return 'id_' + Math.random().toString(36).slice(2, 9); }
function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}
function totalDuration() {
  let d = 0;
  state.clips.forEach(c => d = Math.max(d, c.start + c.duration));
  state.texts.forEach(t => d = Math.max(d, t.start + t.duration));
  state.stickers.forEach(s => d = Math.max(d, s.start + s.duration));
  return d || 1;
}
function snapTime(t) { return Math.round(t * 10) / 10; }

// ---------- History ----------
function pushHistory() {
  const snap = JSON.stringify({ clips: state.clips, texts: state.texts, stickers: state.stickers, media: state.media.map(m=>({id:m.id,type:m.type,name:m.name,url:m.url,duration:m.duration})) });
  state.history = state.history.slice(0, state.historyIdx + 1);
  state.history.push(snap);
  state.historyIdx = state.history.length - 1;
  if (state.history.length > 50) { state.history.shift(); state.historyIdx--; }
}
function undo() {
  if (state.historyIdx <= 0) return;
  state.historyIdx--;
  restoreHistory(state.history[state.historyIdx]);
}
function redo() {
  if (state.historyIdx >= state.history.length - 1) return;
  state.historyIdx++;
  restoreHistory(state.history[state.historyIdx]);
}
function restoreHistory(snap) {
  const o = JSON.parse(snap);
  state.clips = o.clips; state.texts = o.texts; state.stickers = o.stickers;
  // media urls preserved
  renderAll();
}

// ---------- Media ----------
async function addMediaFiles(files) {
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const type = f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'image';
    const media = { id: uid(), type, name: f.name, url, duration: 0, el: null };
    if (type === 'video' || type === 'audio') {
      const el = document.createElement(type === 'video' ? 'video' : 'audio');
      el.src = url;
      el.preload = 'metadata';
      await new Promise((res) => {
        el.addEventListener('loadedmetadata', () => { media.duration = el.duration || 0; media.el = el; res(); }, { once: true });
        el.load();
      });
    } else {
      const img = new Image();
      await new Promise((res) => { img.onload = () => { media.duration = 5; media.el = img; res(); }; img.src = url; });
    }
    state.media.push(media);
  }
  renderMediaGrid();
  pushHistory();
}

function renderMediaGrid() {
  const grid = $('#mediaGrid');
  if (!grid) return;
  grid.innerHTML = '';
  state.media.forEach(m => {
    const div = document.createElement('div');
    div.className = 'media-item';
    div.innerHTML = `<div class="media-thumb">${m.type === 'video' ? '<video src="' + m.url + '" muted></video>' : m.type === 'audio' ? 'ðŸŽµ' : '<img src="' + m.url + '">'}</div><div>${m.name}</div>`;
    div.addEventListener('click', () => addClipFromMedia(m.id));
    div.addEventListener('dragstart', (e) => { e.dataTransfer.setData('mediaId', m.id); });
    div.draggable = true;
    grid.appendChild(div);
  });
  $('#mediaEmpty').style.display = state.media.length ? 'none' : 'block';
}

function addClipFromMedia(mediaId, track) {
  const m = state.media.find(x => x.id === mediaId);
  if (!m) return;
  const tr = track || (m.type === 'audio' ? 'audio' : 'video');
  const clip = {
    id: uid(), mediaId, track: tr,
    start: 0, duration: m.duration || 5,
    trimStart: 0, speed: 1, volume: 1, filter: state.filter,
  };
  // place after last clip on track
  const last = state.clips.filter(c => c.track === tr).sort((a,b)=>a.start-b.start).pop();
  if (last) clip.start = last.start + last.duration;
  state.clips.push(clip);
  renderTimeline();
  pushHistory();
}

// ---------- Timeline rendering ----------
function renderTimeline() {
  const ruler = $('#ruler');
  if (!ruler) return;
  const zoom = state.zoom;
  const dur = totalDuration();
  ruler.innerHTML = '';
  ruler.style.width = (dur * zoom + 200) + 'px';
  const step = zoom >= 60 ? 1 : zoom >= 30 ? 2 : 5;
  for (let t = 0; t <= dur + step; t += step) {
    const tick = document.createElement('div');
    tick.style.position = 'absolute';
    tick.style.left = (t * zoom) + 'px';
    tick.style.top = '0';
    tick.style.height = '100%';
    tick.style.borderLeft = '1px solid #333';
    tick.style.fontSize = '9px';
    tick.style.color = 'var(--muted)';
    tick.style.paddingLeft = '3px';
    tick.textContent = fmtTime(t).slice(0,5);
    ruler.appendChild(tick);
  }
  // tracks
  ['video','audio','text','sticker'].forEach(tr => {
    const body = $('#track-' + tr);
    body.innerHTML = '';
    body.style.width = (dur * zoom + 200) + 'px';
    // clips
    const items = tr === 'video' || tr === 'audio'
      ? state.clips.filter(c => c.track === tr)
      : tr === 'text' ? state.texts.map(t => ({...t, _type:'text'}))
      : state.stickers.map(s => ({...s, _type:'sticker'}));
    items.forEach(it => {
      const div = document.createElement('div');
      const typeClass = it._type || it.track;
      div.className = 'clip ' + (it._type ? it._type : it.track);
      div.dataset.id = it.id;
      div.dataset.kind = it._type ? it._type : 'clip';
      div.style.left = (it.start * zoom) + 'px';
      div.style.width = Math.max(20, it.duration * zoom) + 'px';
      div.textContent = it._type === 'text' ? it.text : it._type === 'sticker' ? it.emoji : (state.media.find(m=>m.id===it.mediaId)?.name || 'clip');
      if (state.selected && state.selected.type === (it._type||'clip') && state.selected.id === it.id) div.classList.add('selected');
      // trim handles
      const lh = document.createElement('div');
      lh.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:6px;cursor:ew-resize;background:rgba(255,255,255,0.3);';
      const rh = document.createElement('div');
      rh.style.cssText = 'position:absolute;right:0;top:0;bottom:0;width:6px;cursor:ew-resize;background:rgba(255,255,255,0.3);';
      div.appendChild(lh); div.appendChild(rh);
      // events
      div.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        selectItem(it._type ? it._type : 'clip', it.id);
        const rect = div.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < 8) { drag = { kind: 'trimL', id: it.id, itemType: it._type||'clip', startX: e.clientX, origStart: it.start, origDur: it.duration, origTrim: it.trimStart||0 }; }
        else if (x > rect.width - 8) { drag = { kind: 'trimR', id: it.id, itemType: it._type||'clip', startX: e.clientX, origStart: it.start, origDur: it.duration }; }
        else { drag = { kind: 'move', id: it.id, itemType: it._type||'clip', startX: e.clientX, origStart: it.start }; }
      });
      body.appendChild(div);
    });
  });
  // playhead
  const ph = $('#playhead');
  ph.style.left = (70 + state.playhead * zoom) + 'px';
  // time label
  $('#timeLabel').textContent = fmtTime(state.playhead) + ' / ' + fmtTime(totalDuration());
  // canvas size
  applyResolution();
}

function selectItem(type, id) {
  state.selected = { type, id };
  renderTimeline();
  updateProps();
}

function updateProps() {
  $('#propsEmpty').style.display = state.selected ? 'none' : 'block';
  $('#propsVideo').style.display = 'none';
  $('#propsText').style.display = 'none';
  $('#propsSticker').style.display = 'none';
  if (!state.selected) return;
  const { type, id } = state.selected;
  if (type === 'clip') {
    const c = state.clips.find(x => x.id === id);
    if (!c) return;
    $('#propsVideo').style.display = 'block';
    $('#propSpeed').value = c.speed;
    $('#propVol').value = c.volume;
    $('#propStart').value = c.start.toFixed(2);
    $('#propDur').value = c.duration.toFixed(2);
    $('#propTrimIn').value = (c.trimStart || 0).toFixed(2);
    $('#propTrimOut').value = ((c.trimStart || 0) + c.duration).toFixed(2);
  } else if (type === 'text') {
    const t = state.texts.find(x => x.id === id);
    if (!t) return;
    $('#propsText').style.display = 'block';
    $('#propText').value = t.text;
    $('#propTextSize').value = t.size;
    $('#propTextColor').value = t.color;
    $('#propTextX').value = t.x;
    $('#propTextY').value = t.y;
    $('#propTextStart').value = t.start.toFixed(2);
    $('#propTextDur').value = t.duration.toFixed(2);
  } else if (type === 'sticker') {
    const s = state.stickers.find(x => x.id === id);
    if (!s) return;
    $('#propsSticker').style.display = 'block';
    $('#propStickerEmoji').value = s.emoji;
    $('#propStickerSize').value = s.size;
    $('#propStickerX').value = s.x;
    $('#propStickerY').value = s.y;
    $('#propStickerStart').value = s.start.toFixed(2);
    $('#propStickerDur').value = s.duration.toFixed(2);
  }
}

// ---------- Drag handling ----------
document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const zoom = state.zoom;
  const dx = (e.clientX - drag.startX) / zoom;
  if (Math.abs(dx) > 0.05) drag.moved = true;
  const item = findItem(drag.itemType, drag.id);
  if (!item) return;
  if (drag.kind === 'move') {
    item.start = Math.max(0, snapTime(drag.origStart + dx));
  } else if (drag.kind === 'trimL') {
    const newStart = Math.max(0, snapTime(drag.origStart + dx));
    const delta = newStart - drag.origStart;
    item.start = newStart;
    item.duration = Math.max(0.1, drag.origDur - delta);
    if (item.trimStart !== undefined) item.trimStart = Math.max(0, (item.trimStart||0) + delta);
  } else if (drag.kind === 'trimR') {
    item.duration = Math.max(0.1, snapTime(drag.origDur + dx));
  }
  renderTimeline();
});
document.addEventListener('mouseup', () => {
  if (drag) { const moved = drag.moved; drag = null; if (moved) { pushHistory(); renderAll(); } }
});

function findItem(type, id) {
  if (type === 'clip') return state.clips.find(x => x.id === id);
  if (type === 'text') return state.texts.find(x => x.id === id);
  if (type === 'sticker') return state.stickers.find(x => x.id === id);
  return null;
}

// ---------- Playback ----------
function play() {
  if (state.playing) return;
  state.playing = true;
  lastTs = performance.now();
  $('#btnPlay').textContent = 'â¸ Pause';
  rafId = requestAnimationFrame(tick);
}
function pause() {
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  $('#btnPlay').textContent = 'â–¶ Play';
}
function tick(now) {
  if (!state.playing) return;
  const dt = (now - lastTs) / 1000;
  lastTs = now;
  state.playhead += dt;
  const dur = totalDuration();
  if (state.playhead >= dur) { state.playhead = dur; pause(); }
  renderFrame();
  renderTimeline();
  rafId = requestAnimationFrame(tick);
}

// ---------- Preview rendering ----------
const canvas = $('#previewCanvas');
const ctx = canvas.getContext('2d');

function applyResolution() {
  const [w,h] = $('#projRes').value.split('x').map(Number);
  if (w !== state.resolution.w || h !== state.resolution.h) {
    state.resolution = { w, h };
    canvas.width = w; canvas.height = h;
  }
}

function getFilterCSS(f, intensity) {
  const i = intensity;
  switch (f) {
    case 'grayscale': return `grayscale(${i})`;
    case 'sepia': return `sepia(${i})`;
    case 'vintage': return `sepia(${0.4*i}) contrast(${1+0.2*i}) saturate(${1-0.3*i})`;
    case 'warm': return `saturate(${1+0.3*i}) hue-rotate(${-10*i}deg)`;
    case 'cool': return `saturate(${1+0.2*i}) hue-rotate(${10*i}deg)`;
    case 'contrast': return `contrast(${1+0.6*i})`;
    case 'bright': return `brightness(${1+0.4*i})`;
    case 'blur': return `blur(${4*i}px)`;
    case 'cinematic': return `contrast(${1+0.25*i}) saturate(${1+0.15*i}) brightness(${0.95})`;
    default: return 'none';
  }
}

function renderFrame() {
  const { w, h } = state.resolution;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const t = state.playhead;
  // find active video clip
  const activeClip = state.clips
    .filter(c => c.track === 'video' && t >= c.start && t < c.start + c.duration)
    .sort((a,b) => b.start - a.start)[0];
  if (activeClip) {
    const m = state.media.find(x => x.id === activeClip.mediaId);
    const el = m?.el;
    if (el && el.tagName === 'VIDEO') {
      // sync
      const localT = activeClip.trimStart + (t - activeClip.start) * activeClip.speed;
      if (Math.abs(el.currentTime - localT) > 0.2) el.currentTime = localT;
      // filter
      ctx.save();
      ctx.filter = getFilterCSS(activeClip.filter || state.filter, state.filterIntensity);
      // draw scaled to cover
      const vw = el.videoWidth, vh = el.videoHeight;
      if (!vw || !vh) { ctx.restore(); } else {
        const scale = Math.max(w / vw, h / vh);
        const dw = vw * scale, dh = vh * scale;
        const dx = (w - dw) / 2, dy = (h - dh) / 2;
        try { ctx.drawImage(el, dx, dy, dw, dh); } catch (e) {}
        ctx.restore();
      }
    } else if (el && el.tagName === 'IMG') {
      ctx.drawImage(el, 0, 0, w, h);
    }
  }

  // texts
  state.texts.forEach(txt => {
    if (t < txt.start || t >= txt.start + txt.duration) return;
    ctx.save();
    ctx.font = `bold ${txt.size}px sans-serif`;
    ctx.fillStyle = txt.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    // wrap simple
    const lines = txt.text.split('\n');
    lines.forEach((ln, i) => {
      ctx.fillText(ln, txt.x, txt.y + i * (txt.size + 4));
    });
    ctx.restore();
  });

  // stickers
  state.stickers.forEach(st => {
    if (t < st.start || t >= st.start + st.duration) return;
    ctx.save();
    ctx.font = `${st.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.emoji, st.x, st.y);
    ctx.restore();
  });

  // playhead overlay? no
}

// ---------- Click on canvas to position selected overlay ----------
canvas.addEventListener('mousedown', (e) => {
  if (!state.selected) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  if (state.selected.type === 'text') {
    const t = state.texts.find(x=>x.id===state.selected.id);
    if (t) { t.x = Math.round(x); t.y = Math.round(y); updateProps(); renderTimeline(); }
  } else if (state.selected.type === 'sticker') {
    const s = state.stickers.find(x=>x.id===state.selected.id);
    if (s) { s.x = Math.round(x); s.y = Math.round(y); updateProps(); renderTimeline(); }
  }
});

// ---------- Properties wiring ----------
function wireProps() {
  // video
  $('#propSpeed').addEventListener('input', e => { const c = state.clips.find(x=>x.id===state.selected?.id); if(c){c.speed=+e.target.value; pushHistory();} });
  $('#propVol').addEventListener('input', e => { const c = state.clips.find(x=>x.id===state.selected?.id); if(c){c.volume=+e.target.value; pushHistory();} });
  $('#propStart').addEventListener('change', e => { const c = state.clips.find(x=>x.id===state.selected?.id); if(c){c.start=+e.target.value; renderTimeline(); pushHistory();} });
  $('#propDur').addEventListener('change', e => { const c = state.clips.find(x=>x.id===state.selected?.id); if(c){c.duration=+e.target.value; renderTimeline(); pushHistory();} });
  $('#btnApplyTrim').addEventListener('click', () => {
    const c = state.clips.find(x=>x.id===state.selected?.id);
    if (!c) return;
    const m = state.media.find(x=>x.id===c.mediaId);
    const maxDur = (m && m.duration) ? m.duration : (c.trimStart + c.duration + 10);
    let inT = +$('#propTrimIn').value;
    let outT = +$('#propTrimOut').value;
    if (!isFinite(inT) || inT < 0) inT = 0;
    if (!isFinite(outT) || outT <= inT) outT = inT + 0.1;
    if (outT > maxDur) outT = maxDur;
    c.trimStart = inT;
    c.duration = Math.max(0.1, outT - inT);
    $('#propDur').value = c.duration.toFixed(2);
    $('#propTrimIn').value = c.trimStart.toFixed(2);
    $('#propTrimOut').value = (c.trimStart + c.duration).toFixed(2);
    renderTimeline();
    pushHistory();
    renderFrame();
  });
  // text
  $('#propText').addEventListener('input', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.text=e.target.value; renderTimeline();} });
  $('#propTextSize').addEventListener('input', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.size=+e.target.value; pushHistory();} });
  $('#propTextColor').addEventListener('input', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.color=e.target.value; pushHistory();} });
  $('#propTextX').addEventListener('input', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.x=+e.target.value; pushHistory();} });
  $('#propTextY').addEventListener('input', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.y=+e.target.value; pushHistory();} });
  $('#propTextStart').addEventListener('change', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.start=+e.target.value; renderTimeline(); pushHistory();} });
  $('#propTextDur').addEventListener('change', e => { const t = state.texts.find(x=>x.id===state.selected?.id); if(t){t.duration=+e.target.value; renderTimeline(); pushHistory();} });
  // sticker
  $('#propStickerEmoji').addEventListener('input', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.emoji=e.target.value; renderTimeline();} });
  $('#propStickerSize').addEventListener('input', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.size=+e.target.value; pushHistory();} });
  $('#propStickerX').addEventListener('input', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.x=+e.target.value; pushHistory();} });
  $('#propStickerY').addEventListener('input', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.y=+e.target.value; pushHistory();} });
  $('#propStickerStart').addEventListener('change', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.start=+e.target.value; renderTimeline(); pushHistory();} });
  $('#propStickerDur').addEventListener('change', e => { const s = state.stickers.find(x=>x.id===state.selected?.id); if(s){s.duration=+e.target.value; renderTimeline(); pushHistory();} });
}
// wireProps(); // editor removed

// ---------- YouTube downloader (simple: url + start/end timestamps) ----------
let ytJobId = null;
let ytFileUrl = null;
let ytFileName = null;

$('#btnYtDownload').addEventListener('click', async () => {
  const url = $('#ytUrl').value.trim();
  if (!url) return alert('Paste a YouTube URL');
  const mode = $('#ytMode').value;
  const quality = $('#ytQuality').value;
  const start = $('#ytStart').value.trim();
  const end = $('#ytEnd').value.trim();
  $('#btnYtDownload').disabled = true;
  $('#ytStatusWrap').classList.add('loading');
  $('#ytStatus').textContent = 'Starting download...';
  $('#ytResult').classList.remove('show');
  $('#ytProgressWrap').style.display = 'block';
  $('#ytProgressFill').style.width = '0%';
  $('#ytProgressText').textContent = '0%';
  try {
    const res = await fetch('/api/yt/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, mode, quality, start, end }) });
    const data = await res.json();
    if (data.error) { alert('❌ ' + data.error); return; }
    ytJobId = data.job_id;
    while (true) {
      await new Promise(r => setTimeout(r, 500));
      const s = await fetch('/api/yt/status/' + ytJobId);
      const st = await s.json();
      const pct = st.progress || 0;
      $('#ytProgressFill').style.width = pct + '%';
      $('#ytProgressText').textContent = pct + '%';
      $('#ytStatus').textContent = 'Status: ' + st.status + ' (' + pct + '%)';
      if (st.status === 'done') {
        ytFileUrl = st.url;
        ytFileName = st.file;
        $('#ytStatus').textContent = 'Done: ' + (st.title || st.file);
        $('#ytDownloadLink').href = st.url;
        $('#ytDownloadLink').download = st.file;
        $('#ytProgressFill').style.width = '100%';
        $('#ytProgressText').textContent = '100%';
        $('#ytResult').classList.add('show');
        break;
      }
      if (st.status === 'error') {
        $('#ytProgressWrap').style.display = 'none';
        alert('❌ ' + (st.error || 'Download failed'));
        break;
      }
    }
  } catch (e) { alert('❌ ' + e); }
  finally { $('#btnYtDownload').disabled = false; $('#ytStatusWrap').classList.remove('loading'); }
});

// ---------- Render all ----------
function renderAll() {
  renderMediaGrid();
  renderTimeline();
  renderFrame();
}
renderAll();
pushHistory();
// ---------- Transcript extractor ----------
$('#btnTrExtract').addEventListener('click', async () => {
  const url = $('#trUrl').value.trim();
  if (!url) return alert('Paste a YouTube URL');
  const lang = $('#trLang').value;
  $('#btnTrExtract').disabled = true;
  $('#trStatusWrap').classList.add('loading');
  $('#trStatus').textContent = 'Extracting transcript...';
  $('#trResult').classList.remove('show');
  try {
    const res = await fetch('/api/yt/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, lang })
    });
    const data = await res.json();
    if (data.error) { alert('❌ ' + data.error); return; }
    $('#trTitle').textContent = data.title || 'Transcript';
    $('#trText').value = data.transcript || '';
    $('#trResult').classList.add('show');
    $('#trStatus').textContent = 'Extracted ✔ (' + (data.transcript || '').split('\n').length + ' lines)';
  } catch (e) { alert('❌ ' + e); }
  finally { $('#btnTrExtract').disabled = false; $('#trStatusWrap').classList.remove('loading'); }
});

$('#btnTrCopy').addEventListener('click', () => {
  const ta = $('#trText');
  ta.select();
  document.execCommand('copy');
  $('#trStatus').textContent = 'Copied to clipboard ✔';
});

$('#btnTrDownload').addEventListener('click', () => {
  const text = $('#trText').value;
  if (!text) return;
  const title = ($('#trTitle').textContent || 'transcript').trim() || 'transcript';
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe + '.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// start render loop for video elements
setInterval(() => { if (!state.playing) renderFrame(); }, 200);
