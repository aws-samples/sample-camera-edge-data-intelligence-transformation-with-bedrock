#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { WebAppStack } from '../lib/stacks/webapp-stack';

const app = new cdk.App();

// cdk.config.json を読み込み
const configPath = path.join(__dirname, '../cdk.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// config から stackPrefix と region を取得
const stackPrefix = config.stackPrefix;
const region = config.region;

// 環境設定（config の値を使用）
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: region,
};

// 環境変数から SSM Parameter の値を取得（run-cdk-webapp.sh で設定済み）
const apiUrl = process.env.SSM_API_URL || '';
const userPoolId = process.env.SSM_USER_POOL_ID || '';
const userPoolClientId = process.env.SSM_USER_POOL_CLIENT_ID || '';
const identityPoolId = process.env.SSM_IDENTITY_POOL_ID || '';
const webAppBucketName = process.env.SSM_WEB_APP_BUCKET_NAME || '';
const distributionId = process.env.SSM_DISTRIBUTION_ID || '';

console.log('\n' + '='.repeat(80));
console.log('📦 CDK Webapp Configuration');
console.log(`   Stack Prefix: ${stackPrefix}`);
console.log(`   Region: ${region}`);
console.log('='.repeat(80));

// ビルド環境変数を構築 (Vite用)
const buildEnv = {
  VITE_API_URL: apiUrl,
  VITE_USER_POOL_ID: userPoolId,
  VITE_USER_POOL_CLIENT_ID: userPoolClientId,
  VITE_IDENTITY_POOL_ID: identityPoolId,
  VITE_REGION: region,
  VITE_DEPLOY_MODE: 'production',
};

console.log('\n' + '='.repeat(80));
console.log('📦 Build Environment Variables:');
console.log(JSON.stringify(buildEnv, null, 2));
console.log('='.repeat(80) + '\n');

// WebApp スタック
new WebAppStack(app, `${stackPrefix}-webapp`, {
  env,
  stackName: `${stackPrefix}-webapp`,
  stackPrefix: stackPrefix,
  description: 'Web application deployment to S3 and CloudFront',
  buildEnv: buildEnv,
  webAppBucketName: webAppBucketName,
  distributionId: distributionId,
});

app.synth();

