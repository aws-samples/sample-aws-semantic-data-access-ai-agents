"""Lambda Custom Resource to initialize Aurora MySQL with ACME CRM schema and sample data."""
import json
import boto3
import random
import uuid
from datetime import datetime, timedelta

rds_data = boto3.client('rds-data')


def execute_sql(resource_arn, secret_arn, database, sql):
    """Execute a SQL statement via RDS Data API."""
    return rds_data.execute_statement(
        resourceArn=resource_arn,
        secretArn=secret_arn,
        database=database,
        sql=sql,
    )


def handler(event, context):
    """CloudFormation Custom Resource handler."""
    request_type = event['RequestType']
    props = event['ResourceProperties']
    resource_arn = props['ClusterArn']
    secret_arn = props['SecretArn']
    database = props['DatabaseName']

    if request_type == 'Delete':
        return {'Data': {'Message': 'Delete - nothing to do'}}

    try:
        # Create tables
        execute_sql(resource_arn, secret_arn, database, """
            CREATE TABLE IF NOT EXISTS support_tickets (
                ticket_id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                description TEXT,
                status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
                priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                category VARCHAR(100),
                agent_name VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                INDEX idx_customer (customer_id),
                INDEX idx_status (status),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        execute_sql(resource_arn, secret_arn, database, """
            CREATE TABLE IF NOT EXISTS content_ratings (
                rating_id VARCHAR(36) PRIMARY KEY,
                customer_id VARCHAR(50) NOT NULL,
                title_id VARCHAR(50) NOT NULL,
                rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
                review_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_customer (customer_id),
                INDEX idx_title (title_id),
                INDEX idx_rating (rating)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        # Seed sample data using batch inserts via Data API
        # Generate ~200 support tickets, ~500 ratings
        _seed_support_tickets(resource_arn, secret_arn, database)
        _seed_content_ratings(resource_arn, secret_arn, database)

        return {'Data': {'Message': 'Database initialized successfully'}}

    except Exception as e:
        print(f"Error initializing database: {e}")
        raise


def _seed_support_tickets(resource_arn, secret_arn, database):
    """Seed support_tickets table with sample data."""
    categories = ['billing', 'technical', 'content', 'account']
    priorities = ['low', 'medium', 'high', 'critical']
    statuses = ['open', 'in_progress', 'resolved', 'closed']
    agents = ['Alice Chen', 'Bob Martinez', 'Carol Williams', 'David Kim', 'Eva Johnson']
    subjects = [
        'Cannot play video on mobile', 'Billing charge incorrect', 'App crashes on startup',
        'Cannot find downloaded content', 'Subtitle sync issue', 'Payment method declined',
        'Stream quality drops frequently', 'Account locked out', 'Cancel subscription request',
        'Feature request: offline mode', 'Audio out of sync', 'Login issues on smart TV',
        'Buffering on 4K content', 'Promo code not working', 'Content not available in region',
    ]

    random.seed(42)
    values = []
    for i in range(200):
        tid = str(uuid.UUID(int=random.getrandbits(128)))
        cid = f"CUST_{random.randint(1, 1000):06d}"
        subj = random.choice(subjects)
        status = random.choice(statuses)
        priority = random.choice(priorities)
        category = random.choice(categories)
        agent = random.choice(agents)
        created = datetime(2026, 1, 1) + timedelta(days=random.randint(0, 42), hours=random.randint(0, 23))
        resolved = (created + timedelta(hours=random.randint(1, 72))) if status in ('resolved', 'closed') else None
        resolved_str = f"'{resolved.strftime('%Y-%m-%d %H:%M:%S')}'" if resolved else "NULL"

        values.append(
            f"('{tid}', '{cid}', '{subj}', 'Customer reported: {subj.lower()}', "
            f"'{status}', '{priority}', '{category}', '{agent}', "
            f"'{created.strftime('%Y-%m-%d %H:%M:%S')}', {resolved_str})"
        )

    # Insert in batches of 50 (Data API has limits)
    for batch_start in range(0, len(values), 50):
        batch = values[batch_start:batch_start + 50]
        sql = f"INSERT IGNORE INTO support_tickets (ticket_id, customer_id, subject, description, status, priority, category, agent_name, created_at, resolved_at) VALUES {', '.join(batch)}"
        execute_sql(resource_arn, secret_arn, database, sql)


def _seed_content_ratings(resource_arn, secret_arn, database):
    """Seed content_ratings table with sample data."""
    reviews = [
        'Great movie, loved it!', 'Not bad, decent watch.', 'Amazing cinematography.',
        'Boring plot, would not recommend.', 'Best series this year!', 'Average at best.',
        'My kids loved it.', 'A masterpiece.', 'Too long and slow.', 'Highly recommend!',
        '', '', '', '',  # many ratings have no review text
    ]

    random.seed(44)
    values = []
    for i in range(500):
        rid = str(uuid.UUID(int=random.getrandbits(128)))
        cid = f"CUST_{random.randint(1, 1000):06d}"
        tid = f"TITLE_{random.randint(1, 500):06d}"
        rating = random.choices([1, 2, 3, 4, 5], weights=[5, 10, 25, 35, 25])[0]
        review = random.choice(reviews).replace("'", "''")
        created = datetime(2025, 6, 1) + timedelta(days=random.randint(0, 250), hours=random.randint(0, 23))
        review_str = f"'{review}'" if review else "NULL"

        values.append(
            f"('{rid}', '{cid}', '{tid}', {rating}, {review_str}, "
            f"'{created.strftime('%Y-%m-%d %H:%M:%S')}')"
        )

    for batch_start in range(0, len(values), 50):
        batch = values[batch_start:batch_start + 50]
        sql = f"INSERT IGNORE INTO content_ratings (rating_id, customer_id, title_id, rating, review_text, created_at) VALUES {', '.join(batch)}"
        execute_sql(resource_arn, secret_arn, database, sql)
