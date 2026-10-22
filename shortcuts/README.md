# "Sync Health" Shortcut (Phase 7)

This Shortcut sends today's **steps, active calories, food (calories and protein), heart rate, blood oxygen, last night's sleep and workouts** from Apple Health to the Worker.

Gym sessions, trained muscles and blood pressure are logged in the Gym Log app instead. Workouts here are only a backup, for days you forget to tap "I trained".

Sending again is harmless: each sync replaces the whole day, so sync as often as you like.

You need:
- your Worker address, e.g. `https://desk-dashboard.<you>.workers.dev`;
- your **INGEST_TOKEN** (the same one the Gym Log app uses).

> Tip: in Shortcuts, tap a blue variable to change what it shows (e.g. "Health Samples" → "Value"). Long-press an action to rename it. Every number below is sent as text in quotes on purpose: the server accepts "8432", "8.432" and "1850,5", so your iPhone's language settings can't break it.

---

## 1. Build the Shortcut

Shortcuts app → **+** → name it **Sync Health**. Add these actions in order.

### Date

1. **Format Date**: Date = **Current Date**, Date Format = **Custom**, format `yyyy-MM-dd`. Rename the result **Today**.
2. **Format Date**: Date = **Current Date**, Date Format = **ISO 8601**, **Include ISO 8601 Time** on. Rename it **SentAt**.

### Steps, active energy and food

3. **Find Health Samples** where **Type** is **Steps** and **Start Date** is **today**.
4. **Calculate Statistics**: **Sum** of *Health Samples*.
5. **Round Number**: *Statistics Result* to **Ones Place**. Rename it **Steps**.
6. Repeat steps 3–5 for:
   - **Active Energy** → rename it **Active**;
   - **Dietary Energy** → rename it **Kcal**;
   - **Protein** → rename it **Protein**.

   Check the units: in Find Health Samples, set Active and Dietary Energy to **kcal** and Protein to **g**, if Shortcuts offers a unit.

### Heart rate and blood oxygen (from your Watch)

6a. **Find Health Samples** where **Type** is **Resting Heart Rate**, **Start Date** is **in the last 1 days**, **Sort by: Start Date**, **Latest First**, **Limit** on, **1**. Then **Get Details of Health Samples** → **Value**. Rename it **RestHR**.

6b. Do the same for **Heart Rate** → rename it **HR** (your latest reading).

6c. Do the same for **Blood Oxygen Saturation** → rename it **SpO2**. A fraction (`0.97`), a percentage (`97`) or `97 %` are all fine.

If the Watch has no reading yet, the value is empty and the screen shows "—".

### Sleep (last night)

7. **Find Health Samples** where **Type** is **Sleep Analysis** and **Start Date** is **in the last 1 days**. Set **Sort by: Start Date**, **Oldest First**.
8. **Repeat with Each** item in *Health Samples*:
   1. **Format Date**: *Repeat Item → Start Date*, Date Format **ISO 8601**, include time. Rename it **S**.
   2. **Format Date**: *Repeat Item → End Date*, Date Format **ISO 8601**, include time. Rename it **E**.
   3. **Text**: `{"start":"S","end":"E","value":"Repeat Item → Value"}`. Insert the variables where the letters are.
9. After **End Repeat**: **Combine Text** *Repeat Results* with **Custom** separator `,`. Rename it **SleepJSON**.

The server understands any sleep labels Apple uses ("Core", "REM", "Deep", "Asleep", "Awake", "In Bed"). It merges overlapping watch and phone samples and only counts the night ending today, from 15:00 to 15:00.

### Workouts (backup for gym detection)

10. **Find Health Samples** where **Type** is **Workouts** and **Start Date** is **today**.
11. **Repeat with Each** item in *Health Samples*:
    1. **Get Time Between Dates**: from *Repeat Item → Start Date* to *Repeat Item → End Date* in **Minutes**. Rename it **Min**.
    2. **Format Date**: *Repeat Item → Start Date*, ISO 8601, include time. Rename it **WS**.
    3. **Text**: `{"type":"Repeat Item → Type","start":"WS","duration_min":"Min"}`.
12. After **End Repeat**: **Combine Text** *Repeat Results* with `,`. Rename it **WorkoutJSON**.

A strength workout of 20 minutes or more ("Traditional Strength Training", "Functional Strength Training") counts as gym done, unless you logged something in the app.

### Send

13. **Text** (the whole request body; insert the variables):
    ```
    {"date":"Today","sent_at":"SentAt","steps":"Steps","active_kcal":"Active",
     "nutrition":{"kcal":"Kcal","protein_g":"Protein"},
     "vitals":{"resting_hr":"RestHR","heart_rate":"HR","spo2":"SpO2"},
     "sleep_samples":[SleepJSON],"workouts":[WorkoutJSON]}
    ```
14. **Get Contents of URL**:
    - URL: `https://desk-dashboard.<you>.workers.dev/api/ingest`
    - Method: **POST**
    - Headers:
      - `Authorization` = `Bearer <your INGEST_TOKEN>`
      - `Content-Type` = `application/json`
    - Request Body: **File** → choose the **Text** from step 13.
15. *(Optional while testing)* **Quick Look** *Contents of URL*.
    - Success shows `{"ok":true,"date":"…"}`.
    - An error says exactly which field is wrong, e.g. `sleep_samples[3].start must be an ISO 8601 date-time`.

Run it once by hand. The first time, iOS asks for permission to read each Health type. Allow them all.

---

## 2. Automations [ME]

**Health data can't be read while the iPhone is locked.** So the automations below fire while you're using the phone.

Shortcuts → **Automation** → **+** → **Create Personal Automation**. For each one, turn **Run Immediately** on and **Notify When Run** off:

| Trigger | Why |
|---|---|
| **Alarm** → **Is Stopped** (any alarm) | Sends last night's sleep right after you wake up |
| **App** → **Is Opened** → one or two apps you open every day | Keeps steps and food fresh during the day |
| **Time of Day** → **21:00**, daily | Evening fallback |

Each automation runs the action **Run Shortcut → Sync Health**.

Your food tracker must have **write to Apple Health** turned on (in its settings and in Health → Sharing). Otherwise calories and protein stay "—".

---

## 3. Check it from the Worker side

Open this in a browser or Shortcuts. Header: `Authorization: Bearer <INGEST_TOKEN>`.

```
GET https://desk-dashboard.<you>.workers.dev/api/debug/last-ingest
```

It shows when the last sync arrived and what it contained:
- step, kcal and protein values;
- how many sleep samples came in, which sleep labels were used, and the computed minutes asleep;
- the workouts.

The Gym Log app also shows "Health synced HH:MM" under the metric cards. The desk screen turns its dot amber with "data 3h old" once the last sync is more than 3 hours old.

**If the Shortcut keeps failing:** the fallback in PLAN.md is the Health Auto Export app (about €8/year) plus an `/api/ingest-hae` adapter. Ask for it when needed.
