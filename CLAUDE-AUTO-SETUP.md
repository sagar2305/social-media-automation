# Claude Code — Auto-Setup Prompt for MinuteWise on This Mac

> **For Mam:** open Terminal, type `claude`, press Enter. When Claude Code opens, paste this whole file as your first message. Claude will read it, explain what's about to happen, and walk you through every step. You only need to type the answers it asks for.

> **For Aditya, before sending this file to Mam:** the API-key block below has placeholder values like `REPLACE_VIRLO_API_KEY_HERE`. You have two options:
> - **Option A (recommended for security):** leave placeholders as-is. Mam's Claude Code will prompt her to paste each one from her password manager when it reaches Step 5.
> - **Option B (zero-friction for Mam):** replace each placeholder with the real key from your own 1Password, then ship this file to her via 1Password's secure-share, onetimesecret.com, or another encrypted channel. **Do not** send a key-filled version over Slack/WhatsApp/email/AirDrop.

---

## ⬇️ Everything below this line is the prompt Claude Code will follow

You are Claude Code, running on Mam's Mac. Your job is to set up the MinuteWise content pipeline end-to-end so she can use the deployed dashboard at its Vercel URL, and so her Mac executes posting cycles automatically.

Mam is not a developer. **Before every command, explain in one short sentence what's about to happen in plain English.** After every command, confirm what you saw and whether it worked. Don't run multiple commands in parallel without acknowledging them — she's reading along.

### Project context (so you know what you're setting up)

- The dashboard is a Next.js app deployed on Vercel. Mam will use it in her browser. **You are not installing the dashboard locally** — skip anything that involves `cd dashboard`.
- The pipeline is a Node/tsx project at the repo root that generates TikTok posts via Gemini, posts via Blotato, and pulls analytics via ScrapeCreators. **This is what you're installing.**
- A small set of `launchd` background jobs makes Mam's Mac the always-on executor — that's how "Run Cycle Now" clicks on the deployed dashboard actually run.

### Hard constraints — read carefully

1. **Never run `bash scripts/setup_launchd.sh` until you have explicitly asked Mam and she has confirmed Aditya has run `bash scripts/teardown_launchd.sh` on his Mac.** This is enforced as Step 0 below. Two Macs with launchd loaded → every cycle double-fires → real money lost.
2. **Never echo API-key values back to Mam in chat** after she's pasted them. Write them to `.env.local` and confirm only "Wrote VIRLO_API_KEY (length 32 chars)".
3. **Never run `npm run cycle`** during setup. It costs real money and creates real TikTok drafts. Only safe testing command is `npm run refresh:quick`.
4. **Never `git add` or `git commit` anything.** `.env.local` is already gitignored; just leave it that way. Setup leaves the working tree dirty — that's fine, Mam doesn't need to commit anything.
5. **If any step errors out, stop immediately**, summarize what happened in plain English, and ask Mam whether she wants you to try a fix or pause for her to ping Aditya. Don't silently retry destructive things.

### Confirmation prompts

Whenever the plan says **ASK MAM:**, stop, ask her exactly the question shown, and wait for her reply before continuing.

---

## Step 0 — Confirm Aditya is ready

**ASK MAM:** "Before I do anything, I need to confirm one thing — has Aditya messaged you to say he ran `bash scripts/teardown_launchd.sh` on his Mac, and that you can take over as the executor? Please answer **yes** or **no**."

- If she answers **no** (or anything ambiguous): tell her *"No problem — I'll wait. Please ping Aditya and ask him to run that command on his Mac, then come back and tell me 'go.'"* Then stop. Do not proceed until she gives an unambiguous yes.
- If she answers **yes**: continue to Step 1.

---

## Step 1 — Check what's already installed

Tell Mam: "I'm going to check whether Homebrew, Node.js, and Git are already on your Mac so I don't reinstall anything you already have."

Run each of these and report the output in plain English:

```bash
which brew
node --version
git --version
python3 --version
python3 -c "import PIL; print('Pillow ' + PIL.__version__)"
```

For each one:
- If you see a version number or a path, say "✅ already installed."
- If you see "command not found" or `No module named 'PIL'`, note it as missing — you'll install it in Step 2.

(Pillow is needed because every posting cycle overlays text onto generated images using `scripts/overlay-text.py`. Without it, cycles will fail mid-flow.)

---

## Step 2 — Install whatever's missing

### 2a. Homebrew (only if `which brew` failed in Step 1)

Tell Mam: "Homebrew isn't installed yet. I'm about to install it. **macOS will prompt you for your Mac login password partway through — that's normal.** You won't see the password as you type."

Run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After it finishes, follow any "Next steps" instructions it printed (e.g. `eval "$(/opt/homebrew/bin/brew shellenv)"`). Confirm with `brew --version`.

### 2b. Node, Git, and Python (only the ones Step 1 showed missing)

Tell Mam: "Now installing the missing runtimes — Node.js runs the pipeline, Git pulls the code, Python handles the text overlays on each image."

Pick only the names that were missing in Step 1 from this list and pass them to brew (Python comes preinstalled on most Macs but `brew install python` is safe and idempotent):

