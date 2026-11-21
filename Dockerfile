FROM python:3.11-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir gunicorn yt-dlp

COPY . .

# Create downloads dir
RUN mkdir -p downloads

ENV PORT=8099
EXPOSE 8099

CMD gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 300 server:app