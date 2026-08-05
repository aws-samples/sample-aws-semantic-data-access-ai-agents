# ACME Chatbot Agent Dockerfile
# This Dockerfile builds the main agent runtime for Bedrock AgentCore

FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Install OpenTelemetry instrumentation for observability
RUN pip install --no-cache-dir aws-opentelemetry-distro>=0.10.1

# Set AWS region environment variable
ENV AWS_REGION=us-west-2
ENV AWS_DEFAULT_REGION=us-west-2

# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

# Create non-root user for security
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

# Expose HTTP port for AgentCore runtime
EXPOSE 8080

# Health check port
EXPOSE 8000

# Copy entire project (respecting .dockerignore)
COPY --chown=bedrock_agentcore:bedrock_agentcore . .

# Use OpenTelemetry instrumentation with the main agent module
CMD ["opentelemetry-instrument", "python", "-m", "strands_claude"]
