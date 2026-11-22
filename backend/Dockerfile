# Debian, not Alpine: the NVIDIA driver libraries that NVENC loads are glibc-only.
FROM node:24-bookworm-slim
# yt-dlp (+ ffmpeg to merge 1080p video and audio) fills the trailer cache for the TV app.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY server.js .
COPY gate.js import.js kinocheck.js media.js prefetch.js scheduler.js seerr.js lists.json expected-providers.json ./
RUN mkdir /data && chown node /data
USER node
CMD ["node", "server.js"]
