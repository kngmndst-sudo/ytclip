import os, uuid, threading, subprocess, shutil
from flask import Flask, request, jsonify, send_file, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(BASE, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=BASE, static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024 * 1024

jobs = {}

@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")

@app.route("/<path:p>")
def static_files(p):
    return send_from_directory(BASE, p)

import re as _re2

def _to_seconds(v):
    v = (v or "").strip()
    if not v:
        return ""
    parts = v.split(":")
    try:
        if len(parts) == 3:
            return str(int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2]))
        elif len(parts) == 2:
            return str(int(parts[0]) * 60 + float(parts[1]))
    except ValueError:
        pass
    return v

def _safe_filename(name):
    # Remove invalid filesystem characters
    name = _re2.sub(r'[\\/:*?"<>|]', "_", name)
    name = name.strip().strip(".")
    if not name:
        name = "download"
    # Limit length
    if len(name) > 120:
        name = name[:120].rstrip()
    return name

def _run_download(job_id, url, mode, quality, start="", end=""):
    job = jobs[job_id]
    try:
        job["status"] = "downloading"
        # Get video title for filename
        title = ""
        try:
            tproc = subprocess.run(["yt-dlp", "--no-warnings", "--skip-download", "--print", "title", url],
                                   capture_output=True, text=True, timeout=60)
            title = tproc.stdout.strip().splitlines()[0] if tproc.stdout.strip() else ""
        except Exception:
            title = ""
        safe = _safe_filename(title) if title else job_id
        outtmpl = os.path.join(DOWNLOAD_DIR, f"{safe}.%(ext)s")
        cmd = ["yt-dlp", "--no-warnings", "--newline", "--progress", "--concurrent-fragments", "4", "--force-overwrites"]
        # timestamps (support HH:MM:SS)
        s = _to_seconds(start)
        e = _to_seconds(end)
        if s or e:
            left = s if s else "0"
            right = e if e else "inf"
            cmd += ["--download-sections", f"*{left}-{right}"]
        if mode == "audio":
            cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "192K"]
        else:
            if quality and quality != "best":
                fmt = f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<={quality}]/best"
            else:
                fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            cmd += ["-f", fmt, "--merge-output-format", "mp4"]
        cmd += ["-o", outtmpl, url]

        job["progress"] = 0
        job["status"] = "downloading"
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        err_lines = []
        for line in proc.stdout:
            line = line.strip()
            err_lines.append(line)
            # parse progress: [download]  45.0% of 10.00MiB at 1.00MiB/s ETA 00:05
            if "[download]" in line and "%" in line:
                try:
                    pct_str = line.split("%")[0].split()[-1]
                    pct = float(pct_str)
                    job["progress"] = int(pct)
                except Exception:
                    pass
            elif "Merging" in line or "Extracting" in line or "Post-processing" in line:
                job["progress"] = 99
        proc.wait(timeout=600)
        if proc.returncode != 0:
            # extract meaningful error
            err_msg = ""
            for l in reversed(err_lines):
                if "ERROR" in l or "error" in l.lower():
                    err_msg = l
                    break
            if not err_msg and err_lines:
                err_msg = err_lines[-1]
            raise RuntimeError(err_msg if err_msg else "yt-dlp failed")
        # find output file (by safe title prefix + expected extension)
        ext = ".mp3" if mode == "audio" else ".mp4"
        final = None
        for f in os.listdir(DOWNLOAD_DIR):
            if f.startswith(safe) and f.endswith(ext):
                final = os.path.join(DOWNLOAD_DIR, f)
                break
        if final is None:
            # fallback: any file with the right extension, newest first
            candidates = [f for f in os.listdir(DOWNLOAD_DIR) if f.endswith(ext)]
            if candidates:
                candidates.sort(key=lambda x: os.path.getmtime(os.path.join(DOWNLOAD_DIR, x)), reverse=True)
                final = os.path.join(DOWNLOAD_DIR, candidates[0])
        if final is None:
            raise RuntimeError("Output file not found")
        job["progress"] = 100
        job["status"] = "done"
        job["file"] = os.path.basename(final)
        job["title"] = title if title else os.path.splitext(os.path.basename(final))[0]
    except Exception as ex:
        job["status"] = "error"
        job["error"] = str(ex)

@app.route("/api/yt/download", methods=["POST"])
def yt_download():
    data = request.get_json() or {}
    url = (data.get("url") or "").strip()
    mode = data.get("mode", "video")
    quality = data.get("quality", "best")
    start = data.get("start", "")
    end = data.get("end", "")
    if not url:
        return jsonify({"error": "No URL"}), 400
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "file": None, "progress": 0}
    t = threading.Thread(target=_run_download, args=(job_id, url, mode, quality, start, end), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})

