# OS-T-4REBM: Samsung 2018 Smart TV (Tizen 4.0, Chromium M56) browser spike

Page: `index.html` (ES5 only, no external resources except the YouTube iframe, plain HTTP).
Test video: Big Buck Bunny, official Blender Foundation upload, YouTube id `aqz-KE-bpKQ`.

## Serve (Mac, same Wi-Fi/LAN as the TV)
```
cd spikes/tv && python3 -m http.server 8099
ipconfig getifaddr en0     # LAN IP (try en1 if empty)
```
On the TV use `http://<LAN-IP>:8099/` (NOT localhost). Allow Python through the macOS firewall if asked. Stop the server (Ctrl-C) when done.

## Checklist on the TV (Internet / Web Browser app)
Remote: arrows move focus, OK presses. Keep the Mac server running throughout.

1. **Load**: type the URL. Pass = page appears with all 5 sections. Note if the layout is cut off.
2. **Environment**: section 1 shows UA, screen size, "localStorage works: true/false". Photograph it.
3. **Embed**: scroll to section 3. Does the video show? Press OK on it / play. Press exactly one of: `yes` (played with sound), `shows but no play`, `fails`.
4. **Write**: section 2, press `write`. Note the stored value + age.
5. **Close/reopen browser**: exit the browser app fully, reopen, load the same URL. Pass = stored value still present, age keeps growing from the original time. Do NOT press clear.
6. **Power cycle**: turn the TV off, unplug 30 s (or hold power until it restarts), power on, reopen the browser and URL. Pass = value still present.
7. **Fallback** (always try if the embed did not play with sound; try anyway if time allows): press OK on "Open watch link" and see if youtube.com/watch plays in the TV browser; separately scan the QR with a phone. Press `link works`, `QR scanned ok` or `fails`.
8. **Summary**: section 5 shows env, stored value, and all logged observations with timestamps. Photograph the screen.

Notes: if remote focus gets stuck inside the video, press Back/Return. The Back key may leave the page, so reload the URL.

## Record (paste into the OctoSprout task)
- Date:
- TV model / year / firmware version (Settings > Support > About this TV):
- User agent (from section 1 / photo):
- Page loaded over LAN HTTP: yes/no
- Embed result: yes / shows but no play / fails (details: buffering, black frame, error text)
- localStorage works: yes/no; survived browser reopen: yes/no; survived power cycle: yes/no
- Fallback tested: link works / QR scanned ok / fails; chosen fallback:
- Other observations (remote navigation, lag, layout):

## Acceptance mapping
- Page loads from LAN over HTTP: steps 1-2
- Embed result recorded: step 3
- localStorage survives browser reopen and TV power cycle: steps 4-6
- Fallback chosen and tested if embed fails: step 7
- Findings written up: the Record section above, with summary photo

## Remote-driven run (no one at the TV)
Used for the 2026-11-21 run. Needs the TV on, the Mac on the same LAN, and `npm install` in `spikes/tv`.
```
python3 -m http.server 8099 --bind 0.0.0.0 2> server.log      # in spikes/tv
node remote.mjs open "http://<LAN-IP>:8099/?write=1"          # first run prints TOKEN=..., export it as TV_TOKEN
python3 logs.py server.log                                    # page state + YouTube player events
```
- The page sends its state (localStorage, stored value) and the YouTube player events (state 1 = playing, muted, volume) to the server log as `GET /log?{json}`. The 404s are expected.
- `?write=1` writes the test value without pressing a button. On the TV, OK clicks wherever the browser's pointer is, not the focused button.
- Port 8001 answers `ms.channel.unauthorized` on this set; the script uses 8002.
- `node remote.mjs KEY_EXIT` leaves the browser but its process stays resident. `node remote.mjs hold KEY_POWER 6000` switches the TV off; it has to be switched back on by hand or by Home Assistant.
- A camera on the TV (Photo Booth) is enough to see the picture. Sound needs a person.

## Result 2026-11-21
UE55NU8009, Tizen 4.0, `SamsungBrowser/2.1 Chrome/56.0.2924.0`. Page loads over plain HTTP. The embed plays with sound. localStorage survives browser exit and a switch-off and on (not proven to be a cold boot). No fallback needed. Details in OctoSprout task OS-T-4REBM.
