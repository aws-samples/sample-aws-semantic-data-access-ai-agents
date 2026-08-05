import boto3
import json
import time
import os
from boto3.session import Session
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def setup_cognito_user_pool():
    boto_session = Session()
    region = boto_session.region_name
    
    # Initialize Cognito client
    cognito_client = boto3.client('cognito-idp', region_name=region)
    
    try:
        # Create User Pool
        user_pool_response = cognito_client.create_user_pool(
            PoolName='MCPServerPool',
            Policies={
                'PasswordPolicy': {
                    'MinimumLength': 8
                }
            }
        )
        pool_id = user_pool_response['UserPool']['Id']
        
        # Create App Client
        app_client_response = cognito_client.create_user_pool_client(
            UserPoolId=pool_id,
            ClientName='MCPServerPoolClient',
            GenerateSecret=False,
            ExplicitAuthFlows=[
                'ALLOW_USER_PASSWORD_AUTH',
                'ALLOW_REFRESH_TOKEN_AUTH'
            ]
        )
        client_id = app_client_response['UserPoolClient']['ClientId']
        
        # Create User
        cognito_client.admin_create_user(
            UserPoolId=pool_id,
            Username='testuser',
            TemporaryPassword='<SET_TEMP_PASSWORD>',
            MessageAction='SUPPRESS'
        )
        
        # Set Permanent Password
        cognito_client.admin_set_user_password(
            UserPoolId=pool_id,
            Username='testuser',
            Password='<SET_USER_PASSWORD>',
            Permanent=True
        )
        
        # Authenticate User and get Access Token
        auth_response = cognito_client.initiate_auth(
            ClientId=client_id,
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': 'testuser',
                'PASSWORD': '<SET_USER_PASSWORD>'
            }
        )
        bearer_token = auth_response['AuthenticationResult']['AccessToken']
        
        # Output the required values
        print(f"Pool id: {pool_id}")
        print(f"Discovery URL: https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/openid-configuration")
        print(f"Client ID: {client_id}")
        print(f"Bearer Token: {bearer_token}")
        
        # Return values if needed for further processing
        return {
            'pool_id': pool_id,
            'client_id': client_id,
            'bearer_token': bearer_token,
            'discovery_url':f"https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/openid-configuration"
        }
        
    except Exception as e:
        print(f"Error: {e}")
        return None


