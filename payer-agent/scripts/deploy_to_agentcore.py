#!/usr/bin/env python3
"""
Deploy the x402 payer agent to Bedrock AgentCore Runtime.

This script packages the agent code and deploys it to AgentCore Runtime
using the AWS SDK (boto3).

Usage:
    python scripts/deploy_to_agentcore.py [--dry-run] [--region REGION]

Prerequisites:
    1. Deploy the CDK stack first: cd ../payer-infrastructure && cdk deploy
    2. Update CDP credentials in Secrets Manager
    3. Configure AWS credentials with appropriate permissions
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import boto3
import yaml


def load_config(config_path: str) -> dict:
    """Load and process the AgentCore configuration file."""
    with open(config_path) as f:
        config = yaml.safe_load(f)
    
    # Substitute environment variables
    def substitute_env_vars(obj):
        if isinstance(obj, str):
            if obj.startswith("${") and obj.endswith("}"):
                env_var = obj[2:-1]
                return os.environ.get(env_var, obj)
            return obj
        elif isinstance(obj, dict):
            return {k: substitute_env_vars(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [substitute_env_vars(item) for item in obj]
        return obj
    
    return substitute_env_vars(config)


def get_stack_outputs(stack_name: str, region: str) -> dict:
    """Get outputs from the CDK stack."""
    cf_client = boto3.client("cloudformation", region_name=region)
    
    try:
        response = cf_client.describe_stacks(StackName=stack_name)
        outputs = {}
        for output in response["Stacks"][0].get("Outputs", []):
            outputs[output["OutputKey"]] = output["OutputValue"]
        return outputs
    except cf_client.exceptions.ClientError as e:
        print(f"Warning: Could not get stack outputs: {e}")
        return {}


def package_agent(source_dir: str, output_path: str) -> str:
    """Package the agent code into a zip file for deployment."""
    print(f"Packaging agent from {source_dir}...")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        # Copy agent code
        agent_dest = Path(temp_dir) / "agent"
        shutil.copytree(
            Path(source_dir) / "agent",
            agent_dest,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache")
        )
        
        # Create requirements.txt for dependencies
        requirements = [
            "strands-agents>=0.1.0",
            "strands-agents-tools>=0.1.0",
            "coinbase-agentkit>=0.1.0",
            "boto3>=1.35.0",
            "httpx>=0.27.0",
            "pydantic>=2.0.0",
            "python-dotenv>=1.0.0",
        ]
        
        requirements_path = Path(temp_dir) / "requirements.txt"
        requirements_path.write_text("\n".join(requirements))
        
        # Install dependencies into the package
        print("Installing dependencies...")
        subprocess.run(
            [
                sys.executable, "-m", "pip", "install",
                "-r", str(requirements_path),
                "-t", temp_dir,
                "--quiet"
            ],
            check=True
        )
        
        # Create zip file
        print(f"Creating deployment package: {output_path}")
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(temp_dir):
                # Skip __pycache__ directories
                dirs[:] = [d for d in dirs if d != "__pycache__"]
                
                for file in files:
                    if file.endswith(".pyc"):
                        continue
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(temp_dir)
                    zf.write(file_path, arcname)
    
    package_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Package created: {package_size:.2f} MB")
    
    return output_path


def create_agentcore_runtime(
    config: dict,
    package_path: str,
    region: str,
    dry_run: bool = False
) -> dict:
    """Create or update the AgentCore Runtime."""
    runtime_config = config["runtime"]
    
    print(f"\nDeploying AgentCore Runtime: {runtime_config['name']}")
    print(f"  Region: {region}")
    print(f"  Handler: {runtime_config['handler']}")
    print(f"  Memory: {runtime_config['memory_size_mb']} MB")
    print(f"  Timeout: {runtime_config['timeout_seconds']} seconds")
    
    if dry_run:
        print("\n[DRY RUN] Would create/update AgentCore Runtime with above configuration")
        return {"runtime_id": "dry-run-runtime-id", "status": "DRY_RUN"}
    
    # Note: AgentCore API is still in preview. This uses a placeholder implementation.
    # In production, use the actual AgentCore API when available.
    
    # For now, we'll use a boto3 client approach (placeholder)
    # The actual API calls will depend on the final AgentCore API specification
    
    try:
        # Placeholder: AgentCore Runtime creation
        # When AgentCore API is GA, replace with actual API calls:
        #
        # agentcore_client = boto3.client("bedrock-agentcore", region_name=region)
        # response = agentcore_client.create_agent_runtime(
        #     agentRuntimeName=runtime_config["name"],
        #     description=runtime_config["description"],
        #     roleArn=runtime_config["role_arn"],
        #     handler=runtime_config["handler"],
        #     memorySize=runtime_config["memory_size_mb"],
        #     timeout=runtime_config["timeout_seconds"],
        #     environment=runtime_config["environment"],
        #     code={
        #         "zipFile": open(package_path, "rb").read()
        #     }
        # )
        
        print("\n" + "=" * 60)
        print("DEPLOYMENT INSTRUCTIONS")
        print("=" * 60)
        print("""
