// Party groups on the start page. Everyone in a party sees the same member list; only the host
// picks a game. Launching asks that game's server for a room with everyone already seated
// (POST /party-room, secured with PARTY_SECRET) and hands every member their own way in.
// Updates go out over server-sent events (EventSource reconnects on its own), actions are POSTs.
"use strict";

const crypto = require("crypto");

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_PARTIES = 40, MAX_MEMBERS = 24;
const PRESENT_MS = 5 * 60 * 1000;     // someone who left the page (into the game) still counts for a launch
const EXPIRE_MS = 3 * 60 * 60 * 1000; // a party nobody visited for this long is gone

class PartyError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

function createParties({ games, secret, fetchImpl = fetch, now = Date.now }) {
  const parties = new Map();
  const clean = (n) => String(n || "").replace(/\s+/g, " ").trim().slice(0, 18);
  const online = (m) => m.streams.size > 0;
  const present = (m) => online(m) || now() - m.seen < PRESENT_MS;

  function newCode() {
    for (;;) {
      let c = "";
      for (let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)];
      if (!parties.has(c)) return c;
    }
  }
  const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? String(c).toLowerCase() : "");
  function member(name, avatar, color) {
    return { name, avatar: String(avatar || "").slice(0, 8), color: cleanColor(color), secret: crypto.randomUUID(), ready: false, streams: new Set(), seen: now() };
  }

  // what one member gets to see: the list of people, and how to get into the running game
  function view(p, me) {
    let game = null;
    if (p.game) {
      const role = p.game.roles.get(me.secret) || null;
      game = { id: p.game.id, room: p.game.room, max: p.game.max, at: p.game.at, playing: p.game.playing, watching: p.game.watching, out: p.game.out,
        role: role && role.role, params: role && role.params };
    }
    return {
      code: p.code, you: p.members.indexOf(me), host: p.members.indexOf(p.host), game,
      members: p.members.map((m) => ({ name: m.name, avatar: m.avatar, color: m.color, ready: m.ready, online: online(m) }))
    };
  }
  function push(p) {
    for (const m of p.members) {
      if (!m.streams.size) continue;
      const data = `data: ${JSON.stringify(view(p, m))}\n\n`;
      for (const res of m.streams) res.write(data);
    }
  }
  function touch(p) { p.touched = now(); }

  function create(name, avatar, color) {
    name = clean(name);
    if (!name) throw new PartyError("Bitte gib deinen Namen ein.");
    if (parties.size >= MAX_PARTIES) throw new PartyError("Gerade sind zu viele Partys offen. Versuch es später nochmal.");
    const me = member(name, avatar, color);
    const p = { code: newCode(), members: [me], host: me, game: null, launching: false, touched: now() };
    parties.set(p.code, p);
    return { secret: me.secret, view: view(p, me) };
  }
  function find(code) { return parties.get(String(code || "").toUpperCase().trim()); }
  function join(code, name, avatar, color) {
    const p = find(code);
    if (!p) throw new PartyError("Diese Party gibt es nicht. Prüf den Code.", 404);
    name = clean(name);
    if (!name) throw new PartyError("Bitte gib deinen Namen ein.");
    if (p.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new PartyError(`Der Name „${name}“ ist in dieser Party schon vergeben.`);
    if (p.members.length >= MAX_MEMBERS) throw new PartyError("Die Party ist voll.");
    const me = member(name, avatar, color);
    p.members.push(me); touch(p); push(p);
    return { secret: me.secret, view: view(p, me) };
  }
  function auth(code, secret) {
    const p = find(code), me = p && secret ? p.members.find((m) => m.secret === secret) : null;
    if (!me) throw new PartyError("Du bist nicht (mehr) in dieser Party.", 404);
    return [p, me];
  }

  // an open event stream: returns a function that closes it again
  function attach(code, secret, res) {
    const [p, me] = auth(code, secret);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", connection: "keep-alive" });
    me.streams.add(res); me.seen = now();
    res.write(`retry: 2500\ndata: ${JSON.stringify(view(p, me))}\n\n`);
    push(p); // the others see you come online
    return () => { me.streams.delete(res); me.seen = now(); reassignHost(p); push(p); };
  }
  // a host who is gone for good hands over to somebody who is here
  function reassignHost(p) {
    if (present(p.host)) return;
    const next = p.members.find(online);
    if (next) { p.host = next; }
  }
  function remove(p, me) {
    p.members = p.members.filter((m) => m !== me);
    for (const res of me.streams) { res.write(`event: kicked\ndata: {}\n\n`); res.end(); }
    if (!p.members.length) { parties.delete(p.code); return; }
    if (p.host === me) p.host = p.members.find(online) || p.members[0];
    push(p);
  }

  async function launch(p, me, gameId) {
    if (p.host !== me) throw new PartyError("Nur der Host wählt das Spiel.", 403);
    const g = games().find((x) => x.id === gameId);
    if (!g || !g.status) throw new PartyError("Dieses Spiel gibt es nicht.");
    if (p.launching) throw new PartyError("Einen Moment, das Spiel wird gerade vorbereitet.");
    p.launching = true;
    try {
      const people = [me, ...p.members.filter((m) => m !== me && present(m))];
      const base = new URL(g.status).origin;
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      let out;
      try {
        const r = await fetchImpl(base + "/party-room", {
          method: "POST", signal: ctl.signal,
          headers: { "content-type": "application/json", "x-party-secret": secret },
          body: JSON.stringify({ party: p.code, members: people.map((m) => ({ name: m.name, avatar: m.avatar, color: m.color, ready: m.ready })) })
        });
        out = await r.json().catch(() => ({}));
        if (!r.ok) throw new PartyError(out.error || `${g.name} kann gerade keinen Raum anlegen.`, 502);
      } catch (e) {
        if (e instanceof PartyError) throw e;
        throw new PartyError(`${g.name} ist gerade nicht erreichbar.`, 502);
      } finally { clearTimeout(t); }
      const roles = new Map();
      const byName = new Map(people.map((m) => [m.name, m]));
      for (const s of out.seats || []) {
        const m = byName.get(s.name);
        if (m) roles.set(m.secret, { role: "play", params: { pr: out.code, ps: s.secret } });
      }
      for (const n of out.watch || []) {
        const m = byName.get(n);
        if (m) roles.set(m.secret, { role: "watch", params: { pr: out.code, pw: m.name } });
      }
      for (const n of out.out || []) {
        const m = byName.get(n);
        if (m) roles.set(m.secret, { role: "out", params: null });
      }
      p.game = { id: g.id, room: out.code, max: out.max, at: now(), roles, playing: (out.seats || []).length, watching: (out.watch || []).length, out: (out.out || []).length };
      touch(p); push(p);
    } finally { p.launching = false; }
  }

  async function act(code, secret, body) {
    const [p, me] = auth(code, secret);
    me.seen = now(); touch(p);
    switch (body && body.t) {
      case "ready": me.ready = !!body.on; push(p); break;
      case "avatar": me.avatar = String(body.avatar || "").slice(0, 8); if (body.color !== undefined) me.color = cleanColor(body.color); push(p); break;
      case "launch": await launch(p, me, String(body.game || "")); break;
      case "leave": remove(p, me); break;
      case "kick": {
        if (p.host !== me) throw new PartyError("Nur der Host kann jemanden entfernen.", 403);
        const who = p.members[+body.index];
        if (!who || who === me) break;
        remove(p, who); break;
      }
      case "ping": break;
      default: throw new PartyError("Unbekannte Aktion.");
    }
    return {};
  }

  function sweep() {
    for (const p of parties.values()) {
      reassignHost(p);
      if (!p.members.some(online) && now() - p.touched > EXPIRE_MS) parties.delete(p.code);
    }
  }
  const timer = setInterval(sweep, 30000);
  timer.unref();

  return { create, join, attach, act, count: () => parties.size };
}

module.exports = { createParties, PartyError };
