import os
import sys
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from datetime import datetime
import click
from tqdm import tqdm
import json

from generators.customer_generator import CustomerGenerator
from generators.title_generator import TitleGenerator
from generators.telemetry_generator import TelemetryGenerator
from generators.campaign_generator import CampaignGenerator

class DataGenerator:
    def __init__(self, output_dir: str = 'output', seed: int = 42):
        self.output_dir = output_dir
        self.seed = seed
        self._create_output_directories()
        
    def _create_output_directories(self):
        directories = [
            os.path.join(self.output_dir, 'customers'),
            os.path.join(self.output_dir, 'titles'),
            os.path.join(self.output_dir, 'telemetry'),
            os.path.join(self.output_dir, 'campaigns')
        ]
        for directory in directories:
            os.makedirs(directory, exist_ok=True)
    
    def generate_all_data(self, num_customers: int = 100000, 
                         num_titles: int = 10000,
                         num_telemetry_events: int = 10000000,
                         num_campaigns: int = 500):
        
        click.echo(f"Starting data generation with seed: {self.seed}")
        
        # Generate customers
        click.echo("\n1. Generating customer data...")
        customer_gen = CustomerGenerator(seed=self.seed)
        customers_df = customer_gen.generate_customers(num_customers)
        # Convert datetime columns to strings for Athena compatibility
        customers_df = self._convert_datetime_columns(customers_df)
        self._save_to_parquet(customers_df, 'customers/customers.parquet')
        click.echo(f"   Generated {len(customers_df):,} customers")
        
        # Generate titles
        click.echo("\n2. Generating title data...")
        title_gen = TitleGenerator(seed=self.seed)
        titles_df = title_gen.generate_titles(num_titles)
        # Convert datetime columns to strings for Athena compatibility
        titles_df = self._convert_datetime_columns(titles_df)
        self._save_to_parquet(titles_df, 'titles/titles.parquet')
        click.echo(f"   Generated {len(titles_df):,} titles")
        
        # Generate telemetry events
        click.echo("\n3. Generating telemetry data...")
        telemetry_gen = TelemetryGenerator(customers_df, titles_df, seed=self.seed)
        
        # Generate in batches for memory efficiency
        batch_size = 1000000
        num_batches = (num_telemetry_events + batch_size - 1) // batch_size
        
        for i in tqdm(range(num_batches), desc="   Generating telemetry batches"):
            events_in_batch = min(batch_size, num_telemetry_events - i * batch_size)
            telemetry_df = telemetry_gen.generate_telemetry_events(events_in_batch)

            # Extract partition keys (Hive format: year=/month=/day=/hour=)
            telemetry_df['_year'] = telemetry_df['event_timestamp'].dt.strftime('%Y')
            telemetry_df['_month'] = telemetry_df['event_timestamp'].dt.strftime('%m')
            telemetry_df['_day'] = telemetry_df['event_timestamp'].dt.strftime('%d')
            telemetry_df['_hour'] = telemetry_df['event_timestamp'].dt.strftime('%H')

            # Convert timestamp to string for Parquet/Athena compatibility
            telemetry_df['event_timestamp'] = telemetry_df['event_timestamp'].dt.strftime('%Y-%m-%d %H:%M:%S')

            # Save each batch with Hive-style partitioning
            for (year, month, day, hour), part_df in telemetry_df.groupby(['_year', '_month', '_day', '_hour']):
                filename = f'telemetry/year={year}/month={month}/day={day}/hour={hour}/batch_{i:04d}.parquet'
                os.makedirs(os.path.dirname(os.path.join(self.output_dir, filename)), exist_ok=True)
                # Drop partition helper columns before saving
                self._save_to_parquet(part_df.drop(['_year', '_month', '_day', '_hour'], axis=1), filename)
        
        click.echo(f"   Generated {num_telemetry_events:,} telemetry events")
        
        # Generate ad campaigns
        click.echo("\n4. Generating ad campaign data...")
        campaign_gen = CampaignGenerator(seed=self.seed)
        campaigns_df = campaign_gen.generate_campaigns(num_campaigns)
        # Convert datetime columns to strings for Athena compatibility
        campaigns_df = self._convert_datetime_columns(campaigns_df)
        self._save_to_parquet(campaigns_df, 'campaigns/campaigns.parquet')
        click.echo(f"   Generated {len(campaigns_df):,} ad campaigns")
        
        # Generate metadata
        self._generate_metadata({
            'generation_timestamp': datetime.now().isoformat(),
            'seed': self.seed,
            'num_customers': num_customers,
            'num_titles': num_titles,
            'num_telemetry_events': num_telemetry_events,
            'num_campaigns': num_campaigns
        })
        
        click.echo("\nData generation complete!")
        click.echo(f"Output directory: {os.path.abspath(self.output_dir)}")
    
    def _convert_datetime_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert datetime and date columns to strings for Athena compatibility."""
        df = df.copy()
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime('%Y-%m-%d %H:%M:%S')
            elif df[col].dtype == 'object':
                # Check if it's a date object
                try:
                    if len(df[col].dropna()) > 0:
                        sample = df[col].dropna().iloc[0]
                        if hasattr(sample, 'strftime') and not isinstance(sample, str):
                            df[col] = df[col].apply(lambda x: x.strftime('%Y-%m-%d') if x is not None else None)
                except:
                    pass
        return df

    def _save_to_parquet(self, df: pd.DataFrame, filename: str):
        filepath = os.path.join(self.output_dir, filename)
        
        # Convert list columns to JSON strings for Parquet compatibility
        for col in df.columns:
            if df[col].dtype == 'object':
                try:
                    if isinstance(df[col].iloc[0], list):
                        df[col] = df[col].apply(json.dumps)
                except:
                    pass
        
        # Write to Parquet with compression
        df.to_parquet(filepath, engine='pyarrow', compression='snappy', index=False)
    
    def _generate_metadata(self, metadata: dict):
        metadata_path = os.path.join(self.output_dir, 'metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

@click.command()
@click.option('--customers', default=100000, help='Number of customers to generate')
@click.option('--titles', default=10000, help='Number of titles to generate')
@click.option('--telemetry', default=10000000, help='Number of telemetry events to generate')
@click.option('--campaigns', default=500, help='Number of ad campaigns to generate')
@click.option('--output-dir', default='output', help='Output directory for generated data')
@click.option('--seed', default=42, help='Random seed for reproducibility')
def main(customers, titles, telemetry, campaigns, output_dir, seed):
    """Generate synthetic data for Acme Corp video streaming platform."""
    
    generator = DataGenerator(output_dir=output_dir, seed=seed)
    generator.generate_all_data(
        num_customers=customers,
        num_titles=titles,
        num_telemetry_events=telemetry,
        num_campaigns=campaigns
    )

if __name__ == '__main__':
    main()