# reelradar
ReelRadar is a self-hosted movie and TV discovery service inspired by the discontinued Apple Trailers experience. It helps users discover upcoming and recently released films and series.

## Run / configure

Docker Compose stack: `backend` (Node 24, plain `http`, SQLite at `/data/reelradar.db` in the named volume `reelradar-data`, boot counter exposed at `/api/health`) and `frontend` (nginx:alpine, placeholder page, proxies `/api/` to the backend). The frontend is published on `127.0.0.1:8180` only. Caddy is not part of this stack.

```sh
cp .env.example .env     # fill in TMDB_API_KEY, KINOCHECK_API_KEY, SEERR_URL, SEERR_API_KEY (.env is git-ignored)
docker compose up -d --build
curl http://127.0.0.1:8180/api/health
```

Frontend JS must stay ES5 (target: Tizen 4.0 / Chromium M56).

## Reverse proxy (existing Caddy, host network)

`deploy/Caddyfile.example` serves the app on plain HTTP at `http://<lan-ip>:8095`, LAN/private ranges only:

```
http://:8095 {
	@outside not remote_ip private_ranges
	abort @outside
	reverse_proxy 127.0.0.1:8180
}
```

Apply: back up the Caddyfile, append the block, validate, reload (never restart):

```sh
cd <homeserver>/caddy && cp Caddyfile Caddyfile.bak-reelradar-$(date +%F)
cat <path-to-reelradar>/deploy/Caddyfile.example >> Caddyfile
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```
