import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

export class ApiEcrStack extends cdk.Stack {
  public readonly dockerImageAsset: ecr_assets.DockerImageAsset;
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: ApiEcrStackProps) {
    super(scope, id, props);

    // Dockerイメージのビルドとプッシュ（CDK Asset Repositoryへ）
    // 注意: extraHash や buildArgs は削除。CDK のデフォルト動作（ソースファイルのハッシュベース）で
    // 変更があった時のみ再ビルドされる。毎回強制ビルドすると Docker キャッシュとの不整合が発生する。
    this.dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'ApiDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'api_gateway/Dockerfile',
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
