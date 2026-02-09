#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { CloudFrontKeysStack } from '../lib/stacks/cloudfront-keys-stack';
import { ApiEcrStack } from '../lib/stacks/api-ecr-stack';
import { IngestionEcrStack } from '../lib/stacks/ingestion-ecr-stack';
// 新しい3スタック構成
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { ApplicationStack } from '../lib/stacks/application-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
// 旧MainStackは非推奨（必要に応じてコメントアウト解除可能）
// import { MainStack } from '../lib/stacks/main-stack';
// import { WebAppStack } from '../lib/stacks/webapp-stack'; // Moved to cdk-webapp.ts
// import { WebAppTestStack } from '../lib/stacks/webapp-test-stack'; // Moved to cdk-webapp-test.ts
import { BedrockStack } from '../lib/stacks/bedrock-stack';
import { HlsYoloEcrStack } from '../lib/stacks/hlsyolo-ecr-stack';
import { S3YoloEcrStack } from '../lib/stacks/s3yolo-ecr-stack';
import { HlsRecEcrStack } from '../lib/stacks/hlsrec-ecr-stack';
import { S3RecEcrStack } from '../lib/stacks/s3rec-ecr-stack';
import { RtspReceiverEcrStack } from '../lib/stacks/rtsp-receiver-ecr-stack';
import { RtspMovieEcrStack } from '../lib/stacks/rtsp-movie-ecr-stack';
import { KvsBaseEcrStack } from '../lib/stacks/kvs-base-ecr-stack';
import { RtmpServerEcrStack } from '../lib/stacks/rtmp-server-ecr-stack';

const app = new cdk.App();

// cdk.config.json を読み込み
const configPath = path.join(__dirname, '../cdk.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// config から stackPrefix、region、s3AdditionalPrefix を取得
const stackPrefix = config.stackPrefix;
const region = config.region;
const s3AdditionalPrefix = config.s3AdditionalPrefix || undefined;  // オプショナル

// 環境設定（config の値を使用）
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: region,
};

// CloudFront Keys用の環境設定
// CloudFront Public KeyはAWSの仕様上us-east-1でのみ作成可能
// ===== メインリソースのデプロイ =====
// (0) CloudFront Keys スタック
// 注: Secrets Manager、CloudFront Public Key、Key Groupすべてap-northeast-1に作成
//     CloudFront Public Keyはグローバルリソースだが、どのリージョンのスタックでも定義可能（template.yamlと同じ）
const keysStack = new CloudFrontKeysStack(app, `${stackPrefix}-keys`, {
  env,  // ap-northeast-1を使用
  stackName: `${stackPrefix}-keys`,
  stackPrefix,  // Secret名のプレフィックス（setup-cloudfront-keys.shのSTACK_NAMEと同じ）
  description: 'CloudFront key pair for signed URLs (Secrets Manager in ap-northeast-1)',
});

// (1) ECRスタック - Dockerイメージをビルド＆プッシュ

// API用ECR
const apiEcrStack = new ApiEcrStack(app, `${stackPrefix}-api-ecr`, {
  env,
  stackName: `${stackPrefix}-api-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for API Lambda',
});

// Ingestion用ECR
const ingestionEcrStack = new IngestionEcrStack(app, `${stackPrefix}-ingestion-ecr`, {
  env,
  stackName: `${stackPrefix}-ingestion-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for Ingestion Lambda',
});

// (2) 新しい3スタック構成 - MainStackを分割

// (2-1) Foundation Stack - 基盤インフラ（VPC, DynamoDB, S3, Cognito, ECS）
const foundationStack = new FoundationStack(app, `${stackPrefix}-foundation`, {
  env,
  stackName: `${stackPrefix}-foundation`,
  stackPrefix: stackPrefix,
  s3AdditionalPrefix: s3AdditionalPrefix,  // S3バケット名にグローバル一意性を持たせるための追加プレフィックス
  description: 'Foundation infrastructure: VPC, DynamoDB, S3, Cognito, ECS',
});

// (2-2) Application Stack - アプリケーション層（OpenSearch, Lambda, API Gateway）
const applicationStack = new ApplicationStack(app, `${stackPrefix}-application`, {
  env,
  stackName: `${stackPrefix}-application`,
  stackPrefix: stackPrefix,
  description: 'Application layer: OpenSearch, Lambda, API Gateway',
  foundationStack: foundationStack,
  apiDockerImageAsset: apiEcrStack.dockerImageAsset,
  ingestionDockerImageAsset: ingestionEcrStack.dockerImageAsset,
});

