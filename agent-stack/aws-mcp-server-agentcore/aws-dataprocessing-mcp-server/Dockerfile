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

# AWS Data Processing MCP Server for AgentCore Runtime
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
# Pin mcp <1.10.0: avoids outputSchema/$defs issue with BedrockAgentCore Gateway
# (mcp>=1.10.0 adds outputSchema with $defs for List[Model] return types; <1.10.0 is clean)
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
# Note: dataproc server has mcp=None at module level, so we must use create_server() and initialize handlers
RUN cat > /app/start_server.py << 'WRAPPER_EOF'
#!/usr/bin/env python3
"""
AgentCore wrapper for AWS Data Processing MCP Server.
Configures FastMCP for stateless HTTP mode required by AgentCore.

This server has a different structure - mcp is None at module level and
only created inside main(). We must call create_server() directly and
initialize all handlers ourselves.
"""
import os
import sys

# Set up logging
os.environ.setdefault('FASTMCP_LOG_LEVEL', 'INFO')

def main():
    # Import create_server and all handlers
    from awslabs.aws_dataprocessing_mcp_server.server import create_server
    from awslabs.aws_dataprocessing_mcp_server.handlers.athena.athena_data_catalog_handler import AthenaDataCatalogHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.athena.athena_query_handler import AthenaQueryHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.athena.athena_workgroup_handler import AthenaWorkGroupHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.commons.common_resource_handler import CommonResourceHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.emr.emr_ec2_cluster_handler import EMREc2ClusterHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.emr.emr_ec2_instance_handler import EMREc2InstanceHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.emr.emr_ec2_steps_handler import EMREc2StepsHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.crawler_handler import CrawlerHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.data_catalog_handler import GlueDataCatalogHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.glue_commons_handler import GlueCommonsHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.glue_etl_handler import GlueEtlJobsHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.interactive_sessions_handler import GlueInteractiveSessionsHandler
    from awslabs.aws_dataprocessing_mcp_server.handlers.glue.worklows_handler import GlueWorkflowAndTriggerHandler

    # Create the MCP server instance
    mcp = create_server()

    # Configure for AgentCore: bind to 0.0.0.0, enable stateless HTTP mode
    mcp.settings.host = '0.0.0.0'
    mcp.settings.port = 8000
    mcp.settings.stateless_http = True

    # Disable transport security for AgentCore (it handles security at the gateway)
    if hasattr(mcp, '_transport_security'):
        mcp._transport_security = None
    if hasattr(mcp.settings, 'transport_security'):
        mcp.settings.transport_security = None

    # Enable write and sensitive data access for AgentCore (agent should have permissions)
    allow_write = True
    allow_sensitive_data_access = True

    # Initialize all handlers (registers tools on the mcp instance)
    GlueDataCatalogHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    GlueInteractiveSessionsHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    GlueWorkflowAndTriggerHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    GlueEtlJobsHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    GlueCommonsHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    AthenaQueryHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    AthenaDataCatalogHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    AthenaWorkGroupHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    CrawlerHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    EMREc2ClusterHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    EMREc2StepsHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    EMREc2InstanceHandler(mcp, allow_write=allow_write, allow_sensitive_data_access=allow_sensitive_data_access)
    CommonResourceHandler(mcp, allow_write=allow_write)

    print("Starting AWS Data Processing MCP Server", file=sys.stderr)
    print("Binding to 0.0.0.0:8000/mcp in stateless HTTP mode", file=sys.stderr)
    print("Write access: enabled, Sensitive data access: enabled", file=sys.stderr)

    # Run with streamable-http transport for AgentCore
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

# Use the wrapper script that configures FastMCP for AgentCore
ENTRYPOINT ["python", "/app/start_server.py"]
