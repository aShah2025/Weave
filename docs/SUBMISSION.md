# Submission kit

Everything for the form and the demo video. Items in **[brackets]** aren't true yet. Do them, or change the sentence, before you submit.

## Run of show for the recording

Use a new Slack room made from the **Weave crew** template with the team set to `crew`, and start clean by moving `weave.project.json` and `exports/` out of your clone. Record with Recordly. Each step takes a few minutes, so speed up the waiting and say that it's sped up. The approval and the teammate's note have to come from those real people on their own accounts, because the video says so.

1. Rishith: `@crew-script cut this film into a 45-second trailer. Open on the world and the mystery, build through the robots and the fight, and end on the strongest line. Skip the opening logos and the end credits. Keep the film's 21:9 frame and 24 fps.`
2. Wait for the shot list, v1 and QC's verdict.
3. Rishith: `@crew-vfx give it a cinematic look with teal and orange, dissolves between shots, and a fade out. Add the title TEARS OF STEEL at the start. End with this credit: Tears of Steel (CC) Blender Foundation | mango.blender.org`
4. Wait for v2 and QC's verdict.
5. Teammate: `@crew-producer the ending feels long, shorten the last shot`
6. Wait for v3 and QC's verdict.
7. Rishith: `@crew-producer approve`
8. The final lands in the thread. Play it.

## Script for the video (about 2:40)

Rishith, Aaditya and Mario each have one part, and all three are on screen for the opening and the close. Every line has to be true of the run we show, so change a line if the run goes differently.

### Opening, all three (0:00 to 0:17)

*On screen: all three faces.*

**Rishith:** Making a video with a team is mostly chat.

**Aaditya:** Someone writes "shorten the ending", and then somebody has to open an editor, make the change, export it and send it back.

**Mario:** So we put the whole crew in the chat.

**All three:** This is Weave.

### Rishith: the crew and Switch (0:17 to 0:55)

*On screen: Rishith, then the Switch template, Create all, the new Slack channel, the ping and the shot list.*

Weave is five agents in a Slack channel: a script writer, a producer, an editor, VFX and QC. One Switch template creates all of them and the channel in one step. Each one is Claude Code on our own login, so there's no API key. I ping the script agent to cut Tears of Steel, Blender's open film, into a 45-second trailer. It reads the transcript, looks at frames and posts a shot list in the thread. The producer hands that to the editor. That's agents talking to each other through Switch, where we can all read it.

### Aaditya: cutting and checking (0:55 to 1:33)

*On screen: Aaditya, then v1 landing in the thread and QC's verdict, labelled "sped up".*

The editor works through Weave's own tools, which number every version and won't post an unchanged cut as a new one. When a preview is ready, it attaches the file through Switch. QC downloads that exact file and measures it, then says pass or reject. In a rehearsal it rejected a cut for being half size. The editor couldn't fix that, so the producer stopped and asked us. That one was our bug, and we fixed it. We've sped this part up, because each step takes a few minutes.

### Mario: people stay in charge (1:33 to 2:03)

*On screen: Mario, then his note, v2 and v3, and the person typing approve.*

People stay in charge. I can give a note from my own account: the ending feels long. Anyone in the channel can talk to the producer. The agents that run commands only take instructions from the owner and the owner's agents, and Switch enforces that. VFX handles the look: color, dissolves and titles. And nothing is final until a person says approve. An agent's approval doesn't count. Here's what the crew made.

### The trailer (2:03 to 2:18)

*On screen: 15 seconds of the final trailer, with its credit. Nobody talks.*

### Close, all three (2:18 to 2:40)

*On screen: all three faces, then the README.*

**Rishith:** Without Switch there's no shared thread, no agents talking to each other, and no way to pass a video along.

**Aaditya:** It's all open source. Clone the repo, follow the README, and you can run this crew yourself.

**Mario:** Tears of Steel is by the Blender Foundation, under Creative Commons.

**All three:** We're Weave. Thanks for watching.

### How to record your clips

- Hold the phone sideways at eye level, in a quiet room, with a light in front of you.
- Say the opening line, your part and the close line as three separate clips. Leave a second of silence before and after each one.
- Look at the lens. Reading off a screen right beside it is fine.
- If you can't be in one room, record your lines alone, and the opening and close become a three-way split screen. Everyone says the "All three" lines on their own too, and they get layered.
- Name the files like `mario-open`, `mario-part` and `mario-close`.

## Form answers

**Project title:** Weave

**Tracks:** Track 02, Best Personal or Creative Workflow.

**Project description:**

> Weave is a video crew that lives in your team chat. Video work already happens in chat, where someone writes "shorten the ending" and someone else has to go do it, export it and send it back. With Weave, you ping an agent in the thread instead. A script agent plans the edit, an editor cuts it, a VFX agent does the look, QC measures every version, and a producer keeps it moving until a person approves. It's for small teams that make videos together and don't all know how to use an editor.

**GitHub repository:** https://github.com/aShah2025/Weave

**Demo video:** **[YouTube or Loom link, under 3 minutes]**

**Live demo:** leave blank.

**How did you use Switch in your project?**

> We connected Claude Code. Switch runs five Claude Code agents on our own login, with no API key: a producer, a script writer, an editor, a VFX agent and QC. One Switch template creates all five and the channel. **[It runs on Slack]**, and it also runs in Mattermost, Switch's built-in chat.
>
> The real work is editing video. We cut Tears of Steel, Blender's open film, into a trailer. A person pings an agent, and the agents address each other through Switch to get it done. The script agent posts a shot list, the editor cuts and posts a preview, and QC downloads that file and measures it before it says PASS or REJECT.
>
> **[Our teammates give notes in the same thread.]** Anyone in the channel can talk to the producer. The agents that run shell commands only take instructions from the owner and the owner's agents, through Switch's addressing policies. Only a person can approve the final. Without Switch there's no shared thread, no addressing between agents and no way to pass the video along.

**What did you like about Switch, and what would you improve?**

> What worked: one template gave us a whole crew and a channel in seconds. Agents addressing each other in a thread we could all read made the work easy to follow, and we could step in at any point. Files moved between agents byte for byte, so QC really checked what was posted. Running on our Claude Code login meant no keys to manage.
>
> What got in the way: Console's Mattermost image is amd64 only and crashed under QEMU on Apple silicon until we switched Colima to Rosetta. A bare "approve" didn't reliably reach an agent, so we always mention the producer. Rooms that already exist don't move to a newly connected chat app. Connecting Slack took several tries to get right.
>
> What we'd want next: a built-in limit on agent-to-agent loops, since we had to add our own stop at 12 versions. We'd also like rooms that can move to a new chat app, and video previews that play inside the thread.

## Before you submit

- **Age:** the rules say entrants must be at least 18 or the age of majority, with no parental consent route. Anyone this affects should ask WeMakeDevs first.
- **Names:** list everyone who worked on it under their real names.
- **Credit:** keep the Tears of Steel credit in the trailer, the video and the README.
