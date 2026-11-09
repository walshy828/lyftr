# Lyftr redesign: Train · Fuel · Trend

Status: Phase 1 and most of Phase 2 are built on `feature/redesign-today-first`. Phases 3–5 are proposed.

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

## Phase 3: Plan & insight loop

- **Plan status bar** on Today: day N of plan, on pace / behind, and expected vs. actual weight today.
- **"Should I change my plan?"**: surface `should_regenerate` and `regenerate_reason` from adherence as a Today card with "Review plan" leading to the check-in.
- A weekly review screen (`/stats/weekly` today): Monday's recap with wins, misses, and next week's focus.
- Insight cards that explain themselves: each KPI tile drills into the chart and data behind it.

## Phase 4: Train

- The Train hub's first screen: this week's schedule strip, the next session card with Start, recent PRs.
- A builder wizard for routines (lifts + cardio blocks), a schedule drag-to-day, and a "Create with AI" entry. Rare tasks, so a deliberate multi-step flow is fine.
- Cardio from Health Connect merged into the same training calendar, so a synced run counts toward the day's Training ring.

## Phase 5: Polish

- Rasterize the new mark into the PWA PNG icons (`pwa-*.png`, `favicon-transparent.png`), and a new login/register hero.
- Add a step goal setting (Today currently assumes 10k).
- Make MacroBar's "over" color domain-aware: protein over target shouldn't be red.
- Light-mode QA pass. Many legacy components hardcode `text-emerald-400`-style shades that are low-contrast on white.
- Motion: sheet spring, ring fill on load, haptics through the Android companion.
- Desktop: a two-column Today (rings + focus | plan + weight) at `lg+`.
