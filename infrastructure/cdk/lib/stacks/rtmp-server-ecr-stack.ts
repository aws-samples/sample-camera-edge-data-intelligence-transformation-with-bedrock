import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Load region from config
const configPath = path.join(__dirname, '../../cdk.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const awsRegion = config.region;

export interface RtmpServerEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

/**
 * RTMP Server ECR Stack
 * 
 * Fast build using pre-built kvs-base image:
 * - kvs-base: KVS Producer SDK + GStreamer (built separately, ~30-60 min)
 * - rtmp-server: Go application only (~2-3 min)
 * 
 * 前提条件：
 * - kvs-base-ecr-stackが先にデプロイされていること
 * - SSMパラメータ /Cedix/Ecr/KvsBaseImageUri が存在すること
 * 
 * ビルド時間：
 * - kvs-baseが既にある場合: 2-3分（Goアプリのみビルド）
 */
export class RtmpServerEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: RtmpServerEcrStackProps) {
    super(scope, id, props);

    // Get KVS Base image URI from SSM at synth time (not deploy time)
    // This requires kvs-base-ecr-stack to be deployed first
    let kvsBaseImageUri: string;
    try {
      kvsBaseImageUri = execSync(
        `aws ssm get-parameter --name /Cedix/Ecr/KvsBaseImageUri --query Parameter.Value --output text --region ${awsRegion}`,
        { encoding: 'utf-8' }
      ).trim();
    } catch (error) {
      throw new Error(
        'KVS Base image not found. Please deploy kvs-base-ecr-stack first:\n' +
        '  ./run-cdk.sh deploy cedix-imaken5-kvs-base-ecr'
      );
    }

    if (!kvsBaseImageUri || kvsBaseImageUri === 'None') {
      throw new Error(
        'KVS Base image URI is empty. Please deploy kvs-base-ecr-stack first:\n' +
        '  ./run-cdk.sh deploy cedix-imaken5-kvs-base-ecr'
      );
    }

    console.log(`Using KVS Base image: ${kvsBaseImageUri}`);

    // Build RTMP Server using kvs-base as base image
    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'RtmpServerDockerImage', {
      directory: path.join(__dirname, '../../../../backend/camera_management/docker/rtmp_server'),
      file: 'Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
      buildArgs: {
        KVS_BASE_IMAGE: kvsBaseImageUri,
      },
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_rtmp_server.py が参照する
    new ssm.StringParameter(this, 'RtmpServerRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/RtmpServerRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'RTMP Server Docker Image URI (Go app on kvs-base)',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'RTMP Server Docker Image URI',
      exportName: `${props.stackPrefix}-RtmpServer-ImageUri`,
    });

    new cdk.CfnOutput(this, 'KvsBaseImageUri', {
      value: kvsBaseImageUri,
      description: 'KVS Base Image URI used for this build',
    });

    new cdk.CfnOutput(this, 'BuildInfo', {
      value: 'Fast build: Go app only (~2-3 min). KVS SDK from kvs-base image.',
      description: 'Build strategy information',
    });
  }
}
