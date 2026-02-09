import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface S3RecEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class S3RecEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: S3RecEcrStackProps) {
    super(scope, id, props);

    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'S3RecDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'collector/docker/s3rec/Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_collector.py (s3rec) が参照する
    // タグ付きイメージURIを保存（CDK Asset Repository）
    new ssm.StringParameter(this, 'S3RecRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/S3RecRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'S3Rec Docker Image URI for Cedix deployment (with tag)',
      tier: ssm.ParameterTier.STANDARD,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      exportName: `${props.stackPrefix}-S3Rec-ImageUri`,
    });
  }
}
