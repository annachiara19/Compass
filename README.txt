Compass — Research and people management
========================================

Thesis and PhD students, industry and research projects, deadlines,
meetings, publications and tasks, all in one place. It runs on your PC
and you use it from the browser; your data stays on the PC.


INSTALLATION (once)
-------------------
1. You need Python 3.10 or later (3.13 recommended) from python.org.
   During installation tick "Add python.exe to PATH".
2. Put the Compass folder in Documents (not in Downloads).
3. Double-click "Install Compass.bat": it installs the components and
   creates the Compass icon on the desktop and in the Start menu.
4. On first start you create your user (username and password).


EVERYDAY USE
------------
- Double-click the Compass icon: a small window opens, and the browser
  opens http://127.0.0.1:8797 . Closing the small window stops Compass.
- Today: overdue and upcoming tasks, deadlines in the next 30 days, and
  people you have not met for more than 21 days.
- Tasks: a list (overdue, today, next 7 days…) or a board
  To do / In progress / Done with drag and drop. Press "n" for a new task.
- Calendar: tasks, milestones, deliverables and paper deadlines, by month
  or by week (click a day number to open its week).
- People: for each person, milestones, meetings (each "next step" becomes
  a task with one click), tasks, projects, publications and a profile.
- Projects: deliverables and deadlines, budget and expenses, people
  involved, company contacts, tasks and meetings.
- Publications: from idea to publication, with deadlines and authors.
- Settings > "Download calendar (.ics)": your deadlines in Outlook or
  Google Calendar (it is a snapshot: download it again to update).

To try it out: Settings > "Load sample data". Remove it with one click
when you start adding your own.

Amounts can be typed as 12,500.50 or 12500.50 (Italian style 12.500,50
works too).


BACKUPS
-------
- Compass copies the database at every start and close and keeps the last
  30 copies. From the small window: "Back up now", "Choose folder…",
  "Open folder".
- Choose a university cloud folder (OneDrive or Drive) for backups, so
  nothing is lost if the PC breaks.


MOVING OR SHARING THE DATA
--------------------------
Settings > "Export everything" creates a .compass file with all the data
(people, projects, deadlines, meetings, publications, tasks). Usernames and
passwords are not in it.

On another PC, or for a colleague who receives the file:
- first start: fill in name, username and password, then click
  "Import a .compass file" and choose the file;
- Compass already in use: Settings > "Import…". The data on that PC is
  replaced by the file's (a copy is saved first); the user and password
  stay the same.
The same command restores a copy from the backup folder (.sqlite3).
The .compass file holds personal data about the people you supervise:
send it only to people who should see it.


WHERE THE DATA IS
-----------------
%LOCALAPPDATA%\Compass
  data\compass.sqlite3   the database
  backup\               the copies, unless you chose another folder
  compass.log           log file: useful if something goes wrong


UPDATING COMPASS
----------------
Close Compass, replace the files in the program folder and run
"Install Compass.bat" again. Your data is not touched.


UNINSTALLING
------------
"Uninstall Compass.bat" removes the icons. Your data stays in
%LOCALAPPDATA%\Compass: delete that folder only if you no longer need it.


---
Compass was built by Annachiara Ruospo with the help of Claude (Anthropic).
