# One program, one service, one window

The portable package's whole interface is a double-click (#75). A second
double-click therefore has to mean "bring the page back", never "start a second
copy": two Consoles write the same Mirror and the same Run log directory, and
the owner believes there is one program.

The stop story is equally small, and the page deliberately has no stop control
(ADR 0016): the window the launcher opened is visible and stays open, the title
says closing it stops the program, and closing it stops everything.

- **The running Console records how to reach itself, and every start asks.** It
  writes `<data>/instance.json` with the port it actually bound and the token it
  generated for this boot, once the port is known. A start reads that record and
  probes `GET http://127.0.0.1:<port>/api/instance?token=<token>` with a 1.5 s
  timeout. A `200 {"ok":true}` — the route sits behind the same token guard as
  every other route — means the service that wrote the record is the one
  listening: the start opens that page and exits. An absent, unreadable or stale
  record, a refused connection, a timeout, a foreign token or a body that is not
  the marker all answer "start normally". The record is replaced by the next
  boot, and removed by a clean exit only when the exiting boot still owns it
  (same token and pid), so two starts that raced cannot delete each other's
  handshake.
- **The record's token stays random per boot.** It is the handshake secret, not
  a saved credential: a URL written down in an earlier run is refused by the
  service that is running now, which is exactly what keeps the record from
  becoming a permanent key.
- **The probe is its own route, not `/api/status`.** Status is the page's poll
  and may ask the game's site for the Gallery list; a probe that can block on the
  network would be read as "no service" and start the second Console this exists
  to prevent.
- **The launcher is ASCII-only and contains no logic.** `packaging/启动.bat`
  (which #86 places at the archive root) is `cd /d "%~dp0app"`, the two root
  variables (`RE1999_APP_ROOT`, `RE1999_DATA_ROOT`), `app\node.exe app\server.js`,
  and `if errorlevel 1 pause`. Every Chinese line — the window title, the
  "do not close" line during a Run, the Mark-of-the-Web unblock steps — is
  printed by the program, from Node, which writes Unicode to the console
  regardless of the console's code page.
- **First start creates `data\` and records the installation.** `core/data-layout.ts`
  already creates and versions the data directory; the program now also rewrites
  `%LOCALAPPDATA%\re1999-wallpaper-crawler\install.json` with the installation
  root on every launch, because the folder can be renamed or moved and the updater
  (#87) needs the address the owner is actually running. Only the package layout
  (`<install>\app` beside `<install>\data`) writes it: a source `pnpm webui` has no
  installation to point at and never touches AppData.
- **A download that Windows marked unsafe is explained, not diagnosed later.**
  Extraction copies Mark-of-the-Web onto every file as a `:Zone.Identifier`
  stream; the start checks the files it is about to run and prints a Chinese
  instruction naming them, the Properties checkbox and the `Unblock-File`
  command. It is a notice, not a refusal: the tree may work, and refusing a
  working tree would be its own support case.

## Considered options

- **A lock file instead of a probe**: rejected. A lock needs the same staleness
  judgement a dead process already forces (and a crash mid-boot leaves one), and
  it only proves "someone wrote a file", while the handshake asks the service
  itself "are you answering, with this boot's token".
- **Probing `/api/status` as the handshake**: rejected for the reason above — the
  status read can ask the site, and a slow answer would start a second service.
- **Writing the runtime record in the program directory**: rejected. An update
  replaces `app\` wholesale (#75, ADR 0019); the record is runtime state, so it
  lives in `data\`.
- **Chinese in the `.bat`, with or without `chcp 65001`**: rejected on measured
  evidence. In fresh console windows on a Chinese Windows 11 (code page 936) a
  UTF-8 BOM-less script showed the line as mojibake; `chcp 65001` showed it
  correctly only while the file stayed BOM-less, and changed cmd's own messages
  to English; a UTF-8 **BOM** made the first line run as
  `'锘緻echo' 不是内部或外部命令`, so `@echo off` never took effect; GBK was
  correct on that machine and nowhere else. The same console showed Node's
  Chinese correctly, so the words moved into the program.
- **Letting the launcher create `data\`, write the pointer or check the zone
  streams**: rejected — every one of those needs a decision or Chinese text,
  which is precisely what a `.bat` cannot carry reliably.
- **Refusing to start a marked tree**: rejected. The unblock steps are the
  action; a refusal would turn "probably works after this click" into "will not
  start".

## Consequences

- **#86** must copy `packaging/启动.bat` to the archive root byte for byte (the
  file is stored with CRLF and `.gitattributes` marks `*.bat -text`), place the
  bundled `node.exe` in `app\`, and leave `data\` beside it.
- **#87** reads `install.json`; an absent or invalid pointer means "not found",
  and the spec's fallback is the owner dragging their old `启动.bat` onto
  `更新.bat`.
- **Closing the window is not a clean shutdown.** A console close is an OS
  termination, so the exit handler does not run and the record stays behind as a
  stale file; the next start's probe is what proves it stale, and it recovers by
  starting a fresh service. A clean exit (Ctrl+C in a terminal launch) removes
  the record.
- **A race window remains** between the probe and the record's publication. It is
  kept to milliseconds by publishing immediately after `listen` resolves — before
  the boot's update check, which can take its full three-second timeout on an
  offline machine. Two starts that still manage to race leave the later one's
  record; the earlier one's shutdown will not delete it.
- **`node.exe` itself can only be checked once it runs.** If Windows refuses to
  execute the bundled runtime, no JavaScript can print the unblock steps; the
  launcher's `pause` keeps the OS message on screen instead, and the AGENTS.md
  gotcha records the boundary.
- ADR 0016's page clause stands unchanged: the page still has no stop control.
  The stop is now the window (and still Ctrl+C in a terminal).

Related: ADR 0016 (the WebUI is the only human entry; no stop control on the
page), ADR 0019 (data lives beside the program, and the program writes only
there), #75 (the portable package's spec), #82, #85, #86, #87.
