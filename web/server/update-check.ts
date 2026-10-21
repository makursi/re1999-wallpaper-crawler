// ── The update check: one decision, one request ─────────────────────
//
// The page may tell its reader that a newer release exists (#81). It is the one
// outbound request the program makes that is not the game's own site or its
// CDN, so it is deliberately small and deliberately silent:
//
//   - the pure part (`updateNoticeFor`) decides from three inputs — the version
//     this Console runs, the release the project publishes, and the Releases
//     page — whether there is anything to say;
//   - the network part (`fetchLatestRelease`) is one anonymous request with an
//     injected implementation, and every failure it can meet collapses to
//     `null`;
//   - `checkForUpdate` is the one call the Console's entry point makes, once per
//     boot, and the result rides on the status payload.
//
// There is no download, no replacement and no prompt. The link is the reader's
// action; the launcher and updater are a different ticket (#87).
//
// A draft or prerelease is never announced: the project publishes a draft
// release while a human smoke-tests the zip, and a prerelease is not something
// a player should be told to install. A tag the module cannot read as a version
// is not announced either — a wrong "newer version" is worse than silence.

/**
 * What the check hands the status payload: the newer version and the page that
 * lists it, and nothing else. Declared here as the module's own answer;
 * `web/server/status.ts` holds it to `web/api-types.ts`'s `ConsoleUpdateNotice`
 * with the same `Same` check the Run report uses.
 */
export interface UpdateNotice {
  version: string
  releasesUrl: string
}

/**
 * The project's GitHub coordinates — the one place the repository's location is
 * written. The Releases page and the API URL below both derive from them, so a
 * renamed repository is one edit here rather than a hunt through literals.
 *
 * The repository is public on purpose: the unauthenticated latest-release
 * endpoint needs no token, and a token must never ship in a client.
 */
export const PROJECT_REPO = { owner: 'makursi', name: 're1999-wallpaper-crawler' } as const

/** Where a reader goes to read the releases and fetch the zip themselves. */
export const RELEASES_PAGE_URL = `https://github.com/${PROJECT_REPO.owner}/${PROJECT_REPO.name}/releases`

/** GitHub's newest-release endpoint for the project, anonymous. */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${PROJECT_REPO.owner}/${PROJECT_REPO.name}/releases/latest`

/** What the newest release says, reduced to the fields this decision reads. */
export interface LatestRelease {
  /** The release's tag, as published: `v1.2.3` and `1.2.3` are both seen. */
  tagName: string
  /** A release its author has not published yet. */
  draft: boolean
  /** A release marked as a prerelease. */
  prerelease: boolean
}

/** The three inputs the pure decision reads. */
export interface UpdateCheckInput {
  /** `core/version.ts`'s answer; `null` when the install names no version. */
  currentVersion: string | null
  /** The newest release, or `null` when the check could not learn one. */
  latestRelease: LatestRelease | null
  /** The Releases page the notice links to. */
  releasesUrl: string
}

/** A release tag the module can compare: `v` is optional, three numbers only. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

interface Version {
  major: number
  minor: number
  patch: number
}

/**
 * The notice to show, or `null` for "say nothing".
 *
 * Silence is the answer whenever the inputs cannot support a claim: an unknown
 * current version (an install whose metadata is unreadable — never "everything
 * is outdated"), no release, a draft or prerelease, or a tag that is not a
 * three-number version.
 */
export function updateNoticeFor({
  currentVersion,
  latestRelease,
  releasesUrl,
}: UpdateCheckInput): UpdateNotice | null {
  if (currentVersion === null || latestRelease === null) return null
  if (latestRelease.draft || latestRelease.prerelease) return null

  const current = parseVersion(currentVersion)
  const latest = parseVersion(latestRelease.tagName)
  if (current === null || latest === null) return null
  if (!isNewer(latest, current)) return null

  return { version: formatVersion(latest), releasesUrl }
}

function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text.trim())
  if (match === null) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** The version as the page writes it — the same shape `package.json` carries. */
function formatVersion({ major, minor, patch }: Version): string {
  return `${major}.${minor}.${patch}`
}

function isNewer(left: Version, right: Version): boolean {
  if (left.major !== right.major) return left.major > right.major
  if (left.minor !== right.minor) return left.minor > right.minor
  return left.patch > right.patch
}

/**
 * How long the one request may take. Three seconds: a boot must not wait longer
 * on a courtesy check, and a machine that is offline answers with a rejected
 * fetch almost at once anyway.
 */
const REQUEST_TIMEOUT_MS = 3000

/** What `fetchLatestRelease` needs; every part has a production default. */
export interface LatestReleaseOptions {
  /** The endpoint; `LATEST_RELEASE_URL` unless a caller names another. */
  url?: string
  /** The network, injected so tests never touch it. */
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
}

/**
 * Ask GitHub for the project's newest release, once.
 *
 * Every failure — a timeout, an offline machine, DNS, a non-200, a redirect, a
 * body that is not JSON, a payload whose fields are not what the API documents —
 * is `null`. Nothing here throws, logs, retries or blocks: the caller cannot
 * tell the failures apart because it must not care about them.
 *
 * The request is anonymous (no `Authorization`): the repository is public and a
 * token must never ship in a client. `redirect: 'error'` refuses to follow a
 * redirect, because the answer has to come from the endpoint that was asked.
 */
export async function fetchLatestRelease({
  url = LATEST_RELEASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: LatestReleaseOptions = {}): Promise<LatestRelease | null> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 're1999-wallpaper-crawler',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }
  return parseLatestRelease(payload)
}

/**
 * The release fields this module reads, or `null` when the payload is not the
 * shape GitHub documents.
 *
 * Both flags are required booleans rather than "truthy": a proxy or an error
 * page that happens to parse as an object must not be mistaken for a published
 * release, and a missing `draft` must not be read as "not a draft".
 */
function parseLatestRelease(payload: unknown): LatestRelease | null {
  if (typeof payload !== 'object' || payload === null) return null
  if (!('tag_name' in payload) || !('draft' in payload) || !('prerelease' in payload)) return null
  const { tag_name: tagName, draft, prerelease } = payload
  if (typeof tagName !== 'string' || tagName.trim() === '') return null
  if (typeof draft !== 'boolean' || typeof prerelease !== 'boolean') return null
  return { tagName: tagName.trim(), draft, prerelease }
}

/** What `checkForUpdate` needs; only the current version is required. */
export interface UpdateCheckerOptions {
  /** `core/version.ts`'s answer for this install; `null` when unknown. */
  currentVersion: string | null
  /** The Releases page the notice links to; the project's page by default. */
  releasesUrl?: string
  /** The network, injected so tests never touch it; the real fetch by default. */
  fetchRelease?: () => Promise<LatestRelease | null>
}

/**
 * The one call the Console's entry makes per boot: learn the newest release,
 * then let the pure decision speak.
 *
 * It never rejects. A `fetchRelease` that throws is treated like every other
 * failed check — no notice — so no caller can turn the courtesy check into a
 * boot failure.
 */
export async function checkForUpdate({
  currentVersion,
  releasesUrl = RELEASES_PAGE_URL,
  fetchRelease = () => fetchLatestRelease(),
}: UpdateCheckerOptions): Promise<UpdateNotice | null> {
  // #79's `null` can never produce a notice, so the one outbound request is not
  // made at all: nothing to compare means nothing to ask.
  if (currentVersion === null) return null

  let latestRelease: LatestRelease | null
  try {
    latestRelease = await fetchRelease()
  } catch {
    latestRelease = null
  }
  return updateNoticeFor({ currentVersion, latestRelease, releasesUrl })
}
