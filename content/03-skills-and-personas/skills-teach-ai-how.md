---
title: Skills Teach AI How
---

# Skills Teach AI How

General intelligence is not the same thing as knowing how _you_ do a task.

Consider a research brief. Two capable people may produce very different versions: one starts with sources, another starts with a thesis; one separates facts from assumptions, another mixes them; one checks links before sending, another does not. The missing ingredient is not information. It is a method.

A skill is that method written down for reuse. It can describe the inputs to gather, the steps to take, the quality checks to perform, and the situations where the agent should stop and ask a person. In a coding environment it may be a `SKILL.md` file. In another setting it may be a documented procedure. The name matters less than the clarity—and the quality check should not rely on the agent simply [[04-autonomy/dont-grade-your-own-homework|grading its own work]].

Writing a skill has a useful side effect: it exposes what was previously implicit. If you cannot explain the sequence, the handoffs, or the definition of done, an agent will have to guess. That is a problem even before automation enters the picture.

Start with a small, repeated task. Write the first version in plain language. Run it with an agent, inspect where it went wrong, and revise the instructions. A good skill is not a permanent prompt. It is a maintained working method that can later support [[personas-a-specialist-you-shaped|a more specialized role]].
