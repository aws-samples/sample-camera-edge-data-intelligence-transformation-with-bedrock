import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface HlsYoloEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class HlsYoloEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: HlsYoloEcrStackProps) {
    super(scope, id, props);

    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'HlsYoloDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'collector/docker/hlsyolo/Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_collector.py (hlsyolo) が参照する
    // タグ付きイメージURIを保存（CDK Asset Repository）
    new ssm.StringParameter(this, 'HlsYoloRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/HlsYoloRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'HlsYolo Docker Image URI for Cedix deployment (with tag)',
      tier: ssm.ParameterTier.STANDARD,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      exportName: `${props.stackPrefix}-HlsYolo-ImageUri`,
    });
  }
}
