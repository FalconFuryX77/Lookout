# Lookout extension: privacy

- The extension reads a page **only when you click its button**, and only the tab you are looking at.
- On a job page it reads the job's title, company, location, posting date and description. On a profile page (GitHub, GitLab, Hugging Face, Stack Overflow, Kaggle, LeetCode, Devpost, DEV, Medium, Codeforces, HackerRank, CodeChef, Behance, Dribbble) it reads the page's tags and text to find skills. LinkedIn profiles are never read.
- What it reads is sent **only to Lookout running on your own computer** (`127.0.0.1`). Nothing is sent to any other server, and there is no analytics or tracking.
- On profile pages of the sites above, the toolbar icon shows a small dot. Your browser does that by itself from a fixed list of addresses (`declarativeContent`); the extension is never told which pages you visit.
- It stores three things in your browser: Lookout's port, the pairing key you pasted, and a copy of your profile's skills and years of experience, so it can compare skills while Lookout is closed.
- It asks for permission to read the current tab when you click (`activeTab`), to run its reader on that tab (`scripting`), to keep those settings (`storage`), to mark the icon on profile pages (`declarativeContent`), and to reach Lookout on your computer (`http://127.0.0.1/*`, `http://localhost/*`). It cannot read any site in the background.
- Skills are added to your Lookout profile only when you press "Add … skills to my profile".
- Removing the extension deletes everything it stored.
