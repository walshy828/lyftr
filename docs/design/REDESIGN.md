# Lyftr redesign: Train · Fuel · Trend

Status: Phases 1–5 are built on `feature/redesign-today-first`. A few small items remain, listed under each phase.

## Why

Lyftr started as a lifting log. Most daily use is now something else:

1. **Morning check-in**: what's going on, what am I doing well, what should I focus on today, am I on plan?
2. **Food logging, several times a day**, almost always one of two ways:
   - AI: describe the meal or snap a photo.
   - Repeat: re-log a usual snack, or copy all or part of yesterday's breakfast.
   - Less often: find something new by search, barcode, or label.
3. **Weigh-in** every day or two.
4. **Workouts**: logging is frequent. Building routines and schedules is rare, so it can take more taps.
5. **Synced data** from Google Health (steps, cardio, sleep, heart) through the companion app.
6. **Reviewing it all as a data person**: KPIs, trends, whether the weight-loss plan is working, and when to change it.

The old IA was built around lifting (Home / Plan / Food / Stats). The home page was a long stack of analytics cards, and logging food took 2–3 screens.

## Design principles

- **Entry first, one thumb.** Every daily input starts from the center **+** and finishes in 1–2 taps.
- **Recency beats search.** What you ate yesterday and what you eat often come before the search box.
- **Every food has a picture.** A real photo if there is one. Otherwise a keyword emoji on a tile tinted by the food's dominant macro.
- **Today vs. Trends.** Today answers "what do I do now?" in one screen. Trends answers "how is it going?" with every KPI.
- **One hue per domain**, used the same way everywhere: Fuel = amber, Body = violet, Train = cyan, Move = mint, Heart = rose, Sleep = indigo. Macros stay protein green, carbs amber, fat violet.
- **Rare tasks one level down.** Program builders, schedules, and the exercise library live under Train.

## Visual system (inspired by the TraceApps family: CookTrace / NoteTrace, plus openGym)

| Token | Dark | Light |
|---|---|---|
| base | `#0a0b0f` | `#f4f6fa` |
| raised (cards) | `#12141a` | `#ffffff` |
| overlay | `#1a1d26` | `#eef1f6` |
| border | `#232733` | `#e2e6ee` |
| brand | signal cyan `#13c2ec`, gradient to mint `#4fe3a1` | same, 600 for text |

- Type: Inter for everything. Display weight 700–800 with tight tracking. Numbers use tabular figures.
- Shape: 16px card radius, 12px controls, hairline borders, almost no shadows. The floating bar and sheets use glass blur.
- Domain colors are `--c-*` RGB-channel variables, so Tailwind opacity modifiers work (`bg-move/10`).
- Mark: a gradient tile with a rising trace whose end points are barbell plates, meaning "lifting" and "trending the right way". The wordmark is lowercase `lyftr`.

## Information architecture

```
Mobile bottom bar:  Today · Food · [ + ] · Trends · Train
Desktop:            left rail with the same four + a primary "Log" button
```

| Tab | Route | Job |
|---|---|---|
| Today | `/` | Rings (calories, protein, steps, training), Focus list, today's session, plan adherence, weight |
| Food | `/food` | Visual diary, a week strip with a calorie ring per day, meals |
| **+ Log** | sheet | Describe or photo → Eat it again → Your usuals → Search/Barcode/Label → Weight/Workout/Cardio/BP |
| Trends | `/stats` | **Overview** (all KPI cards) + Training, Sleep, Heart, Activity, Nutrition, Weight, BP, Cardio |
| Train | `/plan` | Schedule, programs, workouts, exercise library, AI program builder |

## Phase 1 (built)