AgentCore CDK L2 constructs and full API are still in preview.
To complete deployment, use one of these methods:

Option 1: AWS Console
  1. Go to Amazon Bedrock > AgentCore > Runtimes
  2. Click "Create Runtime"
  3. Upload the deployment package: {package_path}
  4. Configure with these settings:
     - Name: {name}
     - Handler: {handler}
     - Role ARN: {role_arn}
     - Memory: {memory} MB
     - Timeout: {timeout} seconds

Option 2: AWS CLI (when available)
  aws bedrock-agentcore create-agent-runtime \\
    --agent-runtime-name {name} \\
    --handler {handler} \\
    --role-arn {role_arn} \\
    --memory-size {memory} \\
    --timeout {timeout} \\
    --zip-file fileb://{package_path}

Option 3: Strands Agents CLI
  strands deploy --config agentcore_config.yaml

The deployment package has been created at:
  {package_path}

After deployment, note the Runtime ARN for Gateway configuration.
""".format(
            package_path=package_path,
            name=runtime_config["name"],
            handler=runtime_config["handler"],
            role_arn=runtime_config.get("role_arn", "<from CDK stack output>"),
            memory=runtime_config["memory_size_mb"],
            timeout=runtime_config["timeout_seconds"],
        ))
        
        return {
            "runtime_name": runtime_config["name"],
            "package_path": package_path,
            "status": "PACKAGE_READY",
            "message": "Deployment package created. Follow manual steps above."
        }
        
    except Exception as e:
        print(f"Error during deployment: {e}")
        raise


def main():
    parser = argparse.ArgumentParser(
        description="Deploy x402 payer agent to Bedrock AgentCore Runtime"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deployed without making changes"
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "us-west-2"),
        help="AWS region for deployment"
    )
    parser.add_argument(
        "--config",
        default="agentcore_config.yaml",
        help="Path to AgentCore configuration file"
    )
    parser.add_argument(
        "--output-dir",
        default="dist",
        help="Directory for deployment artifacts"
    )
    
    args = parser.parse_args()
    
    # Get script directory and project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    
    # Change to project root
    os.chdir(project_root)
    
    print("=" * 60)
    print("x402 Payer Agent - AgentCore Deployment")
    print("=" * 60)
    
    # Load configuration
    config_path = Path(args.config)
    if not config_path.exists():
        print(f"Error: Configuration file not found: {config_path}")
        sys.exit(1)
    
    # Get CDK stack outputs to populate environment variables
    print("\nFetching CDK stack outputs...")
    stack_outputs = get_stack_outputs("X402PayerAgentStack", args.region)
    
    if stack_outputs:
        os.environ.setdefault(
            "X402_PAYER_AGENT_RUNTIME_ROLE_ARN",
            stack_outputs.get("AgentRuntimeRoleArn", "")
        )
        os.environ.setdefault(
            "X402_PAYER_AGENT_CDP_SECRET_ARN",
            stack_outputs.get("CdpSecretArn", "")
        )
        print(f"  Runtime Role ARN: {stack_outputs.get('AgentRuntimeRoleArn', 'N/A')}")
        print(f"  CDP Secret ARN: {stack_outputs.get('CdpSecretArn', 'N/A')}")
    else:
        print("  Warning: Could not fetch stack outputs. Deploy CDK stack first.")
    
    # Load and process configuration
    config = load_config(str(config_path))
    
    # Create output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)
    
    # Package the agent
    package_path = str(output_dir / "x402-payer-agent.zip")
    package_agent(str(project_root), package_path)
    
    # Deploy to AgentCore
    result = create_agentcore_runtime(
        config=config,
        package_path=package_path,
        region=args.region,
        dry_run=args.dry_run
    )
    
    # Save deployment info
    deployment_info = {
        "runtime_name": config["runtime"]["name"],
        "package_path": package_path,
        "region": args.region,
        "config": config,
        "result": result
    }
    
    info_path = output_dir / "deployment_info.json"
    with open(info_path, "w") as f:
        json.dump(deployment_info, f, indent=2, default=str)
    
    print(f"\nDeployment info saved to: {info_path}")
    print("\nDeployment preparation complete!")


if __name__ == "__main__":
    main()
