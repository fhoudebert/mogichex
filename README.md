# mogichex

**mo**bile · shō**gi** · **chex** — **over 120 board games, playable with a thumb.**

🇫🇷 [Version française](LisezMoi.md)

**mogichex is [joclymatch](https://github.com/fhoudebert/joclymatch), rebuilt for phones.** Same
[Jocly](https://github.com/fhoudebert/jocly2) game library — chess and its eighty-odd variants,
shogi, xiangqi, draughts, go-like games, tafl, mills and more — in an interface designed for a
small screen and a thumb.

- **📱 Mobile first, and runs on shared hosting.** Static files plus three small PHP scripts: no
  Node, no database, no daemon on the server. Any cheap web host will do.
- **👥 Play and chat with real people.** Send an invitation link, your opponent taps it, the game
  starts. Talk with one-tap messages shown in each player's language, or free text encrypted end to
  end. You can also play the computer, or pass the phone around.
- **🤖 Also an Android app.** Ready-made APKs, including an offline build that never touches the
  network. Or simply install the web app from the browser (Android and iOS).

**▶ [Play now](https://biscandine.fr/variantes/mogichex/)** ·
**▶ [Android APK](https://github.com/fhoudebert/mogichex/releases/latest/)** ·
**▶ [Host your own](#host-it-yourself)**

---

## What you get

- **120+ games in a dozen families**, with search that ignores accents and language (`echecs`
  finds *Chess*), and favourites pinned at the top.
- **Made for a phone**: 2D boards by default, light download; the few games that need a huge board
  are hidden on phones — one switch brings them back.
- **Illustrated rules** for every game, before and during play.
- **Three opponents**: the computer (up to **Expert**, powered by
  [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)), a friend on the same
  device, or a player over the internet.
- **Online play that works with the family**: invitations use the joclymatch format, so a
  [Tabulon](https://github.com/fhoudebert/tabulon) or joclymatch player can join your game — chat
  included.
- **Chat without a common language**: *well played*, *your turn*, *stepping away*… each player
  reads them in their own language. Free text is encrypted on the phone; the server only stores
  unreadable bytes.
- **A gentle nudge**: notify your opponent it's their turn, with a built-in five-minute cooldown.
- **The usual comforts**: take back, move list, clock with increment (local games), sounds,
  notation, board styles, either side's view.
- **English and French**; adding a language is one file in `lang/`.

## Install it

- **Web app** — open the [link](https://biscandine.fr/variantes/mogichex/), then *Add to Home
  screen* (Android/Chrome) or *Share → Add to Home Screen* (iOS/Safari). Games you've played stay
  available offline.
- **Android APK** — on the [releases page](https://github.com/fhoudebert/mogichex/releases):
  **multiplayer-2d** (play over the internet) or **offline-2d** (no network at all). To build your
  own, pointing at your own server: [android/README.md](android/README.md).

## Host it yourself

1. Copy this repository next to a [Jocly](https://github.com/fhoudebert/jocly2) build:

   ```
   your-site/
   ├── mogichex/          ← this repository
   └── jocly/dist/        ← jocly2 built with: npx gulp build
   ```

2. Copy the files from `deploy/` (including `.htaccess`) into the mogichex folder, and rename
   `signalconf.php.example` to `signalconf.php`.

That's it: the app finds the game engine and the relay on its own. Your server can also host
games for Tabulon players.

`.htaccess` is a hidden file: make sure your upload tool copies it, otherwise the Expert level
and invitation links won't work.

## Documentation

| | |
|---|---|
| [LisezMoi.md](LisezMoi.md) | this page, in French |
| [android/README.md](android/README.md) | building and signing your own APK *(French)* |
| [DEVELOPMENT.md](DEVELOPMENT.md) | technical notes: relay, peer-to-peer, encryption, build, tests, known traps *(French)* |

---

## Credits

mogichex is based on **Jocly**, created by M. Gutierrez / J. Choain, now maintained as
**[jocly2](https://github.com/fhoudebert/jocly2)**. The Expert level uses
[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) by Fabian Fichter, derived
from Stockfish. The interface follows [joclymatch](https://github.com/fhoudebert/joclymatch).
Game artwork under `chessbase/res` is **CC BY-SA 3.0**.

## License

**mogichex is free software under the [GNU Affero General Public License v3](LICENSE) or later.**
It ships the Jocly library alongside (or inside, for Android); together they form a single
AGPL-3.0 work. Fairy-Stockfish is GPL-3.0, compatible with AGPL-3.0.
