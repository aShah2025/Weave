# AGENTS.md

Rules for everyone working on Weave until the deadline: Rishith, Aaditya, Mario, and the coding agents each of us runs. Agents: read this before you change anything, and stick to the work of the person you're running for.

## The goal

Win **Flip the Switch** (WeMakeDevs x Switch) with the review room: a person gives a note in team chat, and a producer, an editor and a QC agent turn it into a checked new cut that only a person can approve.

**Submissions close Saturday, Nov 7, 2026 at 10:29 AM PT (11:59 PM IST).**

We're entering **Track 02, Best Personal or Creative Workflow**, because making a video is creative work and the room is built around it. Track 01 (Business) also fits. Mario makes the final call on the form.

## Who does what

Tick a box and push when it's done, so nobody has to ask.

### Rishith (`rishith-c`): the live room

Owns `switch/` and the agents' instructions.

- [x] Run the whole loop on Mattermost: v1, `cut the pricing part`, v2, `approve`, final export.
- [ ] Connect Slack in Console and run the room there. Mattermost is enough for the rules, so if Slack isn't working by the freeze, we ship on Mattermost.
- [ ] Record one clean screen capture of a full run and give it to Mario, with a person typing the notes and the approval. Start from a clean state (see the end of this file).

### Aaditya (`aShah2025`): it has to run on someone else's machine

Owns `src/`, `bin/`, `test/`, `web/`. Repo admin.

- [ ] Clone `main` on a machine that has never run Weave and follow the README word for word. Judges will do exactly this. Fix or report every place it breaks.
- [ ] Run the room on real footage, attached in chat instead of given as a path. Nobody has tried this yet. In the demo run QC also read `scripts/demo-talk.txt`, so check that it still judges a cut properly when there's no script to read.
- [ ] Fix whatever those two runs turn up in the editing tools.
- [ ] Check the README's Studio section. Its registration key steps need an API Keys screen that Console 0.40.1 doesn't have.

### Mario (`mario-lindev`): the demo video and the submission

Owns `README.md`, the video and the form.

- [ ] Tonight: confirm our team is registered and find the submission form. The hackathon page doesn't link one, so start at **Register now**, then ask in the WeMakeDevs Discord.
- [ ] Write the script and cut the demo video from Rishith's capture. Show the note, the QC verdict and the person approving. The page sets no length, so keep it under 3 minutes.
- [ ] Read the README the way a judge would. How Switch is used should be clear from the first screen.
- [ ] Submit, with everyone who worked on it listed under their real names.
- [ ] Only if everything above is done: write a post for the Best Blog side track.

## Schedule

All times PT.

| When | What |
| --- | --- |
| Friday night | Clean-clone test started. Registration and the form confirmed. Slack connected. |
| Saturday 8:00 AM | Code freeze. README and bug fixes only after this. |
| Saturday 9:00 AM | Demo video uploaded. |
| Saturday 9:45 AM | Submitted. |
| Saturday 10:29 AM | Submissions close. |

## Rules

1. **`main` is what judges clone, so it always has to run.** Run `npm test` before every push and `git pull --rebase` before you start. Anything risky goes on a branch. Never force-push `main`.
2. **Stay in your own area.** Tell the owner before you change their files.
3. **Only claim what someone has actually run.** That covers the README, the video and the form. If something is untested, say so. The demo shows a real run, not a staged one. False or misleading information is grounds for disqualification.
4. **The chat is the product.** No new UI. Studio stays optional, and nothing in the room depends on it. Judges ask whether the project would stop working without Switch, and the answer has to stay yes.
5. **Only a person can approve.** No agent gets to approve a final export. The editor and QC stay on `addressing: owner-agents`, because they can run shell commands.
6. **Test template changes in a new room.** Agents keep the instructions they were created with, so after editing `switch/weave-room.template.yaml`, import it, create a new room and run the loop before you push.
7. **No secrets in git or chat.** API keys and Slack tokens go into Console or your own `.env`, never into a commit, a message or a prompt. Agents don't read `.env` or Console's secret stores.
8. **Keep it MIT.** Don't copy AGPL code such as OpenMontage into this repo, and follow the license of anything we use.
9. **Understand what you ship.** AI tools are allowed, but each of us has to be able to explain how the project works. Agents: say why in the commit message when a change isn't obvious.
10. **Don't add features after the freeze.** Before it, a fix to the loop beats a new feature.

## Hackathon rules

Checked on Nov 6 against the [hackathon page](https://www.wemakedevs.org/hackathons/switch) and its [rules](https://www.wemakedevs.org/hackathons/switch/rules). If this list and the pages disagree, the pages win.

**A submission needs:**

- A workflow where at least one agent and one person finish a real task together in team chat.
- A README that shows how Switch is used.
- A demo video.

**Judges look at:**

- **Use of Switch:** is it central, and would the project break without it?
- **Technical execution:** does it run, and can someone clone the repo and reproduce it?
- **Creativity and impact:** is it a fresh idea that solves a problem a real team has?
- **Presentation:** do the video and README make the use of Switch clear?

**Who can enter:**

- Entrants must be "at least 18 years of age", or the age of majority where they live if that's higher. The rules mention no parental consent route. Anyone this affects asks WeMakeDevs before we submit, and we don't work around it.
- Teams are 1 to 4 people.
- Each entrant uses one accurate, verifiable identity, and the organizers may check it before paying a prize.
- The work has to be ours or properly licensed. We keep ownership and give the organizers a license to host and promote it.

**Side tracks:**

- **Best Blog** and **Code with Wispr** can be added to any main track.
- Wispr needs a real usage scorecard from Wispr Flow, so we only enter it if someone actually built by voice.

## Where things stand

Update this list as things change. It's the honest version of the README.

**Proven:**

- The full loop in a live room on Mattermost, run on Nov 6 with the demo talk and no terminal: note, v1 (54.84 s), `cut the pricing part`, v2 (42.84 s), QC PASS, `approve`, `final.mp4` (1280x720, 3.7 MB) in the thread. Each cut took about two minutes from note to verdict, and the export took 14 s. We also measured v2 ourselves: no pricing words left and the neighbouring lines intact.
- An MP4 goes from the editor to QC byte for byte and plays in chat.
- The editor and QC take instructions from the producer on `owner-agents`.
- `npm test` passes.

**Not proven yet:**

- Someone attaching footage in chat.
- Real footage rather than the demo talk.
- QC rejecting a bad cut and the editor fixing it. Every verdict so far has been PASS.
- A second person in the room, including the editor and QC refusing their instructions.
- Slack.
- A clean clone on another machine.

## Things that already cost us time

- **For a clean start,** delete `weave.project.json` and `exports/` from your clone, then create a new room. Otherwise the timeline carries over and versions keep counting from the last run.
- **Always mention the producer:** `@weave-producer approve`. A bare `approve` may never reach it.
- **After a Colima restart,** run `docker start switchdash-local-mattermost-mattermost-1`. Its restart policy is `no`.
- **If Mattermost goes unhealthy or uploads fail,** check free disk first. A full disk turned Docker's disk read-only on us. `colima ssh -- sudo dmesg` shows it, and `colima restart` clears it.
- **If Console says the local server isn't running,** press **Start**. Relaunching the app doesn't start it.
- **To connect Slack,** go to Home, Messaging apps, Connect, Use your own app instead, Slack. Name the connection exactly `Slack`, or the template won't find it.
- **Attachments cap at 20 MiB.** Don't post an export over that.
- **Keep `av==15.1.0`** in `scripts/transcribe.py`. Newer PyAV breaks faster-whisper 1.2.1.
