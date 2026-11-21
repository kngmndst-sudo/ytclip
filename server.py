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

def _run_download(job_id, url, mode, quality, start="", end=""):
    job = jobs[job_id]
    try:
        job["status"] = "downloading"
        outtmpl = os.path.join(DOWNLOAD_DIR, f"{job_id}.%(ext)s")
        cmd = ["yt-dlp", "--no-warnings"]
        # timestamps
        s = (start or "").strip()
        e = (end or "").strip()
        if s or e:
            left = s if s else "0"
            right = e if e else "inf"
            cmd += ["--download-sections", f"*{left}-{right}"]
            cmd += ["--force-keyframes-at-cuts"]
        if mode == "audio":
            cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "192K"]
        else:
            if quality and quality != "best":
                fmt = f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<={quality}]/best"
            else:
                fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            cmd += ["-f", fmt, "--merge-output-format", "mp4"]
        cmd += ["-o", outtmpl, url]
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
        # find output file
        final = None
        for f in os.listdir(DOWNLOAD_DIR):
            if f.startswith(job_id):
                final = os.path.join(DOWNLOAD_DIR, f)
                break
        if final is None:
            raise RuntimeError("Output file not found")
        job["status"] = "done"
        job["file"] = os.path.basename(final)
        job["title"] = os.path.splitext(os.path.basename(final))[0]
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
    jobs[job_id] = {"status": "queued", "file": None}
    t = threading.Thread(target=_run_download, args=(job_id, url, mode, quality, start, end), daemon=True)
    t.start()
    return jsonify({"job_id": job_id})

@app.route("/api/yt/status/<job_id>")
def yt_status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    resp = {"status": job["status"]}
    if job["status"] == "done":
        resp["file"] = job["file"]
        resp["url"] = "/downloads/" + job["file"]
        resp["title"] = job.get("title")
    if job["status"] == "error":
        resp["error"] = job.get("error")
    return jsonify(resp)

@app.route("/downloads/<path:filename>")
def downloads(filename):
    return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8099))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
