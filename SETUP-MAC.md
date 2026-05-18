# MinuteWise — Mac Setup Guide

A step-by-step guide to set up your Mac so it can run the TikTok content pipeline. After this is done, you'll be able to use the deployed dashboard in your browser like a normal website, and clicks like "Run Cycle Now" will actually do work on your Mac in the background.

Plan to spend about **20–30 minutes** the first time. Most of it is just waiting for downloads.

---

## What you're setting up, in plain English

Think of it like this:

- The **dashboard** is a website. You'll open it in your browser. You do not install it on your Mac.
- The **pipeline** is the program that does the actual work — making posts with AI, posting them to TikTok, pulling view counts back. **That program runs on your Mac.**
- The two halves talk to each other through a shared database. So when you click "Run Cycle Now" on the website, the website saves a note in the database that says "please run a cycle." Your Mac sees the note 60 seconds later and starts the work.

**This is why your Mac has to be on and awake** during the times posts should fire.

---

## Before you start — a quick checklist

- [ ] Your Mac is plugged in (some of this can take a while)
- [ ] You're on a stable Wi-Fi connection
- [ ] You know your Mac's login password (some installs ask for it)
- [ ] You have a code editor installed — if you don't, install **Cursor** from https://cursor.com (free download). It's like Microsoft Word for code.
- [ ] You have a password manager like **1Password** or **Bitwarden** — Aditya will share secret keys with you through it, so you need a way to receive them safely.

If any of those aren't ready, sort them first.

---

## Step 1 — Open Terminal

Terminal is the Mac app you'll type commands into.

- Press **Cmd + Space** (this opens Spotlight search).
- Type `Terminal` and press **Enter**.
- A black or white window opens with some text and a blinking cursor.

You're now in Terminal. From here on, when this guide says "type this" or "paste this", do it inside that window and press **Enter** to run it.

> 💡 Tip: To paste in Terminal, use **Cmd + V** (same as anywhere else).

---

## Step 2 — Install the tools your Mac needs

You need three things: a thing called **Homebrew** (it installs other things), **Node.js** (the language the pipeline is written in), and **Git** (used to download the code).

### 2a. Install Homebrew

Paste this into Terminal and press Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It'll print a lot of text and at some point ask for **your Mac login password**. Type it (you won't see the characters as you type — that's normal) and press Enter.

This takes 2–5 minutes. When it's done you'll see a "Next steps" message at the bottom.

**Already have Homebrew?** Type `brew --version` — if you see a version number like `Homebrew 4.x.x`, skip this step.

### 2b. Install Node.js and Git

Paste this:

```bash
brew install node git
```

Takes 1–3 minutes.

### 2c. Check that everything worked

Paste each of these one at a time:

```bash
node --version
git --version
```

You should see version numbers (for example `v22.5.1` and `git version 2.45.2`). If you see "command not found" for either, ask Aditya — something went wrong with the install.

---

## Step 3 — Get access to the code

The code lives on GitHub (think of it like Google Drive but for code).

1. Ask Aditya / Sir to add you to the GitHub project called **`sagar2305/social-media-automation`** as a collaborator.
2. You'll get an email from GitHub. Open it and click **"Accept invitation"**.
3. If you don't already have a GitHub account, the invitation link will walk you through making one.

---

## Step 4 — Download the code to your Mac

In Terminal, paste these one at a time:

```bash
mkdir -p ~/Code
cd ~/Code
git clone https://github.com/sagar2305/social-media-automation.git
cd social-media-automation
```

What this does:
- Makes a folder called `Code` in your home directory (where all your projects can live).
- Goes into that folder.
- Downloads the project from GitHub (this is the `git clone` line — takes 30 seconds or so).
- Goes into the downloaded project folder.

**After this, every command in this guide assumes Terminal is sitting inside this `social-media-automation` folder.** If you close Terminal and come back later, get back here with:

```bash
cd ~/Code/social-media-automation
```

---

## Step 5 — Install the project's dependencies

The project needs a bunch of smaller programs to do its work. This downloads them all in one go.

Paste:

```bash
npm install
```

Takes 1–3 minutes. You'll see lots of progress dots and warnings. **Yellow warnings are normal — ignore them.** Only stop if it says "ERROR" in red at the end.

When it's done you'll see something like `added 432 packages`.

---

## Step 6 — Create your secrets file

This is the most important step. There's a file called `.env.local` that holds all the API keys (passwords for talking to TikTok, Gemini, etc.). **This file is unique to your Mac — Aditya won't email it to you, you'll create it yourself and paste in the values he shares with you.**

### 6a. How to get the values

