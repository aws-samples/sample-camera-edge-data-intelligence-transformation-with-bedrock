import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface RtspReceiverEcrStackProps extends cdk.StackProps {
  stackPrefix: string;
}

/**
 * RTSP Receiver ECR Stack
 * 
 * Multi-stage Dockerfileでビルド：
 * - Builder Stage: KVS Producer SDKビルド（初回のみ、以降はキャッシュ）
 * - Runtime Stage: 実行環境（常に高速）
 * 
 * キャッシュ戦略：
 * - 初回デプロイ: 15-30分（Builder stageをビルド）
 * - 2回目以降: 数秒〜数十秒（Builder stageのキャッシュを再利用）
 * - KVS SDKバージョンアップ時のみ再ビルド
 */
export class RtspReceiverEcrStack extends cdk.Stack {
  public readonly imageUri: string;

  constructor(scope: Construct, id: string, props: RtspReceiverEcrStackProps) {
    super(scope, id, props);

    // Multi-stage DockerfileでRuntime Imageをビルド
    // Dockerのビルドキャッシュが有効なため、2回目以降は高速
    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'RtspReceiverDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'camera_management/docker/rtsp_reciver/Dockerfile',  // Note: typo "reciver" is intentional (matches actual directory name)
      platform: ecr_assets.Platform.LINUX_AMD64,
      // Note: ファイル内容のハッシュで自動的にinvalidationが判定される
      // entrypoint.shが変更された場合のみRuntime stageが再ビルドされる
    });

    this.imageUri = dockerImageAsset.imageUri;

    // SSM Parameter - deploy_rtsp_receiver.py が参照する
    new ssm.StringParameter(this, 'RtspReceiverRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/RtspReceiverRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'RTSP Receiver Docker Image URI (Runtime with KVS SDK)',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.imageUri,
      description: 'RTSP Receiver Docker Image URI',
      exportName: `${props.stackPrefix}-RtspReceiver-ImageUri`,
    });

    new cdk.CfnOutput(this, 'BuildInfo', {
      value: 'Multi-stage build: Builder stage cached after first build',
      description: 'Build strategy information',
    });
  }
}