- Tokens, palette, Inter, radii, and the domain colors (`web/src/index.css`, `tailwind.config.ts`).
- The new shell: a floating glass bottom bar with a center Log button, a desktop rail, and new logo and favicon (`Layout.tsx`, `Logo.tsx`, `LogoMark.tsx`).
- **Quick Log sheet** (`components/shell/QuickLogSheet.tsx`):
  - A meal selector that defaults by time of day.
  - AI Describe and Photo first.
  - "Eat it again": the last 3 days of meals as cards. *Add all* is one tap; *Pick* chooses items.
  - "Your usuals": the 12 most-logged foods as picture tiles. One tap adds one, with an Undo toast.
  - Search, Barcode, and Label deep-link into Log Food through `?mode=`.
  - Weight, Workout, Cardio, and BP open in place.
- **Food visuals** (`utils/foodVisual.ts`, `ui/FoodAvatar.tsx`), used in the diary, search results, and the sheet.
- **Today** (`pages/Dashboard.tsx`, `components/today/*`, `utils/todayFocus.ts`):
  - Four KPI rings plus a macro split.
  - A Focus list ordered todo → focus → done, with inline actions (weigh in, start the session, log the first meal). Protein pacing is judged against the time of day.
  - This week's insights.
- **Trends → Overview** (`components/trends/OverviewPanel.tsx`): the heatmap, training mix, muscle map, nutrition trend, scorecard, and last workout moved here from home.
- **Food diary**: a week strip with per-day calorie rings and live refresh when the sheet logs something.

## Phase 2: Food, deeper (mostly built)

Built:
- **"Same as yesterday"** in every empty diary meal: a one-tap chip showing the previous day's foods and calories for that meal.
- **Saved meals** (`meal_templates`, `/api/v1/food/templates`):
  - Save any diary meal from its ⋯ menu ("Save as a meal").
  - It appears under **Your meals** at the top of the Log sheet: one tap logs it to the chosen meal, with Undo. Rename or delete from the card's menu.
  - Items are a JSON snapshot, so editing or deleting the original entries never changes the saved meal.
- **Photo for any food:** tap a food's picture in the diary to take or choose a photo (`POST /food/photos`, `PUT /food/:id/photo`). It's applied to that entry and to every other entry and saved food with the same name and brand that had no photo yet, or that showed the photo being replaced. Photograph your usual yogurt once and it's pictured everywhere, including the usuals grid.
- **Swipe actions** on diary rows (touch only): swipe right to save to My Foods, swipe left to delete. Mouse users keep the row buttons, which are now hidden on phone widths.
- **Photo view** of the diary: a List / Photos toggle with a picture-wall grid per meal. The choice is remembered per device.
- Per-meal actions (suggest ideas, copy from another day, save as meal) moved behind one ⋯ menu so the meal header fits on a phone.
- **Bug fix:** copies of an entry share one photo file, and deleting any copy used to delete the file for all of them. This became easy to hit once Undo and one-tap repeat landed. Files are now removed only when no food log, saved food or saved meal still references them.

Still open:
- Redesigned Log Food screen: tabs become one list grouped as Recent / My foods / Database, with a sticky amount stepper and unit chips.
- Curated ordering for "Your usuals": pin and reorder, instead of only by how often you log something.

## Phase 3: Plan & insight loop (built)

- **Plan Pulse** on Today (`utils/planPulse.ts`, `components/today/PlanPulseCard.tsx`). It replaces the plan-adherence and road-ahead cards there, which moved to Trends → Overview.
  - Trend weight is a least-squares fit over the last 21 days of weigh-ins, so one salty dinner doesn't move it.
  - It shows where the plan says you should be today, your recent pace vs. the plan's pace, and the finish date your pace implies vs. the planned one.
  - A small chart draws the plan line, your weigh-ins, and the projected path to the goal.
- **"Should I change the plan?"** is answered explicitly. Being behind only counts as a reason to change the plan when you're actually following it:
  - *Too early*: under 2 weeks into the plan, or too few weigh-ins. It names the date to re-check.
  - *On track / ahead*: change nothing.
  - *Behind, thin logging* (under 10 of 14 days logged): not yet. Log for two weeks, re-check on a named date.
  - *Behind, calories over* (more than 150 kcal over target on average): not yet. Hit the target first.
  - *Behind while hitting the numbers*: yes, adjust. Lower calories ~150–200, add activity, or extend the timeline. The server's `should_regenerate` reason is included when present.
  - *Losing over 1% of body weight a week, far faster than planned*: consider easing off.
  - *Goal reached*: set the next goal.
