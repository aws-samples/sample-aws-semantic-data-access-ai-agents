#!/usr/bin/env python3
import os
import sys
import boto3
import click
from pathlib import Path
from tqdm import tqdm
import concurrent.futures
from botocore.exceptions import ClientError

class S3Uploader:
    def __init__(self, bucket_name: str, region: str = 'us-east-1'):
        self.bucket_name = bucket_name
        self.s3_client = boto3.client('s3', region_name=region)
        self.region = region
    
    def verify_bucket_exists(self):
        """Verify that the S3 bucket exists and is accessible."""
        try:
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            click.echo(f"✓ Bucket '{self.bucket_name}' exists and is accessible")
            return True
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                click.echo(f"✗ Bucket '{self.bucket_name}' does not exist", err=True)
            elif error_code == '403':
                click.echo(f"✗ Access denied to bucket '{self.bucket_name}'", err=True)
            else:
                click.echo(f"✗ Error accessing bucket: {e}", err=True)
            return False
    
    def upload_file(self, local_path: str, s3_key: str) -> bool:
        """Upload a single file to S3."""
        try:
            file_size = os.path.getsize(local_path)
            
            # Use multipart upload for files > 100MB
            if file_size > 100 * 1024 * 1024:
                self._multipart_upload(local_path, s3_key)
            else:
                self.s3_client.upload_file(local_path, self.bucket_name, s3_key)
            
            return True
        except Exception as e:
            click.echo(f"✗ Failed to upload {local_path}: {e}", err=True)
            return False
    
    def _multipart_upload(self, local_path: str, s3_key: str):
        """Handle multipart upload for large files."""
        from boto3.s3.transfer import TransferConfig
        
        config = TransferConfig(
            multipart_threshold=1024 * 25,  # 25MB
            max_concurrency=10,
            multipart_chunksize=1024 * 25,
            use_threads=True
        )
        
        self.s3_client.upload_file(
            local_path, 
            self.bucket_name, 
            s3_key,
            Config=config
        )
    
    def upload_directory(self, local_dir: str, s3_prefix: str = 'raw'):
        """Upload an entire directory to S3 maintaining structure."""
        if not os.path.exists(local_dir):
            click.echo(f"✗ Directory '{local_dir}' does not exist", err=True)
            return
        
        # Collect all files to upload
        files_to_upload = []
        for root, dirs, files in os.walk(local_dir):
            for file in files:
                if file.endswith('.parquet') or file == 'metadata.json':
                    local_path = os.path.join(root, file)
                    
                    # Calculate S3 key maintaining directory structure
                    relative_path = os.path.relpath(local_path, local_dir)
                    s3_key = f"{s3_prefix}/{relative_path}".replace('\\', '/')
                    
                    files_to_upload.append((local_path, s3_key))
        
        if not files_to_upload:
            click.echo("✗ No files found to upload", err=True)
            return
        
        click.echo(f"\nUploading {len(files_to_upload)} files to s3://{self.bucket_name}/{s3_prefix}/")
        
        # Upload files with progress bar
        successful_uploads = 0
        failed_uploads = 0
        
        with tqdm(total=len(files_to_upload), desc="Uploading files") as pbar:
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                future_to_file = {
                    executor.submit(self.upload_file, local_path, s3_key): (local_path, s3_key)
                    for local_path, s3_key in files_to_upload
                }
                
                for future in concurrent.futures.as_completed(future_to_file):
                    local_path, s3_key = future_to_file[future]
                    try:
                        success = future.result()
                        if success:
                            successful_uploads += 1
                        else:
                            failed_uploads += 1
                    except Exception as e:
                        click.echo(f"\n✗ Exception uploading {local_path}: {e}", err=True)
                        failed_uploads += 1
                    finally:
                        pbar.update(1)
        
        click.echo(f"\n✓ Upload complete: {successful_uploads} successful, {failed_uploads} failed")
        
        if successful_uploads > 0:
            click.echo(f"\nData uploaded to: s3://{self.bucket_name}/{s3_prefix}/")
            click.echo("\nNext steps:")
            click.echo("1. Run AWS Glue crawlers to update the data catalog")
            click.echo("2. Query data using Amazon Athena")
            click.echo("3. Load data into Redshift for advanced analytics")

@click.command()
@click.option('--bucket', required=True, help='S3 bucket name')
@click.option('--local-dir', default='output', help='Local directory containing generated data')
@click.option('--s3-prefix', default='raw', help='S3 prefix for uploaded files')
@click.option('--region', default='us-east-1', help='AWS region')
def main(bucket, local_dir, s3_prefix, region):
    """Upload generated data files to S3 bucket."""
    
    click.echo(f"S3 Data Upload Tool")
    click.echo(f"==================")
    click.echo(f"Bucket: {bucket}")
    click.echo(f"Region: {region}")
    click.echo(f"Local directory: {local_dir}")
    click.echo(f"S3 prefix: {s3_prefix}")
    
    uploader = S3Uploader(bucket_name=bucket, region=region)
    
    # Verify bucket exists
    if not uploader.verify_bucket_exists():
        sys.exit(1)
    
    # Upload the data
    uploader.upload_directory(local_dir, s3_prefix)

if __name__ == '__main__':
    main()