@app.route("/api/yt/status/<job_id>")
def yt_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    resp = {"status": job["status"], "progress": job.get("progress", 0)}
    if job["status"] == "done":
        resp["file"] = job["file"]
        resp["url"] = "/downloads/" + job["file"]
        resp["title"] = job.get("title")
    if job["status"] == "error":
        resp["error"] = job.get("error")
    return jsonify(resp)

import re as _re

_MUSIC_SYMBOLS = set("♪♫🎵🎶♬♩♭♯")

def _strip_music_symbols(text):
    return "".join(c for c in text if c not in _MUSIC_SYMBOLS).strip()

def _is_noise_line(line):
    s = line.strip()
    if not s:
        return True
    # pure bracketed tag like [music], [applause], [laughter]
    if s.startswith("[") and s.endswith("]"):
        return True
    # only music/sound symbols
    if all(c in _MUSIC_SYMBOLS or c.isspace() for c in s):
        return True
    # after stripping music symbols, if empty or just brackets, it's noise
    cleaned = _strip_music_symbols(s)
    if not cleaned:
        return True
    if cleaned.startswith("[") and cleaned.endswith("]"):
        return True
    return False

def _clean_transcript_lines(lines):
    out = []
    for l in lines:
        if _is_noise_line(l):
            continue
        cleaned = _strip_music_symbols(l)
        if cleaned:
            out.append(cleaned)
    return out

def _parse_vtt(text):
    lines = text.splitlines()
    out = []
    for line in lines:
        line = line.strip()
        if not line or line == "WEBVTT" or line.startswith("Kind:") or line.startswith("Language:") or line.startswith("NOTE") or "-->" in line:
            continue
        # remove tags
        clean = _re.sub(r"<[^>]+>", "", line)
        clean = clean.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        clean = _strip_music_symbols(clean)
        if clean and not _is_noise_line(clean) and (clean not in out[-1:] if out else True):
            out.append(clean)
    # dedupe consecutive
    deduped = []
    for l in out:
        if not deduped or deduped[-1] != l:
            deduped.append(l)
    return "\n".join(deduped)

@app.route("/api/yt/transcript", methods=["POST"])
def yt_transcript():
    data = request.get_json() or {}
    url = (data.get("url") or "").strip()
    lang = (data.get("lang") or "en").strip()
    if not url:
        return jsonify({"error": "No URL"}), 400
    # Extract video ID
    vid_match = _re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    video_id = vid_match.group(1) if vid_match else url

    # Title via cli
    title = ""
    try:
        tproc = subprocess.run(["yt-dlp", "--no-warnings", "--skip-download", "--print", "title", url],
                               capture_output=True, text=True, timeout=60)
        title = tproc.stdout.strip().splitlines()[0] if tproc.stdout.strip() else ""
    except Exception:
        pass

    # Method 1: youtube-transcript-api (fast, reliable)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()
        available = [t.language_code for t in ytt.list(video_id)]
        # try requested lang, then any available
        langs_to_try = [lang] + [l for l in available if l != lang]
        transcript_obj = None
        used_lang = lang
        for l in langs_to_try:
            try:
                transcript_obj = ytt.fetch(video_id, languages=[l])
                used_lang = l
                break
            except Exception:
                continue
        if transcript_obj is not None:
            lines = _clean_transcript_lines([s.text for s in transcript_obj.snippets])
            transcript = "\n".join(lines)
            return jsonify({"title": title, "transcript": transcript, "language": used_lang})
    except Exception:
        pass

    # Method 2: yt-dlp fallback
    work = os.path.join(DOWNLOAD_DIR, f"transcript_{uuid.uuid4().hex}")
    os.makedirs(work, exist_ok=True)
    try:
        outtmpl = os.path.join(work, "sub.%(ext)s")
        for sub_args in (["--sub-lang", lang], ["--sub-langs", "all"]):
            cmd = ["yt-dlp", "--no-warnings", "--write-auto-subs", "--write-subs"] + sub_args + [
                "--skip-download", "--sub-format", "vtt", "-o", outtmpl, url]
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
                vtt_files = [f for f in os.listdir(work) if f.endswith(".vtt")]
                if vtt_files:
                    break
            except subprocess.CalledProcessError:
                continue
        vtt_files = [f for f in os.listdir(work) if f.endswith(".vtt")]
        if not vtt_files:
            raise RuntimeError("This video has no subtitles/captions. Try a different video or check if captions are enabled on YouTube.")
        vtt_file = os.path.join(work, vtt_files[0])
        with open(vtt_file, "r", encoding="utf-8", errors="ignore") as fh:
            vtt_text = fh.read()
        transcript = _parse_vtt(vtt_text)
        return jsonify({"title": title, "transcript": transcript, "language": lang})
    except Exception as ex:
        return jsonify({"error": str(ex)}), 400
    finally:
        import shutil
        shutil.rmtree(work, ignore_errors=True)

@app.route("/downloads/<path:filename>")
def downloads(filename):
    return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8099))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
