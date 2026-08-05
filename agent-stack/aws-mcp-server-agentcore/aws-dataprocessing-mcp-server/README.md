# AWS Data Processing MCP Server

MCP server providing Athena SQL access to the ACME telemetry data lake, plus Glue and EMR
management tools. Deployed to Bedrock AgentCore Runtime as the `dataproc_mcp` target.

See the [agent-stack README](../../README.md) for architecture and component details, or
the [repository root README](../../../README.md) for the full deployment guide.

> **Do not delete this file.** It is a build input, not only documentation:
> `pyproject.toml` declares `readme = "README.md"` and the `Dockerfile` runs
> `COPY pyproject.toml README.md .`, so removing it breaks `docker build`.
