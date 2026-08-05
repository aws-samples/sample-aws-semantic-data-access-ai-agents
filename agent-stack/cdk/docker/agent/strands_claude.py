#!/usr/bin/env python3
"""
ACME Corp Bedrock AgentCore Chatbot with AWS Documentation MCP Integration
CDK-managed deployment version
"""

import argparse
import json
import hashlib
import re
import requests
import time
import base64
import boto3
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.tools.code_interpreter_client import code_session

from memory_manager import create_memory_manager, extract_session_info
from secrets_manager import secrets_manager


# Configuration from environment
AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-haiku-4-5-20250414-v1:0')


def get_mcp_endpoints_from_env() -> Dict[str, str]:
    """
    Get MCP endpoints from environment variables (set by CDK).
    Converts ARNs to HTTP URLs for the AgentCore API.

    CDK sets environment variables like:
      MCP_SERVER_AWS_DOCS_MCP_ENDPOINT=arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/aws_docs_mcp-abc123

    This function converts them to HTTP URLs:
      https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT
    """
    endpoints = {}

    # Mapping from internal URL keys to CDK environment variable names
    env_mapping = {
        'MCP_DOCS_URL': 'MCP_SERVER_AWS_DOCS_MCP_ENDPOINT',
        'MCP_DATAPROC_URL': 'MCP_SERVER_DATAPROC_MCP_ENDPOINT',
    }

    region = os.environ.get('AWS_REGION', 'us-west-2')
    base_url = f"https://bedrock-agentcore.{region}.amazonaws.com"

    for url_key, env_key in env_mapping.items():
        arn = os.environ.get(env_key)
        if arn:
            # Encode ARN for URL: colons -> %3A, slashes -> %2F
            encoded_arn = arn.replace(':', '%3A').replace('/', '%2F')
            endpoints[url_key] = f"{base_url}/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
            print(f"MCP endpoint {url_key}: configured from {env_key}")

    return endpoints


def extract_text_from_event(event) -> str:
    """Extract text content from Strands streaming event structure"""
    if not event:
        return ""

    try:
        if isinstance(event, dict):
            if any(key in event for key in ['init_event_loop', 'start', 'start_event_loop', 'role', 'content']):
                return ""

            if 'event' in event:
                inner_event = event['event']
                if isinstance(inner_event, dict) and 'contentBlockDelta' in inner_event:
                    delta = inner_event['contentBlockDelta']
                    if isinstance(delta, dict) and 'delta' in delta:
                        delta_content = delta['delta']
                        if isinstance(delta_content, dict) and 'text' in delta_content:
                            text = delta_content['text']
                            return str(text) if text is not None else ""
                return ""

            if 'callback' in event:
                callback_data = event['callback']
                if isinstance(callback_data, str):
                    return callback_data
                elif isinstance(callback_data, dict) and 'text' in callback_data:
                    text = callback_data['text']
                    return str(text) if text is not None else ""
                return ""

            if 'text' in event and len(event) == 1:
                text_value = event['text']
                return str(text_value) if text_value is not None else ""
            return ""

        if isinstance(event, str) and event.strip():
            return event

    except Exception as e:
        print(f"Warning: Error extracting text from event: {e}")

    return ""


def get_gateway_url() -> Optional[str]:
    """
    Get the MCP Gateway URL from environment variables (set by CDK).
    The Gateway provides a single MCP endpoint for all tool access.
    """
    gateway_url = os.environ.get('GATEWAY_MCP_URL')
    if gateway_url:
        print(f"Gateway MCP URL configured: {gateway_url[:80]}...")
    else:
        print("GATEWAY_MCP_URL not set - falling back to direct MCP endpoints")
    return gateway_url


