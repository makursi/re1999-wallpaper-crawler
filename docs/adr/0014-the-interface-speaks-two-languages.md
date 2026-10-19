# The interface speaks two languages, from a hand-rolled typed dictionary

The page is this repository's human half, and it spoke one language. An audit on
2026-10-19 counted 53 user-visible strings across the five SFCs and
`web/index.html` — every one of them English — and the page's prose was not even
all in the page: the service sent finished sentences (`BUSY_REASON`,
`ORPHANED_RUN_REASON`, `missing prerequisite(s): …`) and the page rendered them
verbatim, so the copy lived in two processes and neither could be translated
alone. Spec #43 makes the interface Chinese-first. This ADR records the
mechanism and the split it forces; ticket #47 records the half the service owes.

- **The dictionary is hand-rolled, typed data.** `web/src/i18n/messages.ts` holds
  one object per locale and a `translate` lookup — no runtime, no plugin, no
  message syntax beyond `{name}`. The Chinese object is the canonical shape:
  `MessageKey` is `keyof` its keys, and the English object carries
  `satisfies Record<MessageKey, string>`. That one clause is what makes a key
  missing from either locale *and* a key the canonical shape does not name a
  `tsc` error — measured, both directions, on 2026-10-19 — rather than a
  sentence in the wrong language discovered at runtime.
  `tests/web/i18n/messages.test.ts` pins the same property from the data side:
  identical key sets, no blank value, and the same `{name}` placeholders in both
  languages for every key. It is the ticket's one new seam, and it needs no DOM.
- **A message's parameters are data cells.** Ticket #49 put a value inside a
  sentence in the numeral role (`numeric`: the page's numeral face with tabular
  figures), and a whole parameterised sentence cannot carry a class on one word
  of itself. So the lookup has a second form: `translateParts` returns the
  message split at its `{name}` parameters, each piece marked with the
  parameter it is, and `web/src/i18n/Message.vue` renders every parameter as a
  data cell while the message's own text stays prose. The dictionary keeps whole
  sentences — no language has to live with the element order of the template —
  and the numeral role still lands on the values.
- **There is no fallback chain, and that is the point.** A locale's messages are
  complete or the build fails; nothing falls back to English, so the English
  page cannot half-exist as Chinese sentences and vice versa. `translate` is
  total over `MessageKey` by construction.
- **Chinese is the default, and the choice is remembered in `localStorage`**
  (`web/src/i18n/locale.ts`, key `webui.locale`). A value that is not a locale
  the dictionary carries is ignored rather than trusted, and a browser that
  refuses storage still gets a working switch for the session — it just does not
  remember it. The switch itself is a two-button group in the page's header
  area; ticket #48 moves it into the floating navigation it is planning, and
  nothing here assumed otherwise.
- **No `?lang=`.** The page's URL already carries the Console's token
  (`web/src/console-token.ts`), and a language in the URL would be a second
  source of truth that a bookmark could pin against the reader's own switch.
- **`<html lang>` and `document.title` follow the switch.** `lang` is what gives
  a screen reader the right voice and a translation tool the right source
  language; the title is what a tab, a bookmark and a screenshot carry. The
  effect that applies both runs at module load, so a remembered choice is
  applied to the document `web/index.html` served with `zh-CN` and 壁纸图鉴
  before anything renders.
- **The service emits codes; the page owns every word.** The contract
  (`web/api-types.ts`) is being turned into stable codes plus parameters —
  `run-busy` / `orphaned-run` / `missing-prerequisite`, the prerequisite names
  as codes, and `verdictReasons` as structured objects — and the page maps each
  to a message. **That is ticket #47**, and this ADR records it as part of the
  same decision rather than a separate one: one of the two processes must own
  the words, and it is the one that knows what language the reader chose. The
  `clean | explained | defect` verdict was already a code, so this ticket maps
  it (`verdict.clean` …) and nothing else on that path changed.
- **The interface is still dark only** (ADR 0013). The language switch is the
  page's only preference; a light theme would still be a value change, not a
  rewrite, and no message carries a colour or a layout.

## Considered options

