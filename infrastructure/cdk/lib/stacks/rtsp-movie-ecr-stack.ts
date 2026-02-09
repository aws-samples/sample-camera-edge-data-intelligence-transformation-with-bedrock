import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface RtspMovieEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class RtspMovieEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: RtspMovieEcrStackProps) {
    super(scope, id, props);

    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'RtspMovieDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'test_movie/docker/Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_rtsp_movie.py が参照する
    // タグ付きイメージURIを保存（CDK Asset Repository）
    new ssm.StringParameter(this, 'RtspMovieRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/RtspMovieRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'RTSP Movie Docker Image URI for Cedix deployment (with tag)',
      tier: ssm.ParameterTier.STANDARD,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      exportName: `${props.stackPrefix}-RtspMovie-ImageUri`,
    });
  }
}
