import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface HlsRecEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class HlsRecEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: HlsRecEcrStackProps) {
    super(scope, id, props);

    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'HlsRecDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'collector/docker/hlsrec/Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_collector.py (hlsrec) が参照する
    // タグ付きイメージURIを保存（CDK Asset Repository）
    new ssm.StringParameter(this, 'HlsRecRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/HlsRecRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'HlsRec Docker Image URI for Cedix deployment (with tag)',
      tier: ssm.ParameterTier.STANDARD,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      exportName: `${props.stackPrefix}-HlsRec-ImageUri`,
    });
  }
}
