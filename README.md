# Lookout

<img src="public/logo.svg" width="64" align="right" alt="">

Lookout is a local scanner that tracks startup jobs and internships close to real time. It watches startups that have just raised money, polls their careers pages every minute or two, deduplicates roles across every source, finds who to contact, and pushes matches to your phone.

## Run it

You need Node.js 20 or newer. There are no dependencies to install.

```powershell
npm start        # or: node server.mjs
```

Open <http://127.0.0.1:4173>. Keep the computer awake: scanning only happens while the server runs.

### Windows app

`Lookout.exe` is a native window with a notification-area icon. It starts the scanner for you, and closing the window keeps scanning in the tray (use **Exit Lookout** in the tray menu to stop).

- Build it: `.\build-desktop.ps1` (uses `desktop\Lookout.cs`, the WebView2 SDK in `webview2-sdk`, and `desktop\lookout.ico`)
- Desktop + sign-in shortcuts: `.\setup-desktop.ps1` (`-Uninstall` removes them; it also removes old "Startup Signal" shortcuts)
- Regenerate the icon from the logo design: `.\desktop\make-icon.ps1`

## How it gets jobs early

| Layer | What | How often |
|---|---|---|
| **Company careers boards (ATS)** | Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, plus each YC company's own Work at a Startup postings | watched companies: 1 min · freshly funded: 2 min · other recent YC: 10 min |
| **Funding signals** | TechCrunch, Crunchbase News, Entrackr, Inc42, YourStory, Google News (seed/Series A), and the last 6 YC batches (yc-oss) | every 5 min (YC data every 6 h) |
| **Auto-discovery** | For every funded company: find its website, detect its ATS, and start watching it | continuous, in the background |
| **Founder-posted roles** | HN "Who is hiring" (new comments only), HN YC job posts | 1 min |
| **Curated lists** | SimplifyJobs internships + new grad, vanshb03, India Tech Internships (Sarthzk), InternScan IN/US | 2–30 min (uses ETag, so it's cheap) |
| **Job boards** | Startup.jobs, Remote OK, We Work Remotely, Himalayas, Jobicy, Arbeitnow, Remotive | 2 min – 6 h (respects each API's terms) |

The pipeline is **funding → careers board → alert**. A startup that raises a seed round is detected from the news. Lookout then locates its board and polls it every 2 minutes, so its first hires reach your phone within minutes of being posted. This copies what Tsenta does: it watches company career pages directly instead of waiting for aggregators.

Every listing keeps links to every source that carried it. Each funding signal links to the article it came from.

## It finds new sources on its own

Lookout keeps growing its own coverage:

- **Board harvesting.** Every link it sees (Simplify/vanshb03 rows, HN posts, auto-discovered lists, company sites) is checked for a Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee board. Each new one is added and polled directly from then on. Within 30 seconds of the first start it was already watching ~700 boards.
- **YC directory.** Every YC company marked as hiring is watched through its own YC page, plus the ATS board found on its website.
- **GitHub list discovery.** Every 6 hours it searches GitHub for new curated internship and new-grad repos. It checks each one's data (shape plus freshness), adds it as a source, and **retires** any list that only repeats jobs other sources already found.
- **Adaptive polling.** Boards are polled every 1 min (you asked), 2 min (just raised), 3 min (posted in the last 3 days), 10–30 min (quiet), or 60 min (YC pages). Boards that keep failing back off to 6 hours, and dead ones are dropped.
- **Yield tracking.** Each source shows how many *unique* roles it found first. You can see what's actually pulling its weight.

The **Sources** page shows all of this live: boards by poll speed, where new sources came from, and a running discovery log.

## Deduplication

Two listings count as the same role when:

- their canonical URLs match (tracking parameters stripped), **or**
- the normalized company name (Inc/Labs/YC batch tags removed) plus the normalized title (seasons, years, "Remote", and "SWE"/"SDE"/"Developer" synonyms collapsed) match, and their countries don't conflict.

Merged listings keep the most precise and earliest posting time, the longest description, and the union of skills and emails. The UI shows "3 sources" so you can see when a role was confirmed by several sources.

## Using it

- **Filters** (press F; active filters show as removable chips above the list):
  - **Field**: Software & IT, Core Engineering, Product & Design, Business, Science & Research. Click once to include, twice to exclude (e.g. hide all mechanical/civil/electrical roles).
  - **Role**: 30+ specialties (AI/ML, data science, data engineering, analytics, frontend, backend, full-stack, mobile, DevOps/cloud, security, QA, embedded, IT & support, quant, …)
  - **Years of experience**: dual slider and presets. Choose whether to include roles that don't say.
  - **Visa sponsorship**: sponsors, no sponsorship, citizens/clearance only, not stated. One click for "I need sponsorship".
  - **Work mode, location, minimum pay** (converted to USD/yr from $, ₹, LPA, €, £, hourly, monthly), **degree, internship term**
  - **Company**: recently funded only, funding stage (YC, seed, Series A, B+), hidden companies
  - **Skills** (has any / has all), **source**, "confirmed by 2+ sources", excluded keywords, has contact email
  - search syntax: `intern python | go -senior` (spaces mean AND, `|` means OR, `-` means NOT)
- **Keyboard**: Ctrl K command menu, / search, J/K move, Enter apply, S save, E draft email, X hide, F filters, Esc close.
- **Saved views** (sidebar): save any filter combination. Turn the bell on and every new match pushes to your phone. Each view shows how many roles match; green `+N` means new in the last hour.
- **Job panel:**
  - skills grouped by area
  - requirement bullets pulled from the posting
  - funding signal
  - all sources
  - **Who to contact** (see below)
  - pipeline status and notes
- **Draft outreach email:** opens your mail app with a personalized draft, using your profile, the skills you share with the role, the founder's first name, and their latest round. The draft is also copied to the clipboard.
- **Hiring signals:** every funded company, whether Lookout found its careers board, and how many roles it has open.
- **My pipeline:** saved → applied → contacted → interviewing → closed.
- **Sources:** live health of each source. Paste any careers page URL to watch that company every minute.

## Who to contact

For each company, Lookout looks only at **published** sources and shows where each address was found:

1. Emails written in the job post itself (common in HN posts)
2. The company website: home, /contact, /about, /team, /careers, /jobs, and `/.well-known/security.txt`
3. The public email on the company's GitHub organization
4. Founders listed on the company's YC profile, with LinkedIn and X links
5. Official social profiles linked from the website

If none of those turns up a personal address, it shows **pattern guesses** (`first@domain`) clearly labelled *Guess*. Verify a guess before you rely on it. Lookout never uses data brokers or breach data, and it never sends email for you.

## Phone alerts

1. Install **ntfy** (free, Android/iOS) and subscribe to a long random topic.
2. In **Alerts & profile**, enter the same topic, then press **Send test push**.
3. Turn 🔔 on for the filter sets you care about.

Each push has **Open listing** and **Email** buttons. Bursts of more than 4 matches are combined into one digest. Quiet hours are supported.

Alerts fire only for roles that are actually new. Startup imports and old listings never buzz your phone.

Anyone who guesses a public ntfy.sh topic can read it. For private alerts, use your own ntfy server and a token.

## Limits

- "Real time" means polling. Most sources are checked every 1–2 minutes, but a source can be slow to publish, and nothing runs while the computer sleeps.
- Some listings carry only a date, not a time (marked "date only"). They never count toward last-hour windows unless Lookout first saw them in that window.
- Wellfound, LinkedIn, and YC's logged-in Work at a Startup block automated access, so they are not scraped.
- India-specific coverage comes from InternScan India, the Sarthzk tracker, India funding news (Entrackr, Inc42, YourStory), and auto-watched boards of Indian startups. It grows as more funded companies are discovered.
- Skills come from a ~300-term vocabulary matched against the listing text. They are a fast index, not a substitute for reading the post.

## Files

```
server.mjs          scheduler, alerting, HTTP API, live updates (SSE)
src/sources.mjs     job source adapters
src/ats.mjs         ATS detection and polling
src/funding.mjs     funding feeds, headline parser, YC batches
src/contacts.mjs    published-contact discovery
src/discovery.mjs   board harvesting, GitHub list discovery, adaptive polling
src/taxonomy.mjs    field/role, years, visa, work mode, degree, pay, term
src/dedupe.mjs      cross-source dedupe
src/enrich.mjs      skills, requirements, level, type, country, salary
src/store.mjs       persistence (data/db.json)
src/notify.mjs      ntfy push
public/             UI (index.html, app.js, app.css, filters.mjs, logo.svg)
```

All data stays in `data/db.json` on this computer.