def get_cognito_pool_info(pool_id, region):
    """
    Get client_id, bearer_token, and discovery_url from an existing Cognito User Pool.
    
    Args:
        pool_id (str): The Cognito User Pool ID
        region (str): AWS region where the pool exists
        
    Returns:
        dict: Dictionary containing pool_id, client_id, bearer_token, and discovery_url
              Returns None if error occurs
    """
    # Initialize Cognito client
    cognito_client = boto3.client('cognito-idp', region_name=region)
    
    try:
        # Get client ID from environment variable, or fallback to discovery
        client_id = os.getenv('COGNITO_CLIENT_ID')
        
        if not client_id:
            print("COGNITO_CLIENT_ID not found in environment, attempting to discover...")
            # List app clients for the user pool
            app_clients_response = cognito_client.list_user_pool_clients(
                UserPoolId=pool_id
            )
            
            if not app_clients_response['UserPoolClients']:
                print(f"No app clients found for pool {pool_id}")
                return None
                
            # Find the machine-to-machine client (m2m-client)
            for client in app_clients_response['UserPoolClients']:
                if 'm2m-client' in client['ClientName']:
                    client_id = client['ClientId']
                    break
            
            if not client_id:
                # Fallback: look for any client with 'App' in the name
                for client in app_clients_response['UserPoolClients']:
                    if 'App' in client['ClientName']:
                        client_id = client['ClientId']
                        break
            
            if not client_id:
                # Final fallback to first client if no specific client found
                client_id = app_clients_response['UserPoolClients'][0]['ClientId']
        
        print(f"Using client ID: {client_id}")
        
        # Use OAuth client credentials flow to get bearer token
        try:
            import requests
            import base64
            
            # Get client credentials from environment variables
            client_secret = os.getenv('COGNITO_CLIENT_SECRET')
            
            if not client_secret:
                raise ValueError("COGNITO_CLIENT_SECRET not found in environment variables")
            
            # Get the user pool details to find the domain
            user_pool_details = cognito_client.describe_user_pool(UserPoolId=pool_id)
            domain = user_pool_details['UserPool'].get('Domain')
            
            if not domain:
                raise ValueError(f"No domain configured for user pool {pool_id}")
            
            # Construct the OAuth token endpoint URL
            token_url = f"https://{domain}.auth.{region}.amazoncognito.com/oauth2/token"
            
            # Get client details to retrieve allowed scopes
            client_details = cognito_client.describe_user_pool_client(
                UserPoolId=pool_id,
                ClientId=client_id
            )
            
            allowed_scopes = client_details['UserPoolClient'].get('AllowedOAuthScopes', [])
            scope_string = ' '.join(allowed_scopes)
            
            # Prepare OAuth client credentials request
            auth_header = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            
            headers = {
                'Authorization': f'Basic {auth_header}',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            
            data = {
                'grant_type': 'client_credentials',
                'scope': scope_string
            }
            
            print(f"Making OAuth request to: {token_url}")
            response = requests.post(token_url, headers=headers, data=data)
            
            if response.status_code == 200:
                token_data = response.json()
                bearer_token = token_data.get('access_token')
                print("✅ Successfully obtained bearer token via OAuth client credentials")
            else:
                print(f"OAuth request failed: {response.status_code} - {response.text}")
                bearer_token = None
                
        except Exception as auth_error:
            print(f"OAuth authentication failed: {auth_error}")
            print("Bearer token could not be retrieved. Check client credentials and configuration.")
            bearer_token = None
        
        # Construct discovery URL
        discovery_url = f"https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/openid-configuration"
        
        # Output the required values
        print(f"Pool id: {pool_id}")
        print(f"Discovery URL: {discovery_url}")
        print(f"Client ID: {client_id}")
        if bearer_token:
            print(f"Bearer Token: {bearer_token}")
        else:
            print("Bearer Token: Could not retrieve (authentication failed)")
        
        # Return values in same format as setup_cognito_user_pool()
        return {
            'pool_id': pool_id,
            'client_id': client_id,
            'bearer_token': bearer_token,
            'discovery_url': discovery_url
        }
        
    except Exception as e:
        print(f"Error retrieving pool info: {e}")
        return None


def create_agentcore_role(agent_name, managed_policies=None):
    """
    Create an IAM role for Bedrock AgentCore with optional managed policies.
    
    Args:
        agent_name (str): Name of the agent
        managed_policies (list, optional): List of AWS managed policy ARNs or names to attach
                                         Example: ['AmazonRekognitionFullAccess', 'AmazonS3ReadOnlyAccess']
    
    Returns:
        dict: IAM role information
    """
    iam_client = boto3.client('iam')
    agentcore_role_name = f'agentcore-{agent_name}-role'
    boto_session = Session()
    region = boto_session.region_name
    account_id = boto3.client("sts").get_caller_identity()["Account"]
    role_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "BedrockPermissions",
                "Effect": "Allow",
                "Action": [
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream"
                ],
                "Resource": "*"
            },
            {
                "Sid": "ECRImageAccess",
                "Effect": "Allow",
                "Action": [
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:GetAuthorizationToken",
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer"
                ],
                "Resource": [
                    f"arn:aws:ecr:{region}:{account_id}:repository/*"
                ]
            },
            {
                "Effect": "Allow",
                "Action": [
                    "logs:DescribeLogStreams",
                    "logs:CreateLogGroup"
                ],
                "Resource": [
                    f"arn:aws:logs:{region}:{account_id}:log-group:/aws/bedrock-agentcore/runtimes/*"
                ]
            },
            {
                "Effect": "Allow",
                "Action": [
                    "logs:DescribeLogGroups"
                ],
                "Resource": [
                    f"arn:aws:logs:{region}:{account_id}:log-group:*"
                ]
            },
            {
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": [
                    f"arn:aws:logs:{region}:{account_id}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*"
                ]
            },
            {
                "Sid": "ECRTokenAccess",
                "Effect": "Allow",
                "Action": [
                    "ecr:GetAuthorizationToken"
                ],
                "Resource": "*"
            },
            {
            "Effect": "Allow",
            "Action": [
                "xray:PutTraceSegments",
                "xray:PutTelemetryRecords",
                "xray:GetSamplingRules",
                "xray:GetSamplingTargets"
                ],
             "Resource": [ "*" ]
             },
             {
                "Effect": "Allow",
                "Resource": "*",
                "Action": "cloudwatch:PutMetricData",
                "Condition": {
                    "StringEquals": {
                        "cloudwatch:namespace": "bedrock-agentcore"
                    }
                }
            },
            {
                "Sid": "GetAgentAccessToken",
                "Effect": "Allow",
                "Action": [
                    "bedrock-agentcore:GetWorkloadAccessToken",
                    "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
                    "bedrock-agentcore:GetWorkloadAccessTokenForUserId"
                ],
                "Resource": [
                  f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default",
                  f"arn:aws:bedrock-agentcore:{region}:{account_id}:workload-identity-directory/default/workload-identity/{agent_name}-*"
                ]
            }
        ]
    }
    assume_role_policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "AssumeRolePolicy",
                "Effect": "Allow",
                "Principal": {
                    "Service": "bedrock-agentcore.amazonaws.com"
                },
                "Action": "sts:AssumeRole",
                "Condition": {
                    "StringEquals": {
                        "aws:SourceAccount": f"{account_id}"
                    },
                    "ArnLike": {
                        "aws:SourceArn": f"arn:aws:bedrock-agentcore:{region}:{account_id}:*"
                    }
                }
            }
        ]
    }

    assume_role_policy_document_json = json.dumps(
        assume_role_policy_document
    )
    role_policy_document = json.dumps(role_policy)
    # Create IAM Role for the Lambda function
    try:
        agentcore_iam_role = iam_client.create_role(
            RoleName=agentcore_role_name,
            AssumeRolePolicyDocument=assume_role_policy_document_json
        )

        # Pause to make sure role is created
        time.sleep(10)
    except iam_client.exceptions.EntityAlreadyExistsException:
        print("Role already exists -- deleting and creating it again")
        
        # Detach managed policies first
        try:
            attached_policies = iam_client.list_attached_role_policies(RoleName=agentcore_role_name)
            for policy in attached_policies['AttachedPolicies']:
                print(f"Detaching managed policy: {policy['PolicyName']}")
                iam_client.detach_role_policy(
                    RoleName=agentcore_role_name,
                    PolicyArn=policy['PolicyArn']
                )
        except Exception as e:
            print(f"Error detaching managed policies: {e}")
        
        # Delete inline policies
        policies = iam_client.list_role_policies(
            RoleName=agentcore_role_name,
            MaxItems=100
        )
        print("inline policies:", policies)
        for policy_name in policies['PolicyNames']:
            iam_client.delete_role_policy(
                RoleName=agentcore_role_name,
                PolicyName=policy_name
            )
        
        print(f"deleting {agentcore_role_name}")
        iam_client.delete_role(
            RoleName=agentcore_role_name
        )
        print(f"recreating {agentcore_role_name}")
        agentcore_iam_role = iam_client.create_role(
            RoleName=agentcore_role_name,
            AssumeRolePolicyDocument=assume_role_policy_document_json
        )

    # Attach the inline AgentCore policy
    print(f"attaching inline role policy {agentcore_role_name}")
    try:
        iam_client.put_role_policy(
            PolicyDocument=role_policy_document,
            PolicyName="AgentCorePolicy",
            RoleName=agentcore_role_name
        )
    except Exception as e:
        print(e)

    # Attach managed policies if provided
    if managed_policies:
        print(f"Attaching {len(managed_policies)} managed policies...")
        for policy in managed_policies:
            try:
                # Handle both policy names and full ARNs
                if policy.startswith('arn:aws:iam::'):
                    policy_arn = policy
                else:
                    # Construct ARN for AWS managed policy
                    policy_arn = f"arn:aws:iam::aws:policy/{policy}"
                
                print(f"Attaching managed policy: {policy}")
                iam_client.attach_role_policy(
                    RoleName=agentcore_role_name,
                    PolicyArn=policy_arn
                )
                print(f"✅ Successfully attached {policy}")
                
            except Exception as e:
                print(f"❌ Failed to attach policy {policy}: {e}")

    return agentcore_iam_role
