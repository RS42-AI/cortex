---
title: Don't Grade Your Own Homework
---

# Don't Grade Your Own Homework

An agent should not be the only judge of work it produced.

The problem is not that models are uniquely dishonest. The problem is that creation and evaluation are different tasks. A system that generated a summary is poorly positioned to notice the source it missed. A system that changed a file should not be the only one deciding the change is safe.

Build a second check into important workflows. The check may be deterministic: tests pass, required fields exist, links resolve, or a policy scan finds nothing prohibited. It may be independent review: a different prompt, a different model, or a human reads the output against the original request. The right check depends on the risk and should be written into [[03-skills-and-personas/skills-teach-ai-how|the method the agent follows]].

This principle keeps autonomy from becoming wishful thinking. “The agent said it worked” is not evidence. A visible artifact and a meaningful check are evidence.

For work that affects people, money, security, or public claims, make the human gate explicit. The agent can gather, draft, and flag. A person makes the consequential call. That is what makes the shift [[from-operator-to-reviewer|from operator to reviewer]] safer than simply disappearing from the process.
