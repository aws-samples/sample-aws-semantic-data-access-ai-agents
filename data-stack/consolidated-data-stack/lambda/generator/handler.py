import json
import os
import random
import uuid
from datetime import datetime
from typing import Any

import boto3

# Event types and their probabilities
EVENT_TYPES = ['start', 'pause', 'resume', 'stop', 'complete']
EVENT_WEIGHTS = [0.30, 0.15, 0.15, 0.25, 0.15]

DEVICE_TYPES = ['mobile', 'web', 'tv', 'tablet']
DEVICE_WEIGHTS = [0.35, 0.30, 0.25, 0.10]

QUALITY_LEVELS = ['SD', 'HD', '4K']
QUALITY_WEIGHTS = [0.20, 0.50, 0.30]

TITLE_TYPES = ['movie', 'series', 'documentary']
TITLE_WEIGHTS = [0.60, 0.30, 0.10]

CONNECTION_TYPES = ['wifi', 'mobile', 'fiber', 'cable', 'dsl', 'satellite']
ISPS = ['Comcast', 'AT&T', 'Verizon', 'Spectrum', 'Cox', 'CenturyLink']

COUNTRIES = ['US']
US_STATES = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI']
CITIES = {
    'CA': ['Los Angeles', 'San Francisco', 'San Diego'],
    'TX': ['Houston', 'Dallas', 'Austin'],
    'FL': ['Miami', 'Orlando', 'Tampa'],
    'NY': ['New York', 'Buffalo', 'Albany'],
}

lambda_client = boto3.client('lambda')


def generate_event() -> dict[str, Any]:
    """Generate a single telemetry event."""
    state = random.choice(US_STATES)
    city = random.choice(CITIES.get(state, ['Unknown']))

    event = {
        'event_id': str(uuid.uuid4()),
        'event_type': random.choices(EVENT_TYPES, weights=EVENT_WEIGHTS)[0],
        'event_timestamp': datetime.utcnow().isoformat() + 'Z',
        'customer_id': f'cust_{random.randint(1, 100000):06d}',
        'title_id': f'title_{random.randint(1, 10000):05d}',
        'session_id': str(uuid.uuid4()),
        'device_id': str(uuid.uuid4()),
        'title_type': random.choices(TITLE_TYPES, weights=TITLE_WEIGHTS)[0],
        'device_type': random.choices(DEVICE_TYPES, weights=DEVICE_WEIGHTS)[0],
        'device_os': random.choice(['iOS', 'Android', 'Windows', 'macOS', 'Linux', 'tvOS', 'Roku']),
        'app_version': f'{random.randint(1, 5)}.{random.randint(0, 9)}.{random.randint(0, 99)}',
        'quality': random.choices(QUALITY_LEVELS, weights=QUALITY_WEIGHTS)[0],
        'bandwidth_mbps': round(random.uniform(5.0, 100.0), 2),
        'buffering_events': random.randint(0, 5),
        'buffering_duration_seconds': round(random.uniform(0, 30.0), 2),
        'error_count': random.randint(0, 2),
        'watch_duration_seconds': random.randint(0, 7200),
        'position_seconds': random.randint(0, 7200),
        'completion_percentage': round(random.uniform(0, 100.0), 2),
        'ip_address': f'{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}',
        'isp': random.choice(ISPS),
        'connection_type': random.choice(CONNECTION_TYPES),
        'country': 'US',
        'state': state,
        'city': city,
    }
    return event


def handler(event: dict, context: Any) -> dict:
    """Lambda handler - generates events and invokes producer."""
    batch_size = int(os.environ.get('BATCH_SIZE', '1000'))
    producer_function = os.environ.get('PRODUCER_FUNCTION_NAME')

    events = [generate_event() for _ in range(batch_size)]

    # Invoke producer Lambda with batch
    if producer_function:
        lambda_client.invoke(
            FunctionName=producer_function,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps({'events': events}),
        )

    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': f'Generated {len(events)} events',
            'batch_size': batch_size,
        }),
    }