- **No plan** → Today shows a "Set a weight goal" card instead.
- **Last week in review** on Mondays and Tuesdays: days logged, average kcal vs. target, weight change, sessions. It links to the weekly summary.
- **Drill-downs**: the This Week scorecard tiles open the matching Trends tab (training, nutrition, weight, cardio).
- Today got shorter: the raw weight-trend card shows only when there's no plan, and the nutrition card is gone because the rings cover it.

Known follow-ups:
- The server's adherence card counts *completed* weeks ("Week 6") while Plan Pulse counts the week in progress ("Week 7"). The server also judges on/off plan from the latest single weigh-in, not the trend, so the two cards can disagree for a day or two after a noisy weigh-in. Move the server's verdict onto trend weight.
- Make "Re-check on <date>" a reminder through the Android companion app.

## Phase 4: Train (built)

- **Train hub** at `/plan` (`pages/Train.tsx`, `utils/trainWeek.ts`), the gym-day screen:
  - Start / Log / Cardio up top.
  - A Mon–Sun strip marking each day done, partly done, missed, planned, rest, or "extra" (trained on an unplanned day), with synced cardio minutes under the day.
  - Week stats: planned sessions done, lift sessions, cardio minutes.
  - **Up next**: today's pending routine, or the next planned day. It previews the first exercises with sets × reps @ weight and has Start.
  - Recent PRs, and recent activity that mixes lifts and Health Connect cardio.
  - A **Build** section one tap down: Schedule, New routine, Create with AI, Exercise library, Workout history, Training trends.
- The old Plan page (weekly pattern, routines, month calendar) moved to `/plan/schedule` as "Schedule & routines", with a back link to Train. Routine pages link back to it.
- **Days on your week** picker on every routine you own. Toggling a day saves the weekly pattern and only changes this routine's membership on that day. Creating a routine lands on it (`?new=1`) with the picker highlighted, so a new routine is one step from showing up as Up next.
- **Synced cardio counts as training**: on Today, a Health Connect session fills the Training ring (half, on a day with a planned lift session not done yet) and shows "+30m cardio" in its label. It counts on the Train strip too.
- e2e: `programs.spec.ts` now visits `/plan/schedule` and accepts the `?new=1` redirect after creating a routine.

Still open:
- Drag-to-day schedule editing, and a guided routine wizard (today's editor is a single long form).
- Completing a planned session server-side still only recognises a lifting workout linked to the program, so a planned "Run" routine isn't marked done by a synced run.

## Phase 5: Polish (built)

- **App icons**: the new mark is rasterized into `favicon-transparent.png` and `pwa-192x192.png` / `pwa-512x512.png`. `pwa-maskable-512x512.png` is a full-bleed gradient with the glyph inside Android's safe zone. `logo.svg` matches.
- **Step goal setting**: `user_settings.step_goal` (default 10,000, allowed 1,000–100,000), edited under Settings → daily targets. Today's Steps ring uses it.
- **Protein is a minimum, not a limit**: `MacroBar kind="minimum"` shows going past the protein target as a win ("✓ +30g") in the macro's own color, instead of amber/red "over". Carbs, fat, sodium and cholesterol keep their warnings.
- **Light-mode contrast**: one remap in `index.css` darkens every bright 300/400 accent text shade (~340 uses) to an AA-contrast ≈700 shade when the theme is light. Dark mode is unchanged.
- **Desktop Today** is two columns at `lg+`: today (rings, focus, last week) on the left, plan and training on the right.
- **Motion**: rings fill from empty when they mount, and bottom sheets rise with a slight spring. A global `prefers-reduced-motion` rule turns all of it off.

Still open:
- Haptics through the Android companion app.
- A new login/register hero. The pages already use the new mark and tokens, but the layout is unchanged.