Ask Aditya to share these six values with you through your **password manager** (1Password / Bitwarden). Tell him:

> "Hi Aditya, please share VIRLO_API_KEY, GEMINI_API_KEY, BLOTATO_API_KEY, SCRAPECREATORS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY via 1Password (or whichever secure tool you both use)."

⚠️ **Don't accept these values over Slack, WhatsApp, or email.** Those services store messages on servers and the keys could be stolen if any of those accounts is ever compromised. A password manager is the only safe way.

### 6b. Create the file

While you wait for the values, set up the file. In Terminal, paste:

```bash
open -a Cursor .env.local
```

(If you installed VS Code instead of Cursor, use `open -a "Visual Studio Code" .env.local`.)

The editor will open with a new blank file called `.env.local`. Paste this template into it:

```
VIRLO_API_KEY=
GEMINI_API_KEY=
BLOTATO_API_KEY=
SCRAPECREATORS_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Once Aditya has shared the values with you, paste each one **right after the equals sign**, no quote marks, no spaces. For example after pasting it should look like:

```
VIRLO_API_KEY=virlo_tkn_abc123xyz...
GEMINI_API_KEY=AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxx
BLOTATO_API_KEY=...the value...
...etc...
```

**Save the file** (Cmd + S) and close the editor.

### 6c. Important things to know about this file

- It's called `.env.local` (notice the dot at the start — that's intentional). Mac usually hides files starting with a dot. In Finder you can press **Cmd + Shift + .** to show them.
- This file is **automatically prevented from being uploaded to GitHub** by a setting in the project. Don't try to override that — these keys must stay only on your Mac.
- If you ever need to update a value, just open the file again and edit it.

---

## Step 7 — Test that it all works

This is the safe test — it only reads data, doesn't post anything, doesn't cost any money.

In Terminal, paste:

```bash
npm run refresh:quick
```

What should happen:
- You'll see lines like `[refresh:quick] pulling per-account stats…` and account names with view counts.
- At the end: `[refresh:quick] done in 8.2s` (or whatever the time was).

**If you see that, your Mac is talking to the database and the analytics service correctly. Setup is 90% done.** 🎉

### What if you see errors instead

- **"Missing env var X"** — You forgot to paste a value into `.env.local`, or you have a typo. Open the file again and double-check.
- **"401 Unauthorized" or "403 Forbidden"** — One of your API keys is wrong. Re-copy it from the password manager.
- **"ENOTFOUND" or "Network error"** — Wi-Fi problem. Check your connection.
- Anything else — copy the error message, send it to Aditya, ask for help.

---

## Step 8 — STOP. Coordinate with Aditya before continuing.

The next step is what turns your Mac into the "always-on machine" that fires posts automatically. **Only one Mac in the team can be that machine at a time.**

If Aditya's Mac is currently the always-on machine and you also turn yours on, **every post will fire twice** — double posts on TikTok, double the AI bills.

So before Step 9: send Aditya a message like:

> "I'm at Step 9 of the setup. Can you turn off your launchd ([run `bash scripts/teardown_launchd.sh` on your Mac]) so I can take over as the executor?"

He should run that command on his Mac and confirm with you. **Then** continue to Step 9.

---

## Step 9 — Become the always-on machine

In Terminal, paste:

```bash
bash scripts/setup_launchd.sh
```

What this does, in plain English: it tells your Mac "automatically run these four small programs in the background, all the time, even when I'm not using Terminal."

The four programs:

| Program | What it does |
|---|---|
| Daily flow | Every day at 7:00 PM, automatically generates posts for the day |
| Jobs poller | Every 60 seconds, checks "did anyone click Run Cycle Now on the website?" — if yes, runs that cycle |
| Scheduler tick | Fires the scheduled batches you set up in the dashboard at the right times |
| Daily refresh | Once a day, pulls the latest view counts and updates the dashboard charts |

To check they're running, paste:

```bash
launchctl list | grep minutewise
```

You should see **four lines**, each with `com.minutewise.something`. If you see four lines, you're the always-on machine now. 🎉

If you see zero lines, the setup didn't load — let Aditya know.

---

## Step 10 — Get the dashboard URL

Aditya / Sir is deploying the dashboard to a service called **Vercel**. Once he's done that, he'll give you a URL that looks something like `https://something.vercel.app`.

- Bookmark that URL.
- Sign in with your work email.
- That's it — you can now use the dashboard like any normal website.

> 💡 Aditya will also need to invite you to the dashboard's user list (in Supabase) and give you the right role. If you sign in and the dashboard says "Forbidden" or shows nothing, ping him.

---

## Day-to-day, what does this look like?

