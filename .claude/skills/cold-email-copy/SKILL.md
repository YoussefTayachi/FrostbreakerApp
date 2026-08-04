---
name: cold-email-copy
description: Writes cold outreach email copy in Youssef's sequence format — one initial email plus up to three follow-ups, ending in a micro-yes instead of a call booking. Use this whenever the user asks for email copy, an outreach sequence, a follow-up, a bump, a breakup email, a subject line, or wants existing copy rewritten, shortened, or made less salesy. Also use it when the user is setting up an Instantly campaign in Frostbreaker and needs the sequence steps filled in, even if they don't say "copy" — and when they describe a target audience and a product and ask "what should I send them".
---

# Cold email copy

This skill encodes a specific sequence format Youssef uses, taught by his sales
coach, plus the corrections he made while we built real campaigns with it. The
format is not generic cold-email advice — the details below are the parts he
kept pushing back on, so treat them as the spec rather than as suggestions.

## The core idea

The ask is never a call. It is **permission to send something**. A call asks the
prospect to commit calendar time before they know if it's worth anything; a
micro-yes asks them to type one word. That single change is what the whole
sequence is built around, so if you find yourself writing "worth 15 minutes?"
you have drifted off the format.

The second idea: the prospect should **nod while reading**. One line in the
first email has to state something they already believe about their own
business. Not a claim about your product — a fact about their world that they'd
confirm if asked. That line does more work than any feature list.

## The four emails

Each email has a job. Later emails get shorter, not louder.

### 1. Initial — earn permission

```
Hi {{firstName}},

{{personalization}}

I also noticed [verifiable observation about them].

Which means you already know the pain: [ONE specific problem], and
[the manual work it forces right now].

[What changes — the mechanism, concretely]

[Optional: a risk-remover, e.g. who covers setup]

Want me to put together a real example so you can see exactly what it
looks like? No call, just the result.

[Name]
```

