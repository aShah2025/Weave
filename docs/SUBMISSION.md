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

## Demo script (2:50)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | The final trailer, first 10 seconds | "This trailer was cut in a Slack thread. Nobody opened a video editor." |
| 0:10 | Slack channel, scrolled through the finished thread | "Video work already happens in chat. Someone writes 'shorten the ending', and then someone has to go do it, export it, and send it back. Weave puts the crew in the channel." |
| 0:25 | Switch Console, Templates, Weave crew, the form, Create all | "This is Switch. One template creates five agents and the channel: a script writer, a producer, an editor, VFX and QC." |
| 0:40 | Console's agent list | "Each one is Claude Code, running on my own login. There's no API key." |
| 0:50 | Typing the `@crew-script` note | "I'm cutting Tears of Steel, Blender's open film, into a trailer. I just ping the script agent." |
| 1:00 | Sped up, labelled: shot list, producer, editor, v1 | "It reads the transcript and looks at frames, then posts a shot list. The producer hands it to the editor. They're addressing each other through Switch, in a thread we can all read." |
| 1:20 | QC's message and the file it downloaded | "QC downloads the file that landed in the room and measures it. It can reject a cut." |
| 1:35 | Typing the `@crew-vfx` note, then v2 | "Now the look. VFX can change color and titles, but not what's in the cut." |
| 1:55 | The teammate's note, then v3 | "My teammate has a note too. Anyone in the channel can talk to the producer. The agents that run commands only take instructions from me and my own agents, and Switch enforces that." |
| 2:15 | Typing `@crew-producer approve`, then the final in the thread | "Only a person can approve. An agent's approval doesn't count." |
| 2:25 | The final trailer, 15 seconds with its credit | "That's the crew's real output." |
| 2:40 | The repo's README | "Without Switch there's no shared thread, no addressing between agents, and no way to pass a video along. Clone it and try it. It's all in the README." |

## Speech for the talking clips (about 2:20)

**On camera, Rishith:** Making a video with a team is mostly chat. Someone writes "shorten the ending", and then somebody has to open an editor, make the change, export it and send it back. So we asked: what if the crew just lived in the chat?

**On camera, Aaditya:** This is Weave. It's five AI agents in a Slack channel: a script writer, a producer, an editor, VFX and QC. They're Claude Code agents, and Switch is what connects them.

**Over the recording, Rishith:** One Switch template creates all five agents and the channel. They run on our own Claude Code login, so there's no API key. We ping the script agent to cut Tears of Steel, Blender's open film, into a 45-second trailer. It reads the transcript, looks at frames, and posts a shot list. The producer hands that to the editor. The editor cuts it and posts a preview, and QC downloads that exact file and measures it. That's all agents addressing each other through Switch, in a thread we can all read. We've sped this part up.

Next we ask VFX for a cinematic look. VFX can change color and titles, but it can't change what's in the cut.

**Over the recording, Aaditya:** I can give a note too. Anyone in the channel can talk to the producer. The agents that run commands only take instructions from the owner and the owner's agents, and Switch enforces that.

**Over the recording, Rishith:** Nothing is final until a person says approve. An agent's approval doesn't count. Here's what the crew made.

*(The trailer plays for 15 seconds, with its credit.)*

**On camera, Rishith:** Without Switch there's no shared thread, no agents talking to each other, and no way to pass a video along.

**On camera, Aaditya:** It's all open source. Clone the repo, follow the README, and you can run this crew yourself.

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
