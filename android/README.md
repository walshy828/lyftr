# Lyftr Android (phone + Wear OS companion)

Three Gradle modules:
- `shared/` — wire contract (`WearPaths`, `WearSession`/`WearAction` DTOs) used by both apps.
- `phone/` — minimal Android app. Owns login + JWT storage/refresh, polls/pushes `/api/v1/active-session`, bridges to the watch over the Wear Data Layer API. This is what needs to be installed on your phone for the watch app to do anything.
- `wear/` — Wear OS app. No network/auth of its own — pure Data Layer client that renders whatever the phone last published and sends set actions back to it.

**Do you need `phone/` at all?** The web app is installable as a PWA (Add to Home Screen / standalone display) and covers everything `phone/`'s read-only status screen offers, with full workout CRUD besides. If you don't have a paired Wear OS watch, just use the PWA — you don't need to install anything from this directory. `phone/` is only necessary if you want the watch-based rest-timer/set display, since the watch has no independent auth or network access and depends on `phone/` as its bridge to the backend.

## Prerequisites
- Android Studio (Koala or newer) with the Wear OS emulator/SDK components installed, or a real Pixel Watch paired to a real Android phone via the Wear OS app.
- This directory has no Gradle wrapper checked in yet — open it in Android Studio once and let it generate one (or run `gradle wrapper` if you have a local Gradle install), then commit `gradlew`/`gradlew.bat`/`gradle/wrapper/*`.
- A running Lyftr backend reachable from your phone (LAN IP or public self-hosted URL — same one you'd use in the web app).

## Building
```bash
./gradlew :phone:assembleDebug :wear:assembleDebug
```
Installing `:phone`'s debug APK on a device with a paired Wear OS watch will offer to install `:wear` alongside it automatically (via the `wearApp` dependency in `phone/build.gradle.kts`), same as any standard Wear OS companion app.

## First run
1. Install and open the phone app, enter your server URL, and log in.
2. Start a workout on the web app (or resume one) — Gym Mode now syncs live session state to the backend.
3. Within ~7s the phone app's `SessionSyncService` picks it up and pushes it to the watch.
4. On the watch: complete/skip sets, adjust weight/reps — changes flow watch → phone → backend, and back down to web on its next load or the next `active-session` fetch.

## Known gaps (by design for v1 — see the plan)
- No offline queueing: if the phone loses connectivity, in-flight watch actions are applied locally but won't reach the backend until connectivity returns and the poll loop or next `ACTION_PUSH` succeeds.
- No iOS/Apple Watch support.
- Launcher icons in both modules are placeholder vector drawables — swap via Android Studio's Image Asset Studio before shipping.