- **`vue-i18n`**: rejected. The page has ~50 messages, two languages, no
  pluralisation and no date or number formatting; a framework would add a
  runtime, a plugin, a message compiler and a second way to name a string, and
  its fallback locale — the feature that makes it pleasant at scale — is the
  exact failure this ticket exists to prevent (a missing translation silently
  rendering in another language). Its typed-key story is weaker than
  `keyof typeof zhCN`, which needs no plugin to check.
- **Chinese keys** (`'镜像'`-style or Chinese phrases as keys): rejected. The
  language boundary in spec #43 keeps identifiers, comments and contracts
  English; a key is an identifier, and a page whose keys are Chinese cannot be
  read by the next contributor who does not speak it. English keys also mean the
  `t()` call in a template still reads like the sentence it produces.
- **`?lang=` as the source of truth**: rejected for the reason above, and
  because the language would then be copied into every link and bookmark as a
  pre-made decision.
- **A runtime fallback to English, translated "later"**: rejected. It is how a
  bilingual interface ends up permanently bilingual in one direction only; the
  compile-time and test-time parity make an untranslated key impossible to ship.
- **A message-format syntax (ICU, `vue-i18n`-style plurals)**: rejected. Chinese
  does not pluralise, English needs it in none of these messages, and a format
  parser in the page would be the largest thing in the interface's source. A
  `{name}` placeholder and `String(value)` cover all 52 entries.
- **Keeping the copy in the service, with a `lang` parameter on the API**:
  rejected and superseded by the codes decision above — it would put the
  reader's language into a machine contract and duplicate the dictionary in the
  service.

## Consequences

- Every user-visible string in `web/src/*.vue` and `web/index.html` resolves
  through the dictionary; the only remaining English the page shows is the
  service's prose (the refusal reasons, the `explained` verdict reasons and the
  raw `defects` block), which ticket #47 converts, plus runtime error messages
  (`HTTP 500`), which are not copy.
- Two sentences that used to bold a number inline — the Mirror/Gallery counts
  and the Run verdict line — are now whole parameterised messages, because
  emphasis inside a sentence would mean markup in the dictionary. Nothing else
  in the templates moved; ticket #48 owns the panel's look and can restore the
  emphasis in the template if it wants it.
- Ticket #49's type roles survive the merge: the headings keep `font-serif`, and
  every value that used to be interpolated straight into a template is now a
  message parameter rendered by `Message.vue`, which puts the same `numeric`
  class on it. The value's cell is one component's business, not each template's.
- The dictionary is data, so it is not screenshot evidence: the switch, the
  persisted choice, `<html lang>` and `document.title` were verified in a real
  browser against the real Mirror on 2026-10-19 (Chinese by default, `en` after
  a click, `en` still after a reload, and 壁纸图鉴 / Wallpaper Gallery as the
  title in each).
- The page's JavaScript grew by the two dictionaries and the piece renderer:
  156.11 kB → 164.09 kB raw and 56.50 kB → 59.31 kB gzipped, measured on the
  branch merged with #49's fonts. The interface's own stylesheet moved 14.95 kB
  → 15.11 kB (the switch's few utilities, against one spurious rule the comments
  had been generating — see below). That is the whole cost of the feature, and it
  stays inside the bundle: no runtime request, no CDN, no new dependency.
- UnoCSS extracts class-like tokens from `.vue` comments too, which is how a
  comment saying the page has no `<style>` block was shipping a `.block` rule
  nobody used. The comments touched here say "record" and "element" instead, and
  the rule is gone from the built stylesheet (measured, 2026-10-19).
- `CONTEXT.md`'s touched entries are bilingual: the English canonical name
  stays and each gains its Chinese canonical name (「壁纸」「镜像」「运行」
  「运行日志」「官方清单」「站点资源」「孤儿运行」「覆盖率」「镜像缺口」
  「本地控制台」). The repository's other prose stays English, and the machine
  surface — identifiers, comments, commit messages, `run_report` fields, the Run
  log's contracts — does not move at all.

Related: ADR 0012 (the human entry point is `webui`), ADR 0013 (the design
system is UnoCSS tokens), ADR 0007 (the Run log is written synchronously),
ADR 0008 (the Console is the human entry point).
