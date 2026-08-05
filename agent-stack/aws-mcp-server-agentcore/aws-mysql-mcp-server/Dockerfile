# AWS MySQL MCP Server for AgentCore Runtime
# Uses the AWS Labs mysql-mcp-server package with RDS Data API

FROM public.ecr.aws/docker/library/python:3.13-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install the AWS Labs mysql-mcp-server package
RUN uv venv /app/.venv && \
    . /app/.venv/bin/activate && \
    uv pip install --compile-bytecode "awslabs.mysql-mcp-server>=1.0.15"

# Runtime stage
FROM public.ecr.aws/docker/library/python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends procps && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g 1000 app && \
    useradd -u 1000 -g app -s /bin/sh -m app

WORKDIR /app

# Copy virtual environment
COPY --from=builder --chown=app:app /app/.venv /app/.venv

# Copy health check
COPY --chown=app:app docker-healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-healthcheck.sh

# Create AgentCore wrapper script
# The mysql-mcp-server has a module-level `mcp` FastMCP instance in server.py
# with tools registered via decorators. We need to:
# 1. Initialize the DB connection via DBConnectionSingleton
# 2. Configure mcp for stateless HTTP mode
# 3. Run with streamable-http transport
RUN cat > /app/start_server.py << 'WRAPPER_EOF'
#!/usr/bin/env python3
"""
AgentCore wrapper for AWS MySQL MCP Server.
Configures for stateless HTTP mode and initializes RDS Data API connection.
"""
import os
import sys
import asyncio

os.environ.setdefault('FASTMCP_LOG_LEVEL', 'INFO')

def main():
    resource_arn = os.environ.get('MYSQL_RESOURCE_ARN', '')
    secret_arn = os.environ.get('MYSQL_SECRET_ARN', '')
    database = os.environ.get('MYSQL_DATABASE', 'acme_crm')
    region = os.environ.get('AWS_REGION', 'us-west-2')
    readonly = os.environ.get('MYSQL_READONLY', 'true')

    # Import the server module - this creates the mcp FastMCP instance
    # and registers tools (run_query, get_table_schema) via decorators
    from awslabs.mysql_mcp_server.server import mcp
    from awslabs.mysql_mcp_server.connection import DBConnectionSingleton

    # Initialize the database connection singleton (RDS Data API mode)
    DBConnectionSingleton.initialize(
        resource_arn=resource_arn,
        secret_arn=secret_arn,
        database=database,
        region=region,
        readonly=readonly,
    )

    # Test connectivity via Data API
    print(f"Starting MySQL MCP Server (Data API mode)", file=sys.stderr)
    print(f"Resource ARN: {resource_arn}", file=sys.stderr)
    print(f"Database: {database}, Region: {region}", file=sys.stderr)

    # Configure for AgentCore HTTP mode
    mcp.settings.host = '0.0.0.0'
    mcp.settings.port = 8000
    mcp.settings.stateless_http = True

    if hasattr(mcp, '_transport_security'):
        mcp._transport_security = None
    if hasattr(mcp.settings, 'transport_security'):
        mcp.settings.transport_security = None

    print(f"Binding to 0.0.0.0:8000/mcp in stateless HTTP mode", file=sys.stderr)

    mcp.run(transport='streamable-http')

if __name__ == '__main__':
    main()
WRAPPER_EOF

RUN chmod +x /app/start_server.py && chown app:app /app/start_server.py

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app

HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
    CMD ["docker-healthcheck.sh"]

EXPOSE 8000

ENTRYPOINT ["python", "/app/start_server.py"]
