import * as cdk from 'aws-cdk-lib';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { FoundationStack } from './foundation-stack';
import { TABLE_NAMES } from '../config/constants';

export interface BedrockStackProps extends cdk.StackProps {
  foundationStack: FoundationStack;
  stackPrefix: string;
}

/**
 * Bedrockスタック - deploy_bedrock.shに相当
 * 
 * 機能:
 * - Bedrock Image Detection Lambda
 * - ECRリポジトリ
 * - Dockerイメージのビルド＆プッシュ
 * - EventBridge Rules（S3イベント駆動）
 */
export class BedrockStack extends cdk.Stack {
  public readonly bedrockFunction: lambda.IFunction;

  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    // Dockerイメージのビルドとプッシュ（CDK Asset Repository）
    const dockerImageAsset = new ecr_assets.DockerImageAsset(this, 'BedrockDockerImage', {
      directory: path.join(__dirname, '../../../../backend'),
      file: 'detector/docker/bedrock/Dockerfile',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // SSM Parameter - BedrockイメージURI（将来の動的デプロイ用）
    new ssm.StringParameter(this, 'BedrockRepositoryUriParameter', {
      parameterName: '/Cedix/Ecr/BedrockRepositoryUri',
      stringValue: dockerImageAsset.imageUri,
      description: 'Bedrock Docker Image URI for Cedix deployment (with tag)',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Lambda実行ロール
    const executionRole = new iam.Role(this, 'BedrockExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDB アクセス権限
    Object.values(TABLE_NAMES).forEach((tableName) => {
      executionRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
            `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}/index/*`,
          ],
        })
      );
    });

    // S3 アクセス権限（Foundation Stackのバケット）
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [`${props.foundationStack.bucket.bucketArn}/*`],
      })
    );

    // Bedrock アクセス権限
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      })
    );

    // Lambda関数の作成
    // logRetentionを使用してログの保持期間を設定（LogGroupはLambdaが自動作成）
    // これにより既存のLogGroupとの競合を回避しつつ、ログ保持期間を管理
    this.bedrockFunction = new lambda.DockerImageFunction(this, 'BedrockFunction', {
      functionName: `${props.stackPrefix}-BedrockFunction`,
      code: lambda.DockerImageCode.fromEcr(dockerImageAsset.repository, {
        tagOrDigest: dockerImageAsset.imageTag,
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(600),
      role: executionRole,
      logRetention: logs.RetentionDays.ONE_WEEK,  // ログ保持期間を1週間に設定
      environment: {
        BUCKET_NAME: props.foundationStack.bucket.bucketName,
      },
    });

    // Parameter Store - BedrockFunctionArn
    new cdk.aws_ssm.StringParameter(this, 'BedrockFunctionArnParameter', {
      parameterName: '/Cedix/Detector/BedrockFunctionArn',
      stringValue: this.bedrockFunction.functionArn,
      description: 'ARN of the BEDROCK Image Lambda function',
    });

    // Outputs
    new cdk.CfnOutput(this, 'BedrockFunctionName', {
      value: this.bedrockFunction.functionName,
      description: 'Name of the BEDROCK Image Lambda function',
      exportName: `${props.stackPrefix}-FunctionName`,
    });

    new cdk.CfnOutput(this, 'BedrockFunctionArn', {
      value: this.bedrockFunction.functionArn,
      description: 'ARN of the BEDROCK Image Lambda function',
      exportName: `${props.stackPrefix}-FunctionArn`,
    });

    new cdk.CfnOutput(this, 'BedrockExecutionRoleArn', {
      value: executionRole.roleArn,
      description: 'ARN of the BEDROCK Image Lambda execution role',
      exportName: `${props.stackPrefix}-ExecutionRoleArn`,
    });

    new cdk.CfnOutput(this, 'ImageUri', {
      value: dockerImageAsset.imageUri,
      description: 'Docker Image URI for BEDROCK Image Lambda (CDK Asset Repository)',
      exportName: `${props.stackPrefix}-Bedrock-ImageUri`,
    });

    new cdk.CfnOutput(this, 'DeploymentNote', {
      value: [
        'EventBridge Rules are commented out in the original template.',
        'To enable S3 event-driven detection, uncomment the rules in template-bedrock.yaml',
        'or implement them in this CDK stack.',
      ].join(' '),
      description: 'Deployment notes',
    });
  }
}