class MCPManager:
    """Manages MCP client creation - prefers Gateway, falls back to direct"""

    def __init__(self):
        self._bearer_token: Optional[str] = None
        self._token_expires_at: float = 0
        self._credentials: Optional[Dict[str, str]] = None
        self._gateway_url: Optional[str] = None
        self._legacy_endpoints: Dict[str, str] = {}
        self._initialized: bool = False

    def _init_credentials(self) -> bool:
        """Initialize credentials and check if MCP is available"""
        if self._initialized:
            return self._gateway_url is not None or bool(self._legacy_endpoints)

        self._initialized = True

        try:
            self._gateway_url = get_gateway_url()
            self._credentials = secrets_manager.get_mcp_credentials()

            if self._gateway_url:
                print(f"MCP Gateway mode: {self._gateway_url}")
                return True

            # Fallback: try direct MCP endpoints
            self._legacy_endpoints = get_mcp_endpoints_from_env()
            if self._legacy_endpoints:
                print(f"MCP direct mode with endpoints: {list(self._legacy_endpoints.keys())}")
                return True

            print("No MCP configuration found")
            return False

        except Exception as e:
            print(f"Could not initialize MCP: {e}")
            return False

    def is_mcp_available(self) -> bool:
        return self._init_credentials()

    def _get_bearer_token(self) -> str:
        """Get bearer token from Cognito with caching"""
        if not self._init_credentials():
            raise Exception("MCP not available")

        current_time = time.time()
        if self._bearer_token and current_time < self._token_expires_at:
            return self._bearer_token

        try:
            pool_id = self._credentials['MCP_COGNITO_POOL_ID']
            region = self._credentials['MCP_COGNITO_REGION']
            client_id = self._credentials['MCP_COGNITO_CLIENT_ID']
            client_secret = self._credentials['MCP_COGNITO_CLIENT_SECRET']
            cognito_domain = self._credentials.get('MCP_COGNITO_DOMAIN')

            if not cognito_domain:
                raise Exception("MCP_COGNITO_DOMAIN not configured")

            token_url = f"https://{cognito_domain}/oauth2/token"
            print(f"Getting fresh MCP bearer token from {region}...")

            response = requests.post(
                token_url,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                data={
                    'grant_type': 'client_credentials',
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'scope': 'mcp/invoke'
                },
                timeout=10
            )

            if response.status_code == 200:
                token_data = response.json()
                self._bearer_token = token_data['access_token']
                self._token_expires_at = current_time + (50 * 60)
                print("MCP bearer token obtained successfully")
                return self._bearer_token
            else:
                raise Exception(f"Token request failed: {response.status_code} - {response.text}")

        except Exception as e:
            print(f"Failed to get MCP bearer token: {e}")
            raise

    def _create_mcp_transport(self, url: str):
        """Create MCP transport with bearer token auth"""
        bearer_token = self._get_bearer_token()
        headers = {
            "authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        }
        print(f"Creating MCP transport: {url[:100]}...")
        return streamablehttp_client(url, headers=headers, timeout=120, terminate_on_close=False)

    def create_gateway_client(self) -> MCPClient:
        """Create a single MCP client for the Gateway"""
        try:
            print(f"Creating Gateway MCP client: {self._gateway_url[:80]}...")
            client = MCPClient(lambda: self._create_mcp_transport(self._gateway_url))
            print("Gateway MCP client created successfully")
            return client
        except Exception as e:
            print(f"Failed to create Gateway MCP client: {e}")
            raise

    def create_aws_docs_client(self) -> MCPClient:
        """Fallback: Create MCP client for AWS Documentation (direct mode)"""
        try:
            url = self._legacy_endpoints.get('MCP_DOCS_URL')
            if not url:
                raise Exception("MCP_DOCS_URL not configured")
            client = MCPClient(lambda: self._create_mcp_transport(url))
            return client
        except Exception as e:
            print(f"Failed to create AWS docs MCP client: {e}")
            raise

    def create_dataproc_client(self) -> MCPClient:
        """Fallback: Create MCP client for DataProcessing (direct mode)"""
        try:
            url = self._legacy_endpoints.get('MCP_DATAPROC_URL')
            if not url:
                raise Exception("MCP_DATAPROC_URL not configured")
            client = MCPClient(lambda: self._create_mcp_transport(url))
            return client
        except Exception as e:
            print(f"Failed to create dataproc MCP client: {e}")
            raise


# Global instances
mcp_manager = MCPManager()
model = BedrockModel(model_id=BEDROCK_MODEL_ID)
app = BedrockAgentCoreApp()

# S3 client for visualizations
s3_client = boto3.client('s3', region_name=AWS_REGION)
VISUALIZATION_BUCKET = os.environ.get('VISUALIZATION_BUCKET', 'acme-visualizations')


@tool
def execute_code_with_visualization(
    code: str,
    description: str = "Execute Python code for data analysis and visualization"
) -> str:
    """Execute Python code using code_session context manager for visualization."""

    if description:
        code = f"# {description}\n{code}"

    # Strip plt.savefig() and plt.close() calls from user code
    # so the wrapper can capture the figure
    cleaned_code = re.sub(r'plt\.savefig\([^)]*\)', '# savefig handled by wrapper', code)
    cleaned_code = re.sub(r'plt\.close\([^)]*\)', '# close handled by wrapper', cleaned_code)

    modified_code = f"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import base64

{cleaned_code}

if 'plt' in locals() and plt.get_fignums():
    buffer = io.BytesIO()
    plt.savefig(buffer, format='png', bbox_inches='tight', dpi=100)
    buffer.seek(0)
    image_base64 = base64.b64encode(buffer.read()).decode('utf-8')
    buffer.close()
    plt.close('all')
    print(f"IMAGE_DATA:{{image_base64}}")
"""

    try:
        with code_session(AWS_REGION) as code_client:
            response = code_client.invoke("executeCode", {
                "code": modified_code,
                "language": "python",
                "clearContext": False
            })

            for event in response.get("stream", []):
                if "result" in event:
                    result = event["result"]

                    output_text = ""
                    if isinstance(result, dict):
                        structured_content = result.get("structuredContent", {})
                        if isinstance(structured_content, dict):
                            output_text = structured_content.get("stdout", "")

                        if not output_text and "content" in result and result["content"]:
                            content = result["content"]
                            content_item = content[0] if isinstance(content, list) else content
                            if isinstance(content_item, dict):
                                output_text = content_item.get("text", "")

                    if output_text and "IMAGE_DATA:" in output_text:
                        image_start = output_text.find("IMAGE_DATA:") + 11
                        image_data = output_text[image_start:].strip()

                        s3_url = None
                        try:
                            image_bytes = base64.b64decode(image_data)
                            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                            s3_key = f"visualizations/{timestamp}_chart.png"

                            s3_client.put_object(
                                Bucket=VISUALIZATION_BUCKET,
                                Key=s3_key,
                                Body=image_bytes,
                                ContentType='image/png'
                            )

                            s3_url = s3_client.generate_presigned_url(
                                'get_object',
                                Params={'Bucket': VISUALIZATION_BUCKET, 'Key': s3_key},
                                ExpiresIn=86400
                            )
                        except Exception as s3_error:
                            print(f"S3 upload failed: {s3_error}")

                        response_data = {
                            "type": "visualization",
                            "format": "png",
                            "status": "success"
                        }

                        if s3_url:
                            response_data["s3_url"] = s3_url
                            response_data["message"] = f"Visualization created successfully. URL: {s3_url}"

                        return json.dumps(response_data)

                    return json.dumps(result)

            return "Code executed successfully"

    except Exception as e:
        return json.dumps({
            "type": "error",
            "message": f"Code execution failed: {str(e)}",
            "status": "failed"
        })


def get_system_prompt(conversation_context: str = "") -> str:
    """Generate the system prompt with optional conversation context"""

    base_prompt = """You are an AI assistant for ACME Corp powered by Claude. You help with:
- Searching AWS documentation for services, best practices, and guides
- Querying ACME Corp streaming telemetry data (Athena SQL via Glue Data Catalog)
- Querying ACME Corp CRM data (MySQL via Aurora)
- Creating data visualizations (Python/matplotlib)
Keep responses concise unless detailed information is requested.

ANTI-HALLUCINATION RULES:
- NEVER fabricate data, statistics, query results, URLs, or column names
- ALWAYS base answers on actual tool output — do not guess schema details
- If a query returns no results or a tool call fails, report it honestly
- If you don't know the answer or lack access to the needed data, say "I don't have that information" — do not approximate
- Never simulate or invent data that should come from a database query
- Include source URLs when referencing AWS documentation

TOOL DISCOVERY & ROUTING:
You access tools via the MCP Gateway. Use x_amz_bedrock_agentcore_search to find the right tool by keyword when unsure.

Routing by intent:
- Telemetry/streaming/viewing data questions → use Glue catalog tools to discover schema, then Athena query tools
- CRM/support tickets/ratings questions → use MySQL tools (run_query, get_table_schema)
- AWS service questions → use documentation search tools
- Charts/visualizations → use execute_code_with_visualization directly

If you already know the tool name from earlier in this conversation, call it directly.
If a query spans both telemetry and CRM data, query each source separately and correlate by customer_id or title_id.

STEP-BY-STEP REASONING FOR DATA QUESTIONS:
1. Identify which data source(s) are relevant (Athena telemetry vs MySQL CRM)
2. Discover the schema — use Glue Catalog for Athena tables, get_table_schema for MySQL
3. Write the SQL query using correct syntax (Presto/Trino for Athena, MySQL for CRM)
4. Execute the query and wait for results
5. Interpret and present findings clearly
For complex questions, break them into simpler sub-queries.

ATHENA TELEMETRY DATA:
Database: acme_telemetry (Glue Data Catalog)
Tables:
- streaming_events: Event-level telemetry (partitioned by year/month/day/hour)
- customers: Customer profiles and subscription data
- titles: Video catalog metadata
- campaigns: Advertising campaign performance

SCHEMA DISCOVERY (MANDATORY before writing SQL):
Before writing any Athena query, retrieve the table schema:
  → Use manage_aws_glue_tables with operation='get-table', database_name='acme_telemetry', table_name='<table>'
  This returns all columns, data types, partition keys, and storage details.

QUERY EXECUTION:
  → Use manage_aws_athena_query_executions with operation='start-query-execution', work_group='primary'
  → Then get results with operation='get-query-results'

CRITICAL: streaming_events is partitioned. ALWAYS include partition filters:
  WHERE year='2026' AND month='03'
Without these, queries scan all partitions and are extremely slow (~3.5 min).
Use Presto/Trino SQL syntax (not MySQL).

MYSQL CRM DATA (Aurora MySQL via RDS Data API):
Database: acme_crm
Tables:
- support_tickets: status (open|in_progress|resolved|closed), priority (low|medium|high|critical), category (billing|technical|content|account)
- content_ratings: rating (1-5), review_text

Use get_table_schema(table_name, database_name='acme_crm') to verify full column details before writing complex queries.
Use run_query(sql='SELECT...') to execute queries. Default to read-only SELECT.
Use standard MySQL syntax (not Presto/Trino).
Cross-reference: customer_id and title_id link to acme_telemetry tables. Subscription data is in Athena only (customers.subscription_tier).

AWS DOCUMENTATION:
Use documentation search tools to find AWS service information.
Always include source URLs when citing documentation.
Use the recommend tool to discover related/newly released features.

CHART/VISUALIZATION GENERATION (execute_code_with_visualization tool):
When asked to create charts, graphs, or data visualizations, use the execute_code_with_visualization tool with matplotlib code.

Example code for a bar chart:
```python
import matplotlib.pyplot as plt

data = {'Jan': 45000, 'Feb': 52000, 'Mar': 48000, 'Apr': 61000, 'May': 58000, 'Jun': 72000}
months = list(data.keys())
values = list(data.values())

plt.figure(figsize=(10, 6))
plt.bar(months, values, color='steelblue')
plt.xlabel('Month')
plt.ylabel('Sales ($)')
plt.title('Monthly Sales Data')
plt.tight_layout()
```

IMPORTANT: Do NOT include plt.savefig(), plt.close(), or plt.show() in your code. The tool automatically captures and saves the chart. Just create the plot and leave it open.

The tool will:
1. Execute the matplotlib code
2. Save the chart to S3
3. Return a presigned URL

CRITICAL: When the tool returns a response with "s3_url", you MUST include the COMPLETE URL in your response using markdown: ![Chart Description](complete-s3-url-with-all-parameters)

The URL will be long (500+ characters) with query parameters like X-Amz-Signature - this is expected. Never truncate it.

ERROR HANDLING:
If a tool call returns an error, explain it to the user and suggest alternatives.
If an Athena query fails, verify partition filters and column names against the Glue schema.
If a MySQL query fails, use get_table_schema to verify the schema.
Do not retry a failed query with identical parameters.

"""

    return base_prompt + conversation_context if conversation_context else base_prompt


def create_agent_with_memory(payload: dict) -> Tuple[Agent, Any, list, str]:
    """Create agent instance with memory configuration and MCP clients"""

    session_id, actor_id = extract_session_info(payload)
    user_input = payload.get("prompt", "")

    memory_name = f"ACMEChatMemory_{hashlib.md5(actor_id.encode()).hexdigest()[:8]}"

    print(f"Configuring memory: session={session_id}, actor={actor_id}")

    memory_hooks = None
    conversation_context = ""

    try:
        memory_hooks = create_memory_manager(
            memory_name=memory_name,
            actor_id=actor_id,
            session_id=session_id,
            region=AWS_REGION
        )

        conversation_context = memory_hooks.retrieve_conversation_context(user_input)
        print("Memory manager configured successfully")

    except Exception as e:
        print(f"Could not configure memory: {e}")

    # Collect available MCP clients
    mcp_clients = []

    if mcp_manager.is_mcp_available():
        if mcp_manager._gateway_url:
            # Gateway mode: single client for all tools
            try:
                mcp_clients.append(('gateway', mcp_manager.create_gateway_client()))
            except Exception as e:
                print(f"Gateway client unavailable: {e}")
        else:
            # Fallback: direct MCP server connections
            try:
                mcp_clients.append(('aws_docs', mcp_manager.create_aws_docs_client()))
            except Exception as e:
                print(f"AWS docs client unavailable: {e}")

            try:
                mcp_clients.append(('dataproc', mcp_manager.create_dataproc_client()))
            except Exception as e:
                print(f"DataProcessing client unavailable: {e}")
    else:
        print("MCP integration not configured - agent running without MCP tools")

    system_prompt = get_system_prompt(conversation_context)

    return None, memory_hooks, mcp_clients, system_prompt


def strands_agent_bedrock(payload):
    """Main entrypoint for the ACME Corp chatbot"""
    user_input = payload.get("prompt")
    print("User input:", user_input)

    agent, memory_hooks, mcp_clients, system_prompt = create_agent_with_memory(payload)

    try:
        all_tools = [execute_code_with_visualization]

        # Build context managers dynamically based on available clients
        if mcp_clients:
            # Use nested context managers for all available clients
            clients_to_use = [client for _, client in mcp_clients]

            def run_with_clients(clients, idx=0):
                if idx >= len(clients):
                    # All clients entered, now collect tools with pagination and run
                    for name, client in mcp_clients:
                        try:
                            pagination_token = None
                            tool_count = 0
                            while True:
                                tools = client.list_tools_sync(pagination_token=pagination_token)
                                all_tools.extend(tools)
                                tool_count += len(tools)
                                pagination_token = tools.pagination_token
                                if pagination_token is None:
                                    break
                            print(f"Added {tool_count} tools from {name}")
                        except Exception as e:
                            print(f"Could not get tools from {name}: {e}")

                    agent = Agent(model=model, tools=all_tools, system_prompt=system_prompt)
                    return agent(user_input)
                else:
                    with clients[idx]:
                        return run_with_clients(clients, idx + 1)

            response = run_with_clients(clients_to_use)
        else:
            agent = Agent(model=model, tools=all_tools, system_prompt=system_prompt)
            response = agent(user_input)

        assistant_response = response.message['content'][0]['text']

        if memory_hooks:
            try:
                memory_hooks.save_chat_interaction(user_input, assistant_response)
            except Exception as e:
                print(f"Could not save interaction to memory: {e}")

        return assistant_response

    except Exception as e:
        print(f"Error during agent execution: {e}")
        return "I apologize, but I encountered an error while processing your request. Please try again."


async def strands_agent_bedrock_streaming(payload):
    """Async streaming entrypoint for real-time responses"""
    user_input = payload.get("prompt")
    print("User input (streaming):", user_input)

    agent, memory_hooks, mcp_clients, system_prompt = create_agent_with_memory(payload)

    try:
        full_response = ""
        all_tools = [execute_code_with_visualization]

        if mcp_clients:
            clients_to_use = [client for _, client in mcp_clients]

            async def run_streaming_with_clients(clients, idx=0):
                nonlocal full_response
                if idx >= len(clients):
                    for name, client in mcp_clients:
                        try:
                            pagination_token = None
                            while True:
                                tools = client.list_tools_sync(pagination_token=pagination_token)
                                all_tools.extend(tools)
                                pagination_token = tools.pagination_token
                                if pagination_token is None:
                                    break
                        except Exception:
                            pass

                    streaming_agent = Agent(model=model, tools=all_tools, system_prompt=system_prompt)

                    async for event in streaming_agent.stream_async(user_input):
                        chunk = extract_text_from_event(event)
                        if chunk:
                            full_response += chunk
                            yield chunk
                else:
                    with clients[idx]:
                        async for chunk in run_streaming_with_clients(clients, idx + 1):
                            yield chunk

            async for chunk in run_streaming_with_clients(clients_to_use):
                yield chunk
        else:
            streaming_agent = Agent(model=model, tools=all_tools, system_prompt=system_prompt)
            async for event in streaming_agent.stream_async(user_input):
                chunk = extract_text_from_event(event)
                if chunk:
                    full_response += chunk
                    yield chunk

        if memory_hooks:
            try:
                memory_hooks.save_chat_interaction(user_input, full_response)
            except Exception as e:
                print(f"Could not save streaming interaction to memory: {e}")

    except Exception as e:
        print(f"Error during streaming agent execution: {e}")
        yield f"Error: {str(e)}"


@app.entrypoint
async def strands_agent_bedrock_unified(payload, context=None):
    """Unified entrypoint that routes between streaming and non-streaming"""

    streaming_enabled = False

    if payload and isinstance(payload, dict):
        streaming_enabled = payload.get("streaming", False)

    if context and hasattr(context, 'request'):
        query_params = str(context.request.url.query) if hasattr(context.request, 'url') else ""
        streaming_enabled = streaming_enabled or "streaming=true" in query_params

        if hasattr(context.request, 'headers'):
            accept_header = context.request.headers.get('accept', '')
            streaming_enabled = streaming_enabled or 'text/event-stream' in accept_header

    if streaming_enabled:
        return strands_agent_bedrock_streaming(payload)
    else:
        return strands_agent_bedrock(payload)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Run Strands Agent locally')
    parser.add_argument('payload', help='JSON payload with prompt', nargs='?')

    args = parser.parse_args()

    if args.payload:
        try:
            payload_data = json.loads(args.payload)
            result = strands_agent_bedrock(payload_data)
            print("Response:", result)
        except json.JSONDecodeError:
            print("Error: Invalid JSON payload")
        except Exception as e:
            print(f"Error: {e}")
    else:
        app.run()
