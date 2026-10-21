---
EH form: <% "unimported" %>
---

# Examined Human Daily Form

> [!info] Health collection design draft
> Medication and Symptoms below are proposed sections, not implemented imports. The current Daily importer skips their contents, and full Daily reimport rejects these headings even when empty. Retain your source notes and disable automatic Daily Form cleanup while using these sections. See the [README health definitions](../README.md#health-collection-drafts).

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


##### Medication

FORMAT:
`time (hh:mm) | medication | amount | notes`

Use a canonical medication name or alias. The proposed `medications` table supplies its required dose unit. Blank means unrecorded; a standalone `none` explicitly means no medication was taken that day.

ENTRIES:


##### Symptoms

FORMAT:
`time (hh:mm) | symptom | notes`

Use a canonical name or alias; all three fields are required. Blank means unrecorded; a standalone `none` explicitly means no symptoms were experienced that day.

ENTRIES:


##### Transactions

FORMAT:
`signed amount | account | engagement | description`

ENTRIES:


##### Valuation Rates

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

ENTRIES:


#### END
