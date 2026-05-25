# Translating Lyftr

Lyftr's web UI is internationalised with [react-i18next](https://react.i18next.com/).
All UI strings live in **monolingual JSON** files under `web/src/locales/`, with
English (`en.json`) as the source language.

You do **not** need to be a developer to translate. The recommended path is
[Weblate](#translating-with-weblate-recommended), a web UI that opens the pull
request for you.

---

## How translations load

Every `web/src/locales/<code>.json` file is auto-discovered at build time
(`import.meta.glob` in `web/src/i18n.ts`). Adding a language is therefore just
**committing one JSON file** — no code change, no registration step. The new
language appears automatically in **Settings → Appearance**, labelled by its own
name (e.g. `Deutsch`, `Français`).

`<code>` is a [BCP-47](https://en.wikipedia.org/wiki/IETF_language_tag) code:
`de`, `fr`, `es`, `pt-BR`, `zh`, … Region-specific browser locales fall back to
the base language (`de-AT` → `de`), and anything untranslated falls back to
English.

---

## Translating with Weblate (recommended)

1. Open the Lyftr project on Weblate and pick (or **＋ Add**) your language.
2. Translate strings in the web editor. Weblate shows the English source beside
   each entry and flags anything that breaks a [placeholder](#keys-and-placeholders).
3. Your changes are committed to the translation file and pushed back to GitHub
   as a pull request automatically — no git knowledge required.

That's it. A maintainer reviews and merges the PR, and the language ships on the
next build.

---

## Translating manually (via a pull request)

For developers, or one-off contributions without a Weblate account:

1. Copy the source file to your language code:
   ```bash
   cp web/src/locales/en.json web/src/locales/de.json
   ```
2. Translate the **values** in `de.json`. Leave the keys and every
   `{{placeholder}}` exactly as-is (see below).
3. Build to confirm it loads and the language shows up in the switcher:
   ```bash
   cd web && npm run build
   ```
4. Commit and open a PR against `main` (branch name: `feature/i18n-<code>`).

No edit to `i18n.ts` or any other file is required — the JSON file is enough.

---

## Keys and placeholders

- **Never translate or rename keys.** Only translate the string on the right of
  the colon.
  ```jsonc
  // en.json                          // de.json
  "heading": "Welcome back"           "heading": "Willkommen zurück"
  ```
- **Keep `{{placeholders}}` verbatim.** They are filled in at runtime. Their
  position in the sentence may move, but the token must survive:
  ```jsonc
  "current": "Current: {{url}}"       "current": "Aktuell: {{url}}"
  "synced":  "Synced {{count}} exercises"   "synced": "{{count}} Übungen synchronisiert"
  ```
- **Plurals** use i18next's `_one` / `_other` suffixes on the same key, driven by
  `{{count}}`. Languages with more plural forms (e.g. Polish, Arabic) get extra
  suffixes — Weblate generates the right set for the target language
  automatically.
  ```jsonc
  "count_one":  "{{count}} exercise",
  "count_other": "{{count}} exercises"
  ```
- Keep punctuation/spacing that belongs to the sentence; adapt it to your
  language's norms (French, for instance, uses `:` differently).

---

## Maintainer: connecting Weblate

Configure one component in the Weblate project UI:

| Setting | Value |
|---|---|
| File format | **i18next JSON v4** |
| File mask | `web/src/locales/*.json` |
| Monolingual base language file | `web/src/locales/en.json` |
| Source language | English |
| New translations | Use the base file as template |

The `github` VCS backend ("GitHub pull request") makes Weblate push
translations back as pull requests instead of committing to `main` directly.

### Recommended: free Hosted Weblate (the wger approach)

Lyftr is MIT-licensed and developed in the open, so it qualifies for
[Hosted Weblate's free plan for libre projects](https://hosted.weblate.org/hosting/) —
the same setup [wger](https://hosted.weblate.org/engage/wger/) and most
open-source apps use. No server, no Docker.

1. Sign in at [hosted.weblate.org](https://hosted.weblate.org/) and **add a
   project**, pointing it at `github.com/Cawlumm/lyftr`.
2. Add a component with the values in the table above and `github` as the VCS
   backend; authorize Weblate's GitHub App when prompted so it can open PRs.
3. Request libre hosting — a Weblate maintainer approves it (one-time).

Translators then work at `hosted.weblate.org/projects/lyftr/` and their changes
land as pull requests against `main`.

### Alternative: self-host

To run your own instance (e.g. to keep the repo private), use the official
Docker stack plus [`scripts/weblate-provision.sh`](scripts/weblate-provision.sh),
which creates the project + component via the API:

```bash
git clone https://github.com/WeblateOrg/docker.git weblate-docker
# in ./environment set WEBLATE_SITE_DOMAIN, *_ADMIN_*, WEBLATE_GITHUB_USERNAME+TOKEN, then:
docker compose up -d
WEBLATE_URL=https://weblate.example.com WEBLATE_TOKEN=<token> scripts/weblate-provision.sh
```

### The `.weblate` CLI config

The repo-root `.weblate` file points the
[`wlc`](https://docs.weblate.org/en/latest/wlc.html) CLI at the server and
default component. It defaults to Hosted Weblate; change the `url` only if you
self-host. **Never commit an API token**; `wlc` reads it from `~/.config/weblate`.

---

## Testing a language locally

```bash
cd web && npm run dev
```

Open the app, go to **Settings → Appearance**, and switch the language. The
choice is saved to `localStorage` (`lyftr_lang`) and `<html lang>` updates so
screen readers and spellcheck follow along.