```bash
brew install node git python
```

After it finishes, verify each one that was missing:

```bash
node --version
git --version
python3 --version
```

All three should print version numbers. If any still says "command not found", stop and tell Mam — something's wrong with the brew setup.

### 2c. Install Pillow (the Python image library)

Tell Mam: "One more small package — Pillow lets Python overlay the captions onto each TikTok slide. About 5 seconds."

```bash
pip3 install --break-system-packages Pillow
```

The `--break-system-packages` flag is required on recent macOS (PEP 668 protection) and is safe here — Pillow is a pure userland library, nothing system-level. Verify:

```bash
python3 -c "import PIL; print('Pillow ' + PIL.__version__)"
```

You should see something like `Pillow 10.4.0`. If it fails with `No module named 'PIL'`, stop and tell Mam.

---

## Step 3 — Clone the repo

**ASK MAM:** "Do you already have the project folder at `~/Code/social-media-automation`? Please answer **yes** or **no**."

- If **no**:

  ```bash
  mkdir -p ~/Code
  cd ~/Code
  git clone https://github.com/sagar2305/social-media-automation.git
  cd social-media-automation
  ```

  If `git clone` fails with "permission denied" or "repository not found", stop and tell Mam: *"The clone failed — usually this means GitHub hasn't given you access yet. Can you check your email for a GitHub invitation from `sagar2305/social-media-automation` and accept it, then come back?"*

- If **yes**:

  ```bash
  cd ~/Code/social-media-automation
  git pull
  ```

Verify you're in the right place:

```bash
pwd
ls main.ts package.json
```

You should see the full path ending in `/social-media-automation`, and both `main.ts` and `package.json` should be listed.

---

## Step 4 — Install pipeline dependencies

Tell Mam: "Now I'm installing the small packages the pipeline needs. This takes 1–3 minutes and will print a lot of yellow text — yellow is fine, only red ERROR lines are a problem."

```bash
npm install
```

When it finishes, you should see something like `added 432 packages in 1m`. If you see red error text at the end, stop and show her the error.

---

## Step 5 — Create the `.env.local` file

Tell Mam: "Now I'm going to create the secrets file. The keys live between the BEGIN_KEYS and END_KEYS markers in the prompt I'm reading from. I'll handle two cases — if the keys are already filled in, I'll just write them. If they're still placeholders, I'll ask you to paste each one from your password manager."

Look at the key block below. For each line, check whether the value starts with `REPLACE_` (placeholder) or has a real value.

```
BEGIN_KEYS
VIRLO_API_KEY=REPLACE_VIRLO_API_KEY_HERE
GEMINI_API_KEY=REPLACE_GEMINI_API_KEY_HERE
BLOTATO_API_KEY=REPLACE_BLOTATO_API_KEY_HERE
SCRAPECREATORS_API_KEY=REPLACE_SCRAPECREATORS_API_KEY_HERE
NEXT_PUBLIC_SUPABASE_URL=REPLACE_SUPABASE_URL_HERE
NEXT_PUBLIC_SUPABASE_ANON_KEY=REPLACE_SUPABASE_ANON_KEY_HERE
END_KEYS
```

### 5a. For each placeholder value

**ASK MAM:** "Please paste the value for `<KEY_NAME>` from your password manager (1Password / Bitwarden). It should look like `<expected prefix>...` and be a long string. Paste it exactly as-is, no quotes."

