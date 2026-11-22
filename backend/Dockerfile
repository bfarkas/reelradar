FROM node:24-alpine
# yt-dlp (+ ffmpeg to merge 1080p video and audio) fills the trailer cache for the TV app.
RUN apk add --no-cache ffmpeg python3 \
  && wget -q -O /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY server.js .
COPY gate.js import.js kinocheck.js media.js prefetch.js scheduler.js seerr.js lists.json ./
RUN mkdir /data && chown node /data
USER node
CMD ["node", "server.js"]