// Application StackはFoundation StackとECR Stacksに依存
applicationStack.addDependency(foundationStack);
applicationStack.addDependency(apiEcrStack);
applicationStack.addDependency(ingestionEcrStack);

// (2-3) Frontend Stack - フロントエンド層（CloudFront + Custom Resource）
const frontendStack = new FrontendStack(app, `${stackPrefix}-frontend`, {
  env,
  stackName: `${stackPrefix}-frontend`,
  stackPrefix: stackPrefix,
  description: 'Frontend layer: CloudFront Distribution with OAC and Trusted Key Groups',
  foundationStack: foundationStack,
  applicationStack: applicationStack,
  keysStack: keysStack,
});

// Frontend StackはKeys Stack、Application Stackに依存
frontendStack.addDependency(keysStack);
frontendStack.addDependency(applicationStack);

// (3) Frontend Stackのアウトプットに依存するリソース
// WebAppスタックは別アプリ（cdk-webapp.ts）に移動
// WebApp Test スタックは別アプリ（cdk-webapp-test.ts）に移動

// Bedrockスタック（Foundation Stackに依存）
const bedrockStack = new BedrockStack(app, `${stackPrefix}-bedrock`, {
  env,
  stackName: `${stackPrefix}-bedrock`,
  description: 'Bedrock Image Detection Lambda',
  foundationStack: foundationStack,
  stackPrefix: stackPrefix,
});
bedrockStack.addDependency(foundationStack);

// ===== サブリソースのデプロイ（独立） =====

// HlsYolo ECR
new HlsYoloEcrStack(app, `${stackPrefix}-hlsyolo-ecr`, {
  env,
  stackName: `${stackPrefix}-hlsyolo-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for HlsYolo',
});

// HlsRec ECR
new HlsRecEcrStack(app, `${stackPrefix}-hlsrec-ecr`, {
  env,
  stackName: `${stackPrefix}-hlsrec-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for HlsRec',
});

// S3Rec ECR
new S3RecEcrStack(app, `${stackPrefix}-s3rec-ecr`, {
  env,
  stackName: `${stackPrefix}-s3rec-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for S3Rec',
});

// S3Yolo ECR
new S3YoloEcrStack(app, `${stackPrefix}-s3yolo-ecr`, {
  env,
  stackName: `${stackPrefix}-s3yolo-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for S3Yolo',
});

// RTSP Receiver ECR
new RtspReceiverEcrStack(app, `${stackPrefix}-rtsp-receiver-ecr`, {
  env,
  stackName: `${stackPrefix}-rtsp-receiver-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for RTSP Receiver',
});

// RTSP Movie ECR
new RtspMovieEcrStack(app, `${stackPrefix}-rtsp-movie-ecr`, {
  env,
  stackName: `${stackPrefix}-rtsp-movie-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for RTSP Movie',
});

// KVS Base ECR (pre-built KVS SDK + GStreamer, ~30-60 min first time only)
// Deploy this first: ./run-cdk.sh deploy cedix-imaken5-kvs-base-ecr
new KvsBaseEcrStack(app, `${stackPrefix}-kvs-base-ecr`, {
  env,
  stackName: `${stackPrefix}-kvs-base-ecr`,
  stackPrefix: stackPrefix,
  description: 'ECR repository and Docker build for KVS Base (GStreamer + KVS SDK)',
});

// RTMP Server ECR (Go app only, ~2-3 min)
// Only create if kvs-base is deployed (SSM parameter exists)
let kvsBaseExists: boolean = false;
try {
  const result = execSync(
    `aws ssm get-parameter --name /Cedix/Ecr/KvsBaseImageUri --query Parameter.Value --output text --region ${region} 2>/dev/null`,
    { encoding: 'utf-8' }
  ).trim();
  kvsBaseExists = !!(result && result !== 'None' && result.length > 0);
} catch {
  kvsBaseExists = false;
}

if (kvsBaseExists) {
  new RtmpServerEcrStack(app, `${stackPrefix}-rtmp-server-ecr`, {
    env,
    stackName: `${stackPrefix}-rtmp-server-ecr`,
    stackPrefix: stackPrefix,
    description: 'ECR repository and Docker build for RTMP Server (Go app on kvs-base)',
  });
} else {
  console.log('⚠️  Skipping rtmp-server-ecr stack: kvs-base not deployed yet.');
  console.log('   Deploy kvs-base first: ./run-cdk.sh deploy cedix-imaken5-kvs-base-ecr');
}

app.synth();
