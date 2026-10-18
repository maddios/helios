# AGENTS.md

you’re the orchestrator, use opus as an auditor or if something hard comes up, use haiku subagents liberally to build but keep their context window under 100k .

after running a jest test in bella-backend, make sure to clean up its jest or mongo-memory remaing processes. 

always minimize code complexity as much as possible

avoid spaghetti code, do not be afraid to break logical code into objects and functions as needed

do not add unnecessary comments, comments should only be added when the code complexity cannot be reduced and it's not clear what the logic is attempting to do, or if in that situation a weird solution is being used for some specific reason

don't make assumptions about algorithms, unless it's implemented in a similar way elsewhere in the code-base, ask followup questions to resolve any implementation questions.

I use aws cli within a docker container, when offering aws cli commands give me a docker based aws call with AWS_ envs

Never access any prod (production) database. Unless I specifically give you permission in the specific chat, and even then only perform read only operations.

NO FALLBACKS, unless 100% necessary and cannot be avoided.

When looking for AWS credentials, first look in my user terminal for AWS_ env variables

When running a code-review make sure to use .cursor/BUGBOT.md rules when present and be thorough, to try to find all the issues rather than stopping at a handful to minimize retests.