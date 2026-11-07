# Submission kit

Everything for the form. Items in **[brackets]** aren't true yet. Do them, or change the sentence, before you submit. The final video is 2:53, cut from the real run in `#crew-review`.

## Form answers

**Project title:** Weave

**Tracks:** Track 02, Best Personal or Creative Workflow.

**Project description:**

> Weave is a video crew that lives in your team chat. Video work already happens in chat, where someone writes "shorten the ending" and someone else has to go do it, export it and send it back. With Weave, you ping an agent in the thread instead. A script agent plans the edit, an editor cuts it, a VFX agent does the look, QC measures every version, and a producer keeps it moving until a person approves. It's for small teams that make videos together and don't all know how to use an editor.

**GitHub repository:** https://github.com/aShah2025/Weave

**Demo video:** **[YouTube or Loom link, under 3 minutes]**

**Live demo:** leave blank.

**How did you use Switch in your project?**

> We connected Claude Code. Switch runs five Claude Code agents on our own login, with no API key: a producer, a script writer, an editor, a VFX agent and QC. One Switch template creates all five and the channel. It runs on Slack, and it also runs in Mattermost, Switch's built-in chat.
>
> The real work is editing video. We cut Tears of Steel, Blender's open film, into a trailer. A person pings an agent, and the agents address each other through Switch to get it done. The script agent posts a shot list, the editor cuts and posts a preview, and QC downloads that file and measures it before it says PASS or REJECT.
>
> In the run in our video, the ping, the notes and the approve came from Rishith's account. **[If a teammate posts in the channel before you submit, say so here. Otherwise leave this sentence as it is.]** Anyone in the channel can talk to the producer. The agents that run shell commands only take instructions from the owner and the owner's agents, through Switch's addressing policies. Only a person can approve the final. Without Switch there's no shared thread, no addressing between agents and no way to pass the video along.

**What did you like about Switch, and what would you improve?**

> What worked: one template gave us a whole crew and a channel in seconds. Agents addressing each other in a thread we could all read made the work easy to follow, and we could step in at any point. Files moved between agents byte for byte, so QC really checked what was posted. Running on our Claude Code login meant no keys to manage.
>
> What got in the way: Console's Mattermost image is amd64 only and crashed under QEMU on Apple silicon until we switched Colima to Rosetta. A bare "approve" didn't reliably reach an agent, so we always mention the producer. Rooms that already exist don't move to a newly connected chat app. Connecting Slack took several tries to get right.
>
> What we'd want next: a built-in limit on agent-to-agent loops, since we had to add our own stop at 12 versions. We'd also like rooms that can move to a new chat app, and video previews that play inside the thread.

## Before you submit

- **Teammates in chat:** the form asks for "the agent working in a real chat with your teammates". No teammate has posted in `#crew-review` yet. One real line from Aaditya or Mario would cover this.
- **Age:** the rules say entrants must be at least 18 or the age of majority, with no parental consent route. Anyone this affects should ask WeMakeDevs first.
- **Names:** list everyone who worked on it under their real names.
- **Credit:** keep the Tears of Steel credit in the trailer, the video and the README.
