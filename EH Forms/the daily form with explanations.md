---
EH form: <% "unimported" %>
---

# Examined Human Daily Form

> [!info] Using this template
> Create the note through Templater so `EH form` becomes `unimported`. The date must be an ISO date (`YYYY-MM-DD`); the default below expects the note title to be that date. Keep the `#### EH Daily Form`, section headings, `ENTRIES:` markers, and final `#### END` unchanged. The Daily Assessment dashboard can discover, validate, and import the completed form. A finalized historical Daily Form is immutable.

#### EH Daily Form
date: <% tp.file.title %>

##### Daily Metrics

Most metrics may be left blank if they were not measured. `calories` is required when the daily calorie limit is enabled in Settings, and `protein_g` is required when the minimum-protein setting is enabled. Use `1` for yes and `0` for no in the five flag fields.

mood:
energy:
stress:

weight_kg:
sleep_hours:

calories:
protein_g:

fasted:
dieted:
studied:
worked:
exercised:

##### Sessions

FORMAT:
`interval | session type | engagement | notes`

EXAMPLES (do not copy these below `ENTRIES:` unless they are real):
`09:00-10:30 | study | Jannach German for Reading | studied Kapitel 4`
`14:00-15:30 | work | Mensonaut Paper | wrote related zettels`

SESSION TYPES:
`authorship, chore, exercise, leisure, maintenance, meditation, reading, research, social, study, thinking, work, writing`

Use an existing canonical engagement name or one of its aliases. Overlapping sessions are allowed but reported as a warning.

ENTRIES:


##### Meals

FORMAT:
`food | amount_g`

EXAMPLES (do not copy these below `ENTRIES:` unless they are real):
`Eggs | 150`
`Rice | 200 g`

Use an existing Food Library name or alias. Examined Human derives calories, protein, carbohydrates, fat, salt, fiber, and cholesterol from the food's per-100-g record.

LEISURE RULES:

- Breakfast, lunch, and dinner are the three counted meals.
- Leave `is_leisure` blank for automatic evaluation. `1` always marks that meal as leisure; blank or `0` cannot bypass the configured meal-calorie limit.
- The plugin sums every food row in a meal before evaluating it.
- An empty meal starts as non-leisure.
- If the effective daily calorie total, including snacks, exceeds the configured daily limit, the day counts at least two leisure meals.
- Snacks never count as an individual leisure meal, but their calories contribute to the daily total.

###### Breakfast
is_leisure:
ENTRIES:


###### Lunch
is_leisure:
ENTRIES:


###### Dinner
is_leisure:
ENTRIES:


###### Snacks
ENTRIES:


##### Transactions

FORMAT:
`signed amount | account | engagement | description`

EXAMPLES (do not copy these below `ENTRIES:` unless they are real):
`250 | Bank | Mensonaut | article payment`
`-12.5 | Bank | Body | lunch`

Use a positive amount for inflow and a negative amount for outflow. The account and engagement must each match an existing canonical name or alias. The account's configured unit supplies the transaction unit.

ENTRIES:


##### Valuation Rates

FORMAT:
`unit | positive value in the configured reference asset class`

EXAMPLES (illustrative only; use your own observations):
`EUR | 1.08`
`TOMAN | 0.000012`
`BTC | 64000`
`APARTMENT | 2300000`

Each row means that one unit of the listed currency or asset equals the stated amount of the reference asset class configured in Examined Human settings. Unit matching is case-insensitive. A partial rate set is valid: omitted units keep using their most recent earlier rate. Rates apply from this Daily Form's date forward and never backward. A finalized date can contain only one rate set, so leave this section empty on most days. The Command Dashboard can stage rows into this existing section; it will not create the section for you.

ENTRIES:


##### Exercise Details

FORMAT:
`exercise | [set1, set2, set3, ...] | notes`

EXAMPLES (do not copy these below `ENTRIES:` unless they are real):
`Bench Press | [80x6, 80x4, 75x6] | felt strong`
`Pull Up | [BWx8, BWx7, BWx6] | hard`
`Pull Up | [+10x6, +10x5] | first time adding 10 kg`
`Running | [30min, 5km] | zone 2`

Supported set tokens are `weightxreps`, `+weightxreps`, `BWxreps`, `minutesmin`, and `distancekm`. Exercise Details require exactly one `exercise` session in the Sessions section. Use an existing exercise name or alias.

ENTRIES:


##### Milestones

