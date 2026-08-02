# mogichex

**mo**bile · shō**gi** · **chex** — **127 board games, playable with a thumb.**

A small, installable web app that puts the whole [Jocly](https://github.com/fhoudebert/jocly2) game
library on a phone: chess and its eighty-odd variants, shogi, xiangqi, draughts, go-like games,
tafl, mills, and more.

**▶ [Play now](https://biscandine.fr/variantes/mogichex/)** — nothing to install, but you can.

---

## What you get

**127 games in 12 families.** Everything from `classic-chess` to Tafl, Margo and Yohoho. Families
are collapsed by default so the list stays readable; open one with a tap, or search — accents and
languages don't matter, typing `echecs` finds *Chess*.

**Built for a phone, not shrunk to fit one.** Games are shown in 2D by default: it reads better on a
small screen, and there is no 3D artwork to download. The eleven games that genuinely need a big board
(16×16 and the like) are hidden on phones — and one switch brings them back, because a filter you
can't turn off feels like a bug.

**Rules for every game**, illustrated, in the app — before you play and during the game.

**Three opponents.** The computer, another player on the same device, or **another player over the
internet**.

**Play by invitation.** Pick *another player, over the internet*, send the link, and you're in.
Links are interchangeable with [joclymatch](https://github.com/fhoudebert/joclymatch): one of its
links opens here on the right game and the right side.

**Three to six strength levels** depending on the game, up to **Expert** — the
[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) engine, on 33 games. If your
server isn't configured for it, the app *tells you* instead of quietly playing weaker.

**English and French.** Adding a language means dropping one file in `lang/` — no code to touch.

**Take back, restart, sounds, notation, move hints, board style, view from either side.** Take back
and restart are hidden in online games: replaying a move your opponent already has would desync
both boards.

---

## Install it

It's a Progressive Web App, so there's no store to go through.

- **Android / Chrome** — open the link, then *Add to Home screen*.
- **iOS / Safari** — open the link, *Share* → *Add to Home Screen*.

It then behaves like any other app: full screen, its own icon. Games you've already played stay
available **offline**; ones you haven't will need a connection the first time.

An **Android APK** is available : [Download apk](https://github.com/fhoudebert/mogichex/releases/download/1.0/mogichex.apk).
It can also be built — see [android/README.md](android/README.md).

---

## Host it yourself

mogichex is static files plus two small PHP scripts. Shared hosting is enough; no Node, no
database, no daemon.

**1.** Copy the app somewhere, and a [Jocly](https://github.com/fhoudebert/jocly2) build next to
it. This layout works with no configuration at all:

```
your-site/
├── mogichex/          ← this repository, plus the files from deploy/
└── jocly/dist/        ← jocly2 built with: npx gulp build
```

**2.** Copy `deploy/signal.php`, `deploy/match.php`, `deploy/.htaccess` and
`deploy/signalconf.php.example` (renamed to `signalconf.php`) into the mogichex folder.

That's it. The app finds the game engine and the relay by itself, and remembers where they were.

**Two things the `.htaccess` does that matter:**

- it sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. Without them the
  browser withholds `SharedArrayBuffer`, the Fairy-Stockfish engine can't start, and the **Expert**
  level answers instantly without thinking. The app will say so if that happens;
- it makes unknown URLs fall back to `index.html`, so invitation links work.

Nothing else needs configuring. `signalconf.php` only matters if the app is served from a
*different* origin than the relay — a GitHub Pages mirror, or a native shell.

### Online games

Both players' moves go through `match.php`, a few hundred bytes each. Browsers that can reach each
other also open a **direct peer-to-peer connection**, which then takes over and lets the server
rest. When they can't — different networks behind unhelpful routers — the relay just keeps doing
the job, and nobody notices.

There is deliberately **no TURN server**: it would cost bandwidth to provide a service the relay
already provides.

---

## Under the hood

- No build step for the app itself — plain ES modules, no framework, no bundler.
- The game catalogue is precomputed at build time, so opening the list doesn't wake the engine.
- One coherent Jocly build per deployment, shared with other apps if you like.

```sh
git clone https://github.com/fhoudebert/jocly2 ../jocly2
cd ../jocly2 && npm install && npx gulp build
cd - && ln -s ../jocly2/dist/browser dist

npm run build      # catalogue + service worker stamp + tests
npm run serve      # http://localhost:8080
npm test           # 83 assertions
npm run test:php   # 28 assertions (requires php-cli)
```

[DEVELOPMENT.md](DEVELOPMENT.md) has the technical detail: how the catalogue is built, how the
relay works, what was measured, and the traps worth knowing before changing anything.

---

## Credits

Games, engines and artwork come from **Jocly**, created by Michel Gutierrez, Jérôme Choain. 
The original project is no longer maintained; it lives on as **[jocly2](https://github.com/fhoudebert/jocly2)**.

The Expert level uses [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) by
Fabian Fichter, derived from Stockfish. The single-window interface follows
[joclymatch](https://github.com/fhoudebert/joclymatch).

Game artwork under `chessbase/res` is **CC BY-SA 3.0**.

## License

**mogichex is free software under the [GNU Affero General Public License v3](LICENSE) or later.**

It is not a program that merely talks to Jocly: it loads the library into its own page and ships
it alongside — or inside, for the Android build. The two form a single work, so the whole is
AGPL-3.0. Fairy-Stockfish is GPL-3.0, which combines with AGPL-3.0 under both licenses' terms.

