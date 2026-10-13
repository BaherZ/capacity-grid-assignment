# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

-------
-Working days and partial weeks were not defined. I chose full weeks because capacity is stored weekly; reducing capacity for partial weeks would assume how someone spreads their hours across individual days. Monday–Friday is the default, with Sunday–Thursday available.

-Every week uses the person’s current weekly hours because the database has no capacity history. In a real product, changes would have a start date so past weeks keep their original capacity.

-Failed or unconfirmed saves keep the draft. A confirmed save followed by a failed refresh has separate feedback, so the user retries loading rather than saving again.

-I load the whole team for the selected weeks and paginate the displayed rows. This kept search, filtering, and team totals straightforward within the tight time frame. It reduces rendering work, *but the server still calculates and sends everyone’s data. Server-side pagination is deferred*

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

-------
-Some assignments looked duplicated, but they had distinct IDs. I counted every row because removing similar-looking assignments would make the totals too low.

-I checked Dee’s 45 allocated hours against 40 available, and Eli’s 20 hours against zero. Both correctly show as over capacity.


## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

-------
-The first plan suggested reducing capacity for partial weeks. That assumed everyone spreads their weekly hours evenly across working days, so I chose full weeks instead.

## What would you do differently with a week?

-------
-It looks meh, Polish the design, especially spacing, fonts, and the mobile layout
-Test performance with a few thousand people and realistic assignment data, then decide whether to load smaller groups of people or render fewer weeks at once.
-For a real product, I would add dated capacity changes to preserve past weeks, and protect against two managers overwriting each other’s edits.
-Automate browser tests for slow responses and save recovery, and check keyboard and screen-reader use more thoroughly.

