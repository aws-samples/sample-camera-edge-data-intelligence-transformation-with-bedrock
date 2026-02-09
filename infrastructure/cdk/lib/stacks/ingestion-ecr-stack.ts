import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';

export interface IngestionEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class IngestionEcrStack extends cdk.Stack {
  public readonly dockerImageAsset: ecr_assets.DockerImageAsset;
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: IngestionEcrStackProps) {
    super(scope, id, props);

    // Dockerイメージのビルドとプッシュ（CDK Asset Repositoryへ）
    this.dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'IngestionDockerImage', {
      directory: path.join(__dirname, '../../../../backend/analytics/docker/ingestion'),
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // イメージURIを構築（CDK Asset Repositoryの実際のURI）
    this.imageUri = this.dockerImageAsset.imageUri;

    // Outputs（参照用）
    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'Full image URI with tag (from CDK Asset Repository)',
    });

    new cdk.CfnOutput(this, 'AssetHash', {
      value: this.dockerImageAsset.assetHash,
      description: 'Docker image asset hash',
    });
  }
}
