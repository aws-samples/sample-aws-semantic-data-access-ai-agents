import boto3
import json
import os
from typing import Any

kinesis = boto3.client('kinesis')
STREAM_NAME = os.environ['STREAM_NAME']


def handler(event: dict, context: Any) -> dict:
    """Lambda handler - produces events to Kinesis."""
    events_list = event.get('events', [])

    if not events_list:
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'No events to process'}),
        }

    # Build Kinesis records with partition key (add newline for JSON Lines format)
    kinesis_records = [
        {
            'Data': (json.dumps(record) + '\n').encode('utf-8'),
            'PartitionKey': record.get('customer_id', 'default'),
        }
        for record in events_list
    ]

    # Send in batches of 500 (Kinesis limit)
    total_sent = 0
    for i in range(0, len(kinesis_records), 500):
        batch = kinesis_records[i : i + 500]
        response = kinesis.put_records(StreamName=STREAM_NAME, Records=batch)
        total_sent += len(batch) - response.get('FailedRecordCount', 0)

    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': f'Sent {total_sent} events to {STREAM_NAME}',
            'recordsProcessed': len(events_list),
        }),
    }
