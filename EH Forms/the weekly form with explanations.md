---
EH form: <% "unimported" %>
---

# Examined Human Weekly Note

> [!info] Using this template
> Create the note through Templater so `EH form` becomes `unimported`. Weekly Assessment validates and imports the plan; reimporting the same start date replaces that stored week. Imported Weekly sessions supply the Calendar's future view. Today combines the Weekly plan with today's Daily Form or canonical sessions: Daily intervals win conflicts, while non-overlapping Weekly intervals remain visible. **Sync week** is optional and writes current/future rows only into empty Daily Form Sessions sections. If source cleanup is enabled in Settings, a successful import removes only this bounded form block and preserves the rest of the note.

#### EH Weekly Form
start date: <% moment().day(6 + (moment().day() >= 6 ? 7 : 0)).format('YYYY-MM-DD') %>
end date: <% moment().day(12 + (moment().day() >= 6 ? 7 : 0)).format('YYYY-MM-DD') %>

The end date must be exactly six days after the start date. Dates use `YYYY-MM-DD`.

- Main outcome:
- Important deadline:
- Constraint or risk:

Commitment rows use `hours | engagement | commitment`. Hours may be decimal. Use an existing canonical engagement name or alias.

##### Commitments


Total:

Each non-empty planning-grid cell uses `optional type ; engagement ; optional notes`. Unlike a Daily session row, the Weekly grid always keeps the first semicolon-delimited type position: leave it blank for an ordinary session, for example `; MIT Differential Equations ; Chapter 4`. A typeless cell inherits its engagement type in the Calendar. A supplied type must be active; built-in and custom Admin Event types are both valid. Use an existing engagement name or alias. Identical adjacent cells are combined into one longer planned session. Keep all seven day rows and the same number of cells in every row.

Example typed cell: `study ; MIT Differential Equations ; Chapter 4`

| Day       | 05-06 | 06-07 | 07-08 | 08-09 | 09-10 | 10-11 | 11-12 | 12-13 | 13-14 | 14-15 | 15-16 | 16-17 | 17-18 | 18-19 | 19-20 | 20-21 | 21-22 | 22-23 | 23-24 |
| ----------| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Saturday  |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Sunday    |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Monday    |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Tuesday   |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Wednesday |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Thursday  |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |
| Friday    |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |       |


##### Not This Week


##### Weekly Review

- Commitments completed:
- Commitments postponed or abandoned:
- Planned sessions:
- Actual sessions:
- Main source of drift:
- One adjustment for next week:

#### END
