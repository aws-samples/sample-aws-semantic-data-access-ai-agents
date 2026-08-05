"""
Memory Manager for AgentCore Short-Term Memory Implementation
Handles conversation persistence and context loading for the ACME Corp chatbot
"""

import json
import hashlib
import re
import os
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from bedrock_agentcore.memory import MemoryClient
from bedrock_agentcore.memory.constants import StrategyType
from strands.hooks import AfterInvocationEvent, HookProvider, HookRegistry, MessageAddedEvent


AWS_REGION = os.environ.get('AWS_REGION', 'us-west-2')


class ACMEChatMemoryHooks(HookProvider):
    """Memory hooks for ACME Corp chatbot using AgentCore Memory"""

    def __init__(self, memory_client: MemoryClient, memory_id: str, actor_id: str, session_id: str):
        self.memory_client = memory_client
        self.memory_id = memory_id
        self.actor_id = actor_id
        self.session_id = session_id
        self.namespace = f"chat/user/{actor_id}/conversations"

    def retrieve_conversation_context(self, user_query: str) -> str:
        """Retrieve recent conversation history from current session"""
        try:
            recent_turns = self.memory_client.get_last_k_turns(
                memory_id=self.memory_id,
                actor_id=self.actor_id,
                session_id=self.session_id,
                k=3
            )

            if not recent_turns:
                return ""

            context_parts = []
            for turn in recent_turns:
                if isinstance(turn, list):
                    for message in turn:
                        if isinstance(message, dict):
                            role = message.get('role', '')
                            content_obj = message.get('content', {})
                            if isinstance(content_obj, dict):
                                content = content_obj.get('text', '')
                            else:
                                content = str(content_obj)

                            if role and content:
                                clean_content = content
                                if content.startswith('[META:'):
                                    bracket_end = content.find(']')
                                    if bracket_end != -1:
                                        clean_content = content[bracket_end + 1:]

                                context_parts.append(f"{role.title()}: {clean_content}")

            if context_parts:
                context_parts.reverse()
                context = "\n".join(context_parts[-10:])
                print(f"Retrieved {len(context_parts)} conversation messages")
                return f"\nRecent conversation:\n{context}\n"

            return ""

        except Exception as e:
            print(f"Could not retrieve conversation context: {e}")
            return ""

    def save_chat_interaction(self, user_message: str, assistant_response: str):
        """Save the interaction to memory"""
        try:
            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=self.actor_id,
                session_id=self.session_id,
                messages=[(user_message, "USER")]
            )

            self.memory_client.create_event(
                memory_id=self.memory_id,
                actor_id=self.actor_id,
                session_id=self.session_id,
                messages=[(assistant_response, "ASSISTANT")]
            )

            print(f"Saved chat interaction to memory")

        except Exception as e:
            print(f"Could not save chat interaction: {e}")

    def register_hooks(self, registry: HookRegistry):
        """Register memory hooks with the agent"""
        pass


def create_memory_manager(memory_name: str, actor_id: str, session_id: str, region: str = None) -> ACMEChatMemoryHooks:
    """
    Create and configure memory management for ACME Corp chatbot

    Args:
        memory_name: Name for the memory resource
        actor_id: User identifier
        session_id: Session identifier from frontend
        region: AWS region for memory service

    Returns:
        ACMEChatMemoryHooks configured for the agent
    """
    region = region or AWS_REGION
    memory_client = MemoryClient(region_name=region)
    memory_id = None

    try:
        try:
            memories_response = memory_client.list_memories()
            existing_memory = None

            memories_list = memories_response
            if isinstance(memories_response, dict):
                memories_list = memories_response.get('memories', [])

            for memory in memories_list:
                if memory.get('id', '').startswith(memory_name):
                    existing_memory = memory
                    memory_id = memory.get('id')
                    print(f"Found existing memory resource: {memory_id}")
                    break
        except Exception as e:
            print(f"Could not list memories: {e}")
            existing_memory = None

        if not existing_memory:
            try:
                strategies = []

                response = memory_client.create_memory_and_wait(
                    name=memory_name,
                    strategies=strategies,
                    description="Short-term memory for ACME chatbot",
                    event_expiry_days=7
                )

                memory_id = response.get('id')
                print(f"Created new memory resource: {memory_id}")

            except Exception as create_error:
                if "already exists" in str(create_error):
                    print(f"Memory already exists: {memory_name}")

                    try:
                        memories_response = memory_client.list_memories()
                        memories_list = memories_response
                        if isinstance(memories_response, dict):
                            memories_list = memories_response.get('memories', [])

                        memory_id = next((m.get('id') for m in memories_list if m.get('id', '').startswith(memory_name)), None)

                        if memory_id:
                            print(f"Retrieved existing memory ID: {memory_id}")
                        else:
                            raise Exception(f"Could not find memory ID starting with {memory_name}")

                    except Exception as retrieval_error:
                        print(f"Failed to retrieve existing memory ID: {retrieval_error}")
                        raise
                else:
                    raise create_error

        if not memory_id:
            raise Exception("Could not obtain memory_id")

        return ACMEChatMemoryHooks(
            memory_client=memory_client,
            memory_id=memory_id,
            actor_id=actor_id,
            session_id=session_id
        )

    except Exception as e:
        print(f"Could not create memory resource: {e}")

        class DummyMemoryHooks:
            def retrieve_conversation_context(self, user_query: str) -> str:
                return ""
            def save_chat_interaction(self, user_message: str, assistant_response: str):
                pass

        return DummyMemoryHooks()


def extract_session_info(payload: Dict[str, Any]) -> tuple[str, str]:
    """
    Extract session and user information from agent payload

    Args:
        payload: Agent invocation payload

    Returns:
        Tuple of (session_id, actor_id)
    """
    session_id = "default-session"
    actor_id = "anonymous-user"

    try:
        prompt = payload.get('prompt', '')
        meta_match = re.search(r'\[META:({.*?})\]', prompt)
        if meta_match:
            try:
                meta_data = json.loads(meta_match.group(1))
                session_id = meta_data.get('sid', session_id)
                actor_id = meta_data.get('uid', actor_id)
                print(f"Extracted from metadata: session={session_id}, actor={actor_id}")
            except json.JSONDecodeError as json_error:
                print(f"Could not parse metadata JSON: {json_error}")

        if session_id == "default-session":
            if 'sessionId' in payload:
                session_id = payload['sessionId']
            elif 'session_id' in payload:
                session_id = payload['session_id']

        if actor_id == "anonymous-user":
            if 'actorId' in payload:
                actor_id = payload['actorId']
            elif 'userId' in payload:
                actor_id = payload['userId']
            elif 'user_id' in payload:
                actor_id = payload['user_id']

    except Exception as e:
        print(f"Could not extract session info: {e}")

    if actor_id != "anonymous-user":
        sanitized_actor_id = actor_id.replace('@', '_at_').replace('.', '_dot_').replace('+', '_plus_')
        if not sanitized_actor_id[0].isalnum():
            sanitized_actor_id = 'user_' + sanitized_actor_id
        if sanitized_actor_id != actor_id:
            print(f"Sanitized actor ID: {actor_id} -> {sanitized_actor_id}")
            actor_id = sanitized_actor_id

    print(f"Session info extracted: session={session_id}, actor={actor_id}")
    return session_id, actor_id
