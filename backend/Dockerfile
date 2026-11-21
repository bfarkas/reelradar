FROM node:24-alpine
WORKDIR /app
COPY server.js .
COPY gate.js import.js lists.json ./
RUN mkdir /data && chown node /data
USER node
CMD ["node", "server.js"]
