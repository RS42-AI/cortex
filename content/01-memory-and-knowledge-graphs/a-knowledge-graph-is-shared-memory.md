---
title: A Knowledge Graph Is Shared Memory
---

# A Knowledge Graph Is Shared Memory

A useful knowledge base does more than solve [[why-memory-changes-everything|the problem of disappearing context]]. It shows how the documents relate.

Imagine a course note that links to the assignment it explains, the source it cites, and the example where the idea was tested. A reader can move through those relationships without knowing the exact words to search for. An agent can do the same: start from a question, find the relevant note, and follow the links to the context that changes the answer.

That is the practical value of a knowledge graph. It is not a promise that every note becomes a perfect database. It is a habit of recording connections while you work: this decision belongs to this project; this procedure depends on this policy; this lesson came from this result. The connection should be understandable as a sentence, not added merely to make the graph look dense.

The word _shared_ matters. A private notebook that an agent cannot read is not its memory. An agent’s hidden memory that you cannot inspect is not a reliable working record. The strongest arrangement is one both can use. You can see what the agent was given, correct it when it is wrong, and build on it the next day.

Cortex is a small public example of that pattern. Your own version may be a research notebook, a project wiki, or a folder of linked Markdown files. What matters is that [[the-artifact-is-the-memory|the record stays close to the work]] and that a connection such as [[02-connections-mcp/mcp-a-universal-port-for-ai|MCP]] can expose the right part of it to an agent. The software is secondary. The shared, inspectable record is the point.