Expected prefixes / hints for each key, so you can give her a sanity check:
- `VIRLO_API_KEY` — usually starts with `virlo_tkn_`
- `GEMINI_API_KEY` — usually starts with `AIzaSy`
- `BLOTATO_API_KEY` — varies, usually 30–60 character random string
- `SCRAPECREATORS_API_KEY` — varies, alphanumeric
- `NEXT_PUBLIC_SUPABASE_URL` — starts with `https://` and ends in `.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — long string starting with `eyJ` (it's a JWT)

If what she pastes obviously doesn't match (e.g. she pastes a Gemini key when you asked for a Virlo key), gently say "That looks like it might be the wrong one — keys for VIRLO usually start with `virlo_tkn_`. Could you double-check?"

### 5b. Write the file

Once you have all six real values, write them to `~/Code/social-media-automation/.env.local` in this exact format (one per line, no quotes, no spaces around `=`):

```
VIRLO_API_KEY=<value>
GEMINI_API_KEY=<value>
BLOTATO_API_KEY=<value>
SCRAPECREATORS_API_KEY=<value>
NEXT_PUBLIC_SUPABASE_URL=<value>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<value>
```

After writing, confirm to Mam: "Wrote `.env.local` with 6 keys (lengths: VIRLO=X, GEMINI=Y, BLOTATO=Z, SCRAPECREATORS=W, SUPABASE_URL=V, SUPABASE_ANON_KEY=U)." **Do not echo the actual values back.**

Then verify the file isn't accidentally tracked by git:

```bash
git check-ignore -v .env.local
```

Should print a line confirming it's ignored. If not, stop and tell Mam — something is unusual.

---

## Step 6 — Safe test that everything is wired

Tell Mam: "Now I'm running the safe test. This pulls analytics from TikTok via ScrapeCreators and confirms your keys all work. It does NOT post anything and doesn't cost any money."

```bash
npm run refresh:quick
```

Expected output looks like:
```
[refresh:quick] starting
[refresh:quick] pulling per-account stats...
[refresh:quick] minutewise · @<handle> · 127k views, 4.2k likes
[refresh:quick] done in 8.2s
```

If you see that, tell Mam: "✅ Test passed — your Mac is talking to Supabase and ScrapeCreators correctly."

If you see errors:
- `Missing env var X` → typo in `.env.local`, go back to Step 5 for that one key.
- `401`/`403` → wrong API key value. Go back to Step 5 for that key.
- `ENOTFOUND` / `Network error` → tell Mam her Wi-Fi might be down and wait.
- Anything else → stop, show her the error message, ask if she wants to ping Aditya.

---

## Step 7 — Become the always-on Mac (launchd setup)

Before running the next command, **re-confirm**:

**ASK MAM:** "Final check: Aditya confirmed he ran `teardown_launchd.sh` on his Mac, right? Saying yes here means I'll set up the background jobs that make your Mac the always-on executor. If you're not sure, say no and I'll pause."

- If she says anything other than a clear yes, stop. Tell her: *"Pinging Aditya is the safe move — I'll wait."*
- If she says yes:

```bash
bash scripts/setup_launchd.sh
```

Tell her in plain English what just happened: "I registered four small background jobs with macOS. They run silently and handle: (1) firing the daily 7 PM posting cycle, (2) checking for Run Cycle Now clicks every 60 seconds, (3) firing scheduled batches at their set times, and (4) running a daily analytics refresh."

---

## Step 8 — Verify launchd loaded

```bash
launchctl list | grep minutewise
```

You should see exactly four lines, each starting with something like `com.minutewise.*`. Tell Mam: "✅ All four background jobs are loaded. Your Mac is now the always-on executor."

If you see fewer than four lines, stop and tell her — the setup didn't fully load. Ask if she wants you to try `setup_launchd.sh` again or pause.

---

## Step 8b — Prevent the Mac from sleeping during posting hours

Tell Mam: "Last technical step — I'm telling your Mac not to sleep when it's plugged in. If the Mac sleeps, the background jobs pause and Run Cycle clicks from the dashboard get stuck in 'Queued…' until the Mac wakes up. macOS will ask for your login password — that's normal."

```bash
sudo pmset -c sleep 0 disksleep 0 displaysleep 30
```

Plain-English breakdown of what that does:
- `sleep 0` — never put the whole machine to sleep when on AC power.
- `disksleep 0` — never spin down the disk (important: the pipeline writes lots of files).
- `displaysleep 30` — the screen still turns off after 30 minutes (saves the monitor, doesn't stop background jobs).

Verify it took effect:

```bash
pmset -g | grep -E "sleep|disksleep|displaysleep"
```

You should see `sleep` and `disksleep` at `0`. If they're still at their old values, stop and tell Mam.

(If the manager works on battery sometimes and prefers the laptop to sleep when unplugged — that's already the default. The command above only affects plugged-in behaviour.)

---

## Step 9 — Wrap up

Tell Mam exactly the following, formatted as a checklist:

> 🎉 **Setup complete!**
>
> **What you need from Aditya (if he hasn't sent them yet):**
> - The dashboard URL (looks like `https://<something>.vercel.app`)
> - An invitation to sign in (he needs to add your email in Supabase)
>
> **Once you have those:**
> 1. Open the dashboard URL in your browser
> 2. Sign in with your work email
> 3. That's it — you can use the dashboard like any normal website
>
> **One important habit:** keep your Mac plugged in and turned on. I've already told it not to sleep while on AC power (Step 8b), so as long as the charger is connected, the background jobs will keep running. If you unplug and go on battery, the Mac may sleep when the lid closes — that's fine, just be aware it'll catch up the next time you plug back in.
>
> **For the full reference guide**, including troubleshooting and what to never do, open the file `SETUP-MAC.md` in this folder.
>
> **If anything breaks later**, take a screenshot of what you see and send it to Aditya — most problems are 30-second fixes once we see the actual error.

Then output a short summary of everything you did (which tools you installed, that you wrote `.env.local`, that launchd loaded four jobs, that the safe test passed). End with: "You can close Terminal now if you want — the background jobs will keep running. Welcome to the team. 👋"

---

## What to do if you (Claude Code) get stuck

If at any point you hit something this prompt doesn't cover — an unexpected error, a question Mam asks that requires Aditya's input, a step that's already half-done from a previous attempt — **do not improvise destructively**. Tell Mam in plain English what you saw, what you would have done next, and ask whether she wants you to (a) try anyway, (b) pause and ping Aditya, or (c) skip the step and continue.

The order of preference is: **be honest > be safe > be fast**. Mam can absorb a slower setup. She can't absorb you accidentally double-firing the daily cycle.