FORMAT:
`engagement | milestone | metric | value | owner session interval`

EXAMPLES (do not copy these below `ENTRIES:` unless they are real):
`Mensonaut Paper | Draft Submission | word_count | 3500 | 14:00-15:30`
`MIT Differential Equations | Exam 1 | score | 86 | 09:00-11:00`
`IELTS | Overall | band | 8.0 | 15:00-16:00`

The fifth field is mandatory and must exactly copy the interval of one same-engagement row in Sessions. Ownerless or ambiguous milestone rows are rejected.

ENTRIES:


##### Stoicism

`score` and `notes` are optional single-line fields.

score:
notes:


##### Admin Events

The Command Dashboard is the easiest way to create these rows. Use the formats below for review, manual entry, or bulk staging. Canonical names and aliases are case-insensitive. Fields are pipe-separated; keep empty optional fields between their pipes. Alias lists use `[alias one, alias two]`.

ENGAGEMENT COMMANDS:

- `ENGAGEMENT_CREATE | name | type | status | notes`
- `ENGAGEMENT_COMPLETE | engagement`
- `ENGAGEMENT_PAUSE | engagement`
- `ENGAGEMENT_REOPEN | engagement`
- `ENGAGEMENT_RENAME | engagement | new_name`
- `ENGAGEMENT_UPDATE | engagement | new_name | type | status | start_date | target_date | completion_date | notes | aliases`
- `ENGAGEMENT_SET_STATUS | engagement | status`
- `ENGAGEMENT_SET_DATES | engagement | start_date | target_date`
- `ENGAGEMENT_SET_NOTES | engagement | notes`
- `ENGAGEMENT_ALIAS_ADD | engagement | [aliases]`
- `ENGAGEMENT_ALIAS_REMOVE | engagement | alias`
- `ENGAGEMENT_ALIAS_MOVE | alias | destination_engagement`

Engagement types: `article, authorship, book, career, certification, course, exam, fitness, leisure, maintenance, practice, relationship, speech, startup`.

Engagement statuses: `planned, pending, active, paused, completed, abandoned`.

EXERCISE COMMANDS:

- `EXERCISE_CREATE | name | category`
- `EXERCISE_UPDATE | exercise | new_name | category | [aliases]`
- `EXERCISE_RENAME | exercise | new_name`
- `EXERCISE_ALIAS_ADD | exercise | [aliases]`
- `EXERCISE_ALIAS_REMOVE | exercise | alias`
- `EXERCISE_ALIAS_MOVE | alias | destination_exercise`

ACCOUNT COMMANDS:

- `ACCOUNT_CREATE | name | type | unit | address`
- `ACCOUNT_UPDATE | account | new_name | new_type | [aliases]`
- `ACCOUNT_RENAME | account | new_name`
- `ACCOUNT_SET_TYPE | account | type`
- `ACCOUNT_SET_CURRENCY | account | unit`
- `ACCOUNT_SET_ADDRESS | account | address`
- `ACCOUNT_ALIAS_ADD | account | [aliases]`
- `ACCOUNT_ALIAS_REMOVE | account | alias`
- `ACCOUNT_ALIAS_MOVE | alias | destination_account`

For `ACCOUNT_CREATE`, include all four fields after the command. The address may be blank, but keep its final pipe: `ACCOUNT_CREATE | Cash | cash | USD |`.

FOOD COMMANDS:

- `FOOD_CREATE | name | category | calories_kcal_per_100g | protein_g_per_100g | carbs_g_per_100g | fat_g_per_100g | salt_g_per_100g | fiber_g_per_100g | cholesterol_mg_per_100g | notes | [aliases]`
- `FOOD_UPDATE | food | category | calories_kcal_per_100g | protein_g_per_100g | carbs_g_per_100g | fat_g_per_100g | salt_g_per_100g | fiber_g_per_100g | cholesterol_mg_per_100g | notes`
- `FOOD_RENAME | food | new_name`
- `FOOD_DELETE | food`
- `FOOD_ALIAS_ADD | food | [aliases]`
- `FOOD_ALIAS_REMOVE | food | [aliases]`
- `FOOD_ALIAS_MOVE | [aliases] | destination_food`

Calories, protein, carbohydrates, fat, and salt are required non-negative numbers. Fiber and cholesterol are optional; leave their fields blank if unknown. `FOOD_DELETE` is permanent and should be used deliberately.

ENTRIES:


#### END
