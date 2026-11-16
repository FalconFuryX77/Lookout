# Lookout extension: privacy

- The extension reads a page **only when you click its button**, and only the tab you are looking at.
- What it reads (the job's title, company, location, posting date and description) is sent **only to Lookout running on your own computer** (`127.0.0.1`). Nothing is sent to any other server, and there is no analytics or tracking.
- It stores three things in your browser: Lookout's port, the pairing key you pasted, and a copy of your profile's skills and years of experience, so it can compare skills while Lookout is closed.
- It asks for permission to read the current tab when you click (`activeTab`), to run its reader on that tab (`scripting`), to keep those settings (`storage`), and to reach Lookout on your computer (`http://127.0.0.1/*`, `http://localhost/*`). It cannot read any other site in the background.
- Removing the extension deletes everything it stored.
