import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface KvsBaseEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

/**
 * KVS Base ECR Stack
 * 
 * Pre-built base image containing:
 * - KVS Producer SDK (amazon-kinesis-video-streams-producer-sdk-cpp)
 * - GStreamer runtime with kvssink plugin
 * 
 * Build time: ~30-60 minutes (first time only)
 * 
 * This image is used as a base for rtmp-server, reducing build time
 * from 30-60 min to ~2-3 min for Go code changes.
 */
export class KvsBaseEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: KvsBaseEcrStackProps) {
    super(scope, id, props);

    // Build KVS Base Docker image
    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'KvsBaseDockerImage', {
      directory: path.join(__dirname, '../../../../backend/camera_management/docker/rtmp_server'),
      file: 'Dockerfile.kvs-base',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - used by rtmp-server-ecr-stack
    new ssm.StringParameter(this, 'KvsBaseImageUriParameter', {
      parameterName: '/Cedix/Ecr/KvsBaseImageUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'KVS Base Docker Image URI (GStreamer + KVS SDK)',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'KVS Base Docker Image URI',
      exportName: `${props.stackPrefix}-KvsBase-ImageUri`,
    });

    new cdk.CfnOutput(this, 'BuildInfo', {
      value: 'Pre-built KVS Producer SDK + GStreamer runtime. Rebuild only when KVS SDK needs update.',
      description: 'Build strategy information',
    });
  }
}
