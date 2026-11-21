// Samsung TV network remote (2018+ sets, secure port 8002). Needs `npm install` in this folder.
//   node remote.mjs open <url>             open the TV browser (org.tizen.browser) at <url>
//   node remote.mjs launch <appId>         start an installed app (e.g. reelradar1.ReelRadar)
//   node remote.mjs KEY_ENTER KEY_DOWN ... send key clicks, 700 ms apart
//   node remote.mjs hold KEY_POWER [ms]    press and hold a key (Power for 6 s switches the TV off)
// TV_IP (default 192.168.42.54). TV_TOKEN: the token printed on first connect; reuse it so the TV does not ask again.
import WebSocket from "ws";
const TV = process.env.TV_IP || '192.168.42.54';
const name = Buffer.from('ReelRadarSpike').toString('base64');
const ws = new WebSocket(`wss://${TV}:8002/api/v2/channels/samsung.remote.control?name=${name}${process.env.TV_TOKEN ? "&token=" + process.env.TV_TOKEN : ""}`, { rejectUnauthorized: false });
const args = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = async (m) => {
  const d = JSON.parse(m.data);
  console.log("<-", d.event, d.data && d.data.token ? "TOKEN=" + d.data.token : "", JSON.stringify(d.data || '').slice(0, 200));
  if (d.event !== 'ms.channel.connect') return;
  if (args[0] === 'open') {
    ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host',
      data: { appId: 'org.tizen.browser', action_type: 'NATIVE_LAUNCH', metaTag: args[1] } } }));
    await wait(2000);
  } else if (args[0] === 'launch') {
    ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host',
      data: { appId: args[1], action_type: 'DEEP_LINK' } } }));
    await wait(2000);
  } else if (args[0] === 'hold') {
    const k = (c) => ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: c, DataOfCmd: args[1], Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
    k('Press'); await wait(Number(args[2] || 6000)); k('Release'); await wait(500);
  } else {
    for (const k of args) {
      ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: k, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
      await wait(700);
    }
  }
  ws.close(); process.exit(0);
};
ws.onerror = (e) => { console.error('ws error', e.message || e); process.exit(1); };
setTimeout(() => { console.error('timeout: no answer from the TV (is it on? accept the prompt on screen)'); process.exit(1); }, 90000);