**One ask, never a choice.** Offering two ways to say yes ("ten minutes on a
call, or I just send it over, your pick") looks like it lowers the barrier and
does the opposite: a reader who has to pick has two decisions instead of one,
and the easiest resolution of two decisions is neither. Pick the single ask
you actually want and write only that one.

The observation ("I also noticed…") is the second proof point after
`{{personalization}}` — it builds the "how does he know that" moment in two
steps instead of spending it in one line. It must come from a real filter you
applied (a shop system, a tool in their stack), never a guess.

**Exactly one pain point.** A list of five reasons dilutes the one decision
you're asking them to make. Pick the sharpest and drop the rest.

### 2. Bump — same point, tighter

```
Bumping this up, in case it slipped by.

Still worth pointing out: [the friction, restated in one sentence, with
the consequence that grows over time].

Happy to show you what that looks like [on the platform I mentioned].
Takes about a minute to see.

Yes or no, either works.

[Name]
```

Opens by marking itself as a follow-up. Does **not** re-explain the offer — a
follow-up that repeats the pitch reads as desperate. It assumes email 1 was
read and only lowers the barrier further.

"Yes or no, either works" instead of "Worth a yes?" — explicitly allowing the
no removes the social pressure, and paradoxically makes yes easier.

### 3. Consequence — one friction, one fix

```
[The friction, framed as a cost that grows the more they succeed.]

[Where it goes instead — one sentence.]

A minute, and you'll see what it looks like for you.

A yes doesn't start anything, it just tells me to send it over.

[Name]
```

The closing line exists because "yes" otherwise feels like the start of a sales
process. Say plainly that it isn't.

Be precise about the mechanism here. "That part disappears completely" is vague
and slightly false — tickets don't vanish, they get handled earlier. "Those
never reach your team in the first place" is both concrete and true.

### 4. Breakup — force a binary

```
Hi {{firstName}},

Last one from me, no more emails after this. Want me to send over
something free and useful before I go? A yes or no is all I need.

[Name]
```

Two lines. Greeting, finality marker, binary question. Keep it product-neutral —
mentioning the product again here just adds weight to the lightest email in the
sequence.

## What to do when they say yes

The reply must go out immediately with nothing required from them. Asking "what's
your niche?" before sending the promised thing reintroduces exactly the friction
the micro-yes removed, and is where prospects go quiet.

The strongest version costs nothing to prepare: **the proof already happened.**
The personalized line at the top of email 1 and the fact that they specifically
were targeted were both produced automatically. Point that out.

```
[Name] — the proof already happened, you're looking at it.

That line at the top of my first email, about your company? Generated
automatically, no manual research on my end. Same with knowing you run
[tool] in the first place — that came from a filter, not from me digging
through your site by hand.

That's what runs for every lead in a list, not just yours.

If you want to see the flow behind it, happy to jump on a quick call.
```

The call belongs **here**, after proof, never in email 1. And if you're selling
someone else's product, this is where the name goes — not at the yes. By now
they've invested attention, so the name lands in context instead of becoming a
reason to google and disengage.

## Rules that came from real mistakes

**Never break a sentence with a dash.** No em dash (—), no en dash (–), no
`--`, and no standalone hyphen used as punctuation. Use a full stop, a comma,
or a new paragraph instead. A dash mid-sentence is currently the single
clearest tell that a text was written by a model, and readers spot it without
being able to say why. This is the same rule the icebreaker generator already
enforces (`DEFAULT_BANNED_WORDS` in `lib/personalization-defaults.ts` and
`personalize.py`) — it applies to the sequence copy just as much, and it was
broken there first by the assistant, not by the user. Hyphens *inside* a
compound word ("third-party", "AI-powered") are fine and not meant here. The
`---` line in the signature block is a separator on its own line, not
punctuation, and stays.

**Never use `{{companyName}}`.** Company names in lead data are full of GmbHs,
punctuation, and odd casing. "Hi, I saw that Müller & Söhne GmbH & Co. KG…"
reads like a mail merge. Write "you" and "your shop" instead. The personalization
variable already proves you know who they are.

**Never name a tool you can't verify they use.** Naming their sending tool or
CRM when the filter didn't confirm it is a coin flip, and if it's wrong the
whole "we understand your workflow" angle collapses. Describe the workflow
instead: "every list still needs manual cleaning before it's ready to send"
is true regardless of which tool they use.

**Don't badmouth the tools they chose.** Someone whose stack you insult stops
believing the rest of the email. Frame the gap as something the tool was never
built to do, not as the tool being bad.

**No unverifiable superlatives.** "The largest agency" invites a fact-check you
will lose. A hard number from the vendor's own site ("450+ brands run on it")
is checkable and more persuasive than an adjective.

**If you're reselling, say so in email 1.** "I work with a European support
platform that…" — one phrase. Without it, anyone who visits your site sees a
different business and concludes the email was a lie. This costs nothing and
removes a real objection.

**Assume `{{personalization}}` may still be empty.** Coverage used to sit around
a quarter of leads because the personalization was built from crawled website
text and most shops answered the crawler with HTTP 429. Since Apollo's company
data is used instead, coverage is effectively complete — but a lead can still
come through without a line, and an empty variable leaves a visible double gap
in the email where the paragraph would have been. So never write a sentence
that depends on it ("As I mentioned about your brand…"), and keep at least one
other concrete, filter-backed detail in the first email so it still proves
something when the line is missing.

**Close every email with this exact signature block.** It carries the two things
CAN-SPAM requires of commercial email — a working opt-out and a physical postal
address — so it is not decoration and must not be trimmed to save space:

```
Youssef
Founder | frostbreaker.app
---
Bernoullistraße 4, 1220 Vienna, Austria
Reply "stop" to be removed from future emails.
```

Use it on all four emails, including the breakup. It replaces the older
approach of inserting an unsubscribe URL via the sequence editor's "Opt-out
link" button — a bare link in a cold email is also a deliverability liability,
while a reply-based opt-out reads like a person wrote it.

One thing to keep true: nothing in Frostbreaker currently watches for "stop"
replies and adds them to the blocklist. The inbox sync classifies replies and
marks the contact as replied, but the removal itself is not automatic. If the
promise in that last line is going to hold, either Instantly's own unsubscribe
keyword handling has to be switched on, or the reply has to be actioned by
hand.

**Germany, Austria and Switzerland are off-limits** for this outreach — the user
is not permitted to send cold email there. Default to US targeting and write in
English unless told otherwise. Match the email language to the language the
personalization is generated in, or a German icebreaker will sit on top of an
English body.

## Subject lines

Lowercase, three to five words, and about the reader's situation rather than
your offer. It should read like a line from a colleague, not a campaign — the
inbox is the first place a cold email gets judged, and anything that looks
composed by a marketing team is filtered before the body matters.

Good: `customer support costs` · `your product photos` · `free value for your shop`
Avoid: `Cut Support Costs by 80% 🚀` · `Quick question` (worn out) · anything with a colon-subtitle

Follow-ups either thread with `re: [original subject]` or use a short, plainer
new line. Threading makes the sequence feel like one conversation instead of
four campaigns; a fresh subject is worth trying on the breakup, where standing
out slightly is the point (`{{firstName}} here?` works because it reads like a
person, not a broadcast).

If the subject implies one decision, the body must deliver exactly that one —
a subject promising a topic the email doesn't cover is the fastest way to get
marked as spam.

## Formatting

Write one thought per paragraph with a blank line between. Cold email is read on
phones; short blocks with whitespace get scanned, dense paragraphs get archived.
A single sentence on its own line ("No call, just the result.") lands harder
than the same words tacked onto the paragraph above.

Available variables in Frostbreaker's Instantly editor: `{{firstName}}`,
`{{lastName}}`, `{{companyName}}` (avoid, see above), `{{email}}`, and
`{{personalization}}`.

## Tone

Calm and plain. Short sentences, no stacked subordinate clauses, no hype words
("game-changing", "revolutionize", "zero X hell"). Avoid idioms that need
decoding — "a merge tag standing in for it" was rejected for exactly this
reason; "the same template with a name dropped in" says it plainly.

Prefer statements over questions until the ask. Every question mark before the
micro-yes is a small demand on the reader.

## Before handing copy over

Read it once as the recipient. Two checks catch most problems:

1. If `{{personalization}}` were blank, does this still read like a real email?
2. Is there anything in here I could not defend if they replied "how do you
   know that?"

If the copy is going into a Frostbreaker campaign, offer to fill the sequence
steps directly rather than making the user copy-paste four times.
