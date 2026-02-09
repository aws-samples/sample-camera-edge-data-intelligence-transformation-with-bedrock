import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WebAppStackProps extends cdk.StackProps {
  buildEnv: Record<string, string>;
  webAppBucketName: string;
  distributionId: string;
  stackPrefix: string;
}

/**
 * WebAppスタック - deploy_webapp.shに相当
 * 
 * 機能:
 * - Reactアプリのビルド（Dockerを使用）
 * - S3へのアップロード
 * - CloudFrontキャッシュの無効化
 * 
 * 注意: このスタックは別アプリ（cdk-webapp.ts）で実行されます
 * 理由: CloudFormation OutputからToken解決済みの値を取得してビルドするため
 */
export class WebAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebAppStackProps) {
    super(scope, id, props);

    const webAppPath = path.join(__dirname, '../../../../frontend/web_app');

    // バケットを参照
    const webAppBucket = s3.Bucket.fromBucketName(
      this,
      'WebAppBucket',
      props.webAppBucketName
    );

    // Distributionを参照（IDistribution として扱う）
    const distribution = cloudfront.Distribution.fromDistributionAttributes(
      this,
      'Distribution',
      {
        distributionId: props.distributionId,
        domainName: 'dummy.cloudfront.net', // BucketDeployment で必須だが実際は使われない
      }
    );
    // S3デプロイメント（CDKデプロイ時に自動的にDockerでビルド）
    new s3deploy.BucketDeployment(this, 'DeployWebApp', {
      sources: [
        s3deploy.Source.asset(webAppPath, {
          bundling: {
            image: cdk.DockerImage.fromBuild(webAppPath, {
              buildArgs: {
                ...props.buildEnv,  // cdk-webapp.tsから渡された実際の値
                CACHEBUST: Date.now().toString(),  // キャッシュ無効化
              },
            }),
            // Dockerイメージ内の /app/build を /asset-output にコピー
            command: [
              'sh',
              '-c',
              'cp -r /app/build/* /asset-output/ && echo "Build artifacts copied successfully!" && ls -la /asset-output/',
            ],
            user: 'root',
          },
        }),
      ],
      destinationBucket: webAppBucket,
      distribution: distribution,
      distributionPaths: ['/*'],
      cacheControl: [
        s3deploy.CacheControl.fromString('public, max-age=31536000, immutable'),
      ],
      prune: true,
    });

    // SSM Parameter から CloudFront Domain を取得
    const cloudfrontDomain = ssm.StringParameter.valueForStringParameter(
      this,
      '/cedix/frontend/cloudfront-domain'
    );

    // Outputs
    new cdk.CfnOutput(this, 'WebAppBucketName', {
      value: webAppBucket.bucketName,
      description: 'S3 bucket name for web app',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'WebAppUrl', {
      value: `https://${cloudfrontDomain}`,
      description: 'URL of the web application',
    });

    new cdk.CfnOutput(this, 'BuildEnv', {
      value: JSON.stringify(props.buildEnv, null, 2),
      description: 'Environment variables used for build',
    });
  }
}
