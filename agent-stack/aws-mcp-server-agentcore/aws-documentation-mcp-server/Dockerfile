# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# AWS Documentation MCP Server for AgentCore Runtime
# Simplified build without BuildKit cache mounts for CDK compatibility

FROM public.ecr.aws/docker/library/python:3.13-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    build-base \
    gcc \
    musl-dev \
    libffi-dev \
    openssl-dev \
    cargo

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy all source files
COPY pyproject.toml README.md .
COPY awslabs/ ./awslabs/

# Create virtual environment and install the package
RUN uv venv /app/.venv && \
    . /app/.venv/bin/activate && \
    uv pip install --compile-bytecode .

# Runtime stage
FROM public.ecr.aws/docker/library/python:3.13-alpine

# Install runtime dependencies (procps needed for pgrep in healthcheck)
RUN apk add --no-cache ca-certificates procps && \
    addgroup -g 1000 app && \
    adduser -u 1000 -G app -s /bin/sh -D app

WORKDIR /app

# Copy virtual environment with installed package
COPY --from=builder --chown=app:app /app/.venv /app/.venv

# Copy health check
COPY --chown=app:app docker-healthcheck.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-healthcheck.sh

# Create AgentCore wrapper script that properly configures FastMCP for HTTP mode
RUN cat > /app/start_server.py << 'WRAPPER_EOF'
#!/usr/bin/env python3
"""
AgentCore wrapper for AWS Documentation MCP Server.
Configures FastMCP for stateless HTTP mode required by AgentCore.
"""
import os
import sys

# Set up logging
os.environ.setdefault('FASTMCP_LOG_LEVEL', 'INFO')

PARTITION = os.getenv('AWS_DOCUMENTATION_PARTITION', 'aws').lower()

def main():
    if PARTITION == 'aws':
        from awslabs.aws_documentation_mcp_server.server_aws import mcp
    elif PARTITION == 'aws-cn':
        from awslabs.aws_documentation_mcp_server.server_aws_cn import mcp
    else:
        raise ValueError(f'Unsupported AWS documentation partition: {PARTITION}.')

    # Configure for AgentCore: bind to 0.0.0.0, enable stateless HTTP mode
    mcp.settings.host = '0.0.0.0'
    mcp.settings.port = 8000
    mcp.settings.stateless_http = True

    # Disable transport security for AgentCore (it handles security at the gateway)
    if hasattr(mcp, '_transport_security'):
        mcp._transport_security = None
    if hasattr(mcp.settings, 'transport_security'):
        mcp.settings.transport_security = None

    print(f"Starting AWS Documentation MCP Server (partition: {PARTITION})", file=sys.stderr)
    print(f"Binding to 0.0.0.0:8000/mcp in stateless HTTP mode", file=sys.stderr)

    # Run with streamable-http transport for AgentCore
    mcp.run(transport='streamable-http')

if __name__ == '__main__':
    main()
WRAPPER_EOF

RUN chmod +x /app/start_server.py && chown app:app /app/start_server.py

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    AWS_DOCUMENTATION_PARTITION=aws

USER app

HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
    CMD ["docker-healthcheck.sh"]

EXPOSE 8000

# Use the wrapper script that configures FastMCP for AgentCore
ENTRYPOINT ["python", "/app/start_server.py"]