Most days you don't touch Terminal at all. You:

1. Wake up your Mac in the morning. (Don't put it to sleep at night during posting hours — see "Keep your Mac awake" below.)
2. Open the dashboard URL in your browser.
3. Click around. View posts. Approve payouts. Check analytics. Use "Run Cycle Now" whenever you want to fire a manual cycle.
4. The Mac does its work in the background. You don't need to watch it.

That's it.

---

## Keep your Mac awake during posting hours

The pipeline can only run if your Mac is **on AND awake**. Sleep counts as "off" — scheduled cycles won't fire.

To stop your Mac sleeping:

1. Click the **Apple menu** (top left) → **System Settings**.
2. Search for "Lock Screen" (or "Energy Saver" on older macOS).
3. Set **"Turn display off when inactive"** to a longer time (or "Never"), and **"Start Screen Saver when inactive"** to a longer time.
4. If you have a laptop and want it to keep running with the lid closed, plug it in and search **System Settings → Battery → Options → Prevent automatic sleeping on power adapter when display is off**. Enable that.

Easiest test: leave it overnight one night and check the next morning that the 7 PM cycle fired. (Open the dashboard, look at the Runs page.)

---

## If something goes wrong

### "Run Cycle Now" doesn't seem to do anything when I click it

- Is your Mac on right now?
- In Terminal, paste: `launchctl list | grep minutewise`
- You should see four lines. If you don't, run `bash scripts/setup_launchd.sh` again.
- If you see four lines but cycles still aren't firing, check the log:
  ```
  tail -50 data/cycle-logs/jobs-poller.log
  ```
  Send the last 20 lines to Aditya if anything looks like an error.

### The 7 PM daily cycle didn't fire

- Was your Mac awake at 7 PM? (Sleep counts as off.)
- Check the log:
  ```
  tail -50 data/cycle-logs/launchd-daily.log
  ```

### Cycles run but errors show up in the dashboard

- Open the dashboard → **Errors & Auto-Fix** page (in the sidebar).
- Most errors have a one-line explanation. If it's a Gemini quota limit, you can usually just wait an hour and retry.

### I closed Terminal and don't know how to get back

Open Terminal (Cmd + Space → "Terminal") and paste:

```bash
cd ~/Code/social-media-automation
```

You're back where you need to be.

---

## When you go on holiday / want to stop being the always-on machine

Hand the role back to someone else (Aditya, another teammate). On your Mac:

```bash
bash scripts/teardown_launchd.sh
```

Then check:

```bash
launchctl list | grep minutewise
```

If it prints **nothing**, you've successfully handed off. The other person can now run `bash scripts/setup_launchd.sh` on their Mac.

---

## Things you should NEVER do

1. **Never share API keys or `.env.local` in Slack, WhatsApp, email, or screenshots.** Always use a password manager.
2. **Never run `bash scripts/setup_launchd.sh` without confirming Aditya has run teardown first.** Double-firing posts = real money lost.
3. **Never run `npm run cycle` casually.** It creates real TikTok drafts and costs real money in AI bills. Only do it when you actually want to generate posts. For testing, always use `npm run refresh:quick` — that one is free and safe.
4. **Never delete the `.env.local` file by mistake.** If you do, you'll need Aditya to share all the keys again. Make a backup in your password manager once it's filled in.
5. **Never commit `.env.local` to GitHub.** It's automatically blocked, but don't fight the block.

---

## Cheat sheet — commands you'll actually use

Run these from Terminal, inside `~/Code/social-media-automation`.

| What you want | Command | Safe to run? |
|---|---|---|
| Check that everything's still working | `npm run refresh:quick` | ✅ Free, no posts created |
| Pull the latest TikTok view counts | `npm run analytics` | ✅ Free |
| Full daily refresh including trends research | `npm run refresh` | ⚠️ Uses some Virlo credits |
| Manually fire one full cycle right now | `npm run cycle` | 💸 Costs AI money + creates TikTok drafts |
| See what background jobs are loaded | `launchctl list \| grep minutewise` | ✅ Just a status check |
| Take over as the always-on machine | `bash scripts/setup_launchd.sh` | ⚠️ Coordinate with Aditya first |
| Stop being the always-on machine | `bash scripts/teardown_launchd.sh` | ✅ |
| Get back to the project folder in Terminal | `cd ~/Code/social-media-automation` | ✅ |

---

## Need help?

If anything in this guide doesn't behave the way it says, take a screenshot of what you're seeing in Terminal and send it to Aditya. Don't try random fixes — most issues are 30-second fixes once we see the actual error message.

Welcome to the team. 👋
