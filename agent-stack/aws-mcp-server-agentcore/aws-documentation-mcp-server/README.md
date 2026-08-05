# AWS Documentation MCP Server

MCP server providing AWS documentation search and retrieval (`read_documentation`,
`search_documentation`, `recommend`). Deployed to Bedrock AgentCore Runtime as the
`aws_docs_mcp` target.

See the [agent-stack README](../../README.md) for architecture and component details, or
the [repository root README](../../../README.md) for the full deployment guide.

> **Do not delete this file.** It is a build input, not only documentation:
> `pyproject.toml` declares `readme = "README.md"` and the `Dockerfile` runs
> `COPY pyproject.toml README.md .`, so removing it breaks `docker build`.
