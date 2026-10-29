---
EH form: <% "unimported" %>
---

# Examined Human Daily Form

#### EH Daily Form
date: <% tp.file.title %>

##### Daily Metrics

mood:
energy:
stress:

weight_kg:
fasted:
dieted:
notes:

##### Sessions

FORMAT:
`interval | engagement | notes`
or
`interval | type | engagement | notes`

BUILT-IN SESSION TYPES:
`authorship, chore, exercise, leisure, maintenance, meditation, reading, research, social, study, thinking, work, writing`

ENTRIES:


##### Meals

FORMAT:
`food | amount_g`

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


##### Medical

###### Medication

FORMAT:
`time (hh:mm) | medication | amount | notes`

COLLECTION STATES:
`blank | none | intake rows`

ENTRIES:


###### Symptoms

FORMAT:
`time (hh:mm) | symptom | notes`

COLLECTION STATES:
`blank | none | symptom rows`

ENTRIES:


##### Financial

###### Transactions

FORMAT:
`signed amount | account | engagement | description`

ENTRIES:


###### Valuation Rates

FORMAT:
`unit | positive value in the configured reference asset class`

ENTRIES:


##### Exercise Details

FORMAT:
`exercise | [set1, set2, set3, ...] | notes`

ENTRIES:


##### Milestones

FORMAT:
`engagement | milestone | metric | value | owner session interval`

ENTRIES:


##### Stoicism

score:
notes:


##### Admin Events

FORMAT:
`command | arguments`

HEALTH CATALOG FORMATS:
`MEASUREMENT_CREATE | name | value_type | unit | [aliases]`
`MEASUREMENT_UPDATE | measurement | new_name | value_type | unit | [aliases]`
`MEDICATION_CREATE | name | dose_unit | [aliases]`
`MEDICATION_UPDATE | medication | new_name | dose_unit | [aliases]`
`SYMPTOM_CREATE | name | [aliases]`
`SYMPTOM_UPDATE | symptom | new_name | [aliases]`
`PROCEDURE_CREATE | name | [aliases]`
`PROCEDURE_UPDATE | procedure | new_name | [aliases]`

MEASUREMENT VALUE TYPES:
`number | qualitative | text`

ENTRIES:


#### END
