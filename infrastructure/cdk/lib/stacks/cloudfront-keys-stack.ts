import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * CloudFront Keys スタック
 * 
 * 役割：
 * - setup-cloudfront-keys.shで作成したSecrets ManagerのSecretを参照
 * - Secret情報を他のStackで使えるようにエクスポート
 * 
 * 注: CloudFront Public Key/Key Groupの作成はFrontend Stackで行う
 */
export interface CloudFrontKeysStackProps extends cdk.StackProps {
  stackPrefix: string;  // Secret名のプレフィックス（setup-cloudfront-keys.shのSTACK_NAMEと同じ）
}

export class CloudFrontKeysStack extends cdk.Stack {
  public readonly secret: secretsmanager.ISecret; // pragma: allowlist secret
  public readonly secretName: string; // pragma: allowlist secret

  constructor(scope: Construct, id: string, props?: CloudFrontKeysStackProps) {
    super(scope, id, props);

    // propsからリージョンとstackPrefixを取得（envが必須）
    if (!props?.env?.region) {
      throw new Error('CloudFrontKeysStack requires env.region to be specified');
    }
    if (!props?.stackPrefix) {
      throw new Error('CloudFrontKeysStack requires stackPrefix to be specified');
    }
    const region = props.env.region;
    const account = props.env.account || this.account;

    // Secret名を構築（setup-cloudfront-keys.shと同じ: /$STACK_NAME/cloudfront/keypair）
    this.secretName = `/${props.stackPrefix}/cloudfront/keypair`; // pragma: allowlist secret

    // ========================================
    // 1. 既存のSecrets Manager Secretを参照
    // ========================================
    // 注: キーペアは setup-cloudfront-keys.sh で事前に作成されている必要があります
    // 部分ARNを使用（サフィックスはワイルドカード）
    const secretPartialArn = `arn:aws:secretsmanager:${region}:${account}:secret:${this.secretName}`; // pragma: allowlist secret
    this.secret = secretsmanager.Secret.fromSecretPartialArn(this, 'CloudFrontKeyPairSecret', secretPartialArn);

    // ========================================
    // 2. Outputs
    // ========================================
    new cdk.CfnOutput(this, 'SecretName', {
      value: this.secretName,
      description: 'Secrets Manager secret name for CloudFront key pair',
      exportName: `${props.stackPrefix}-CloudFrontSecretName`,
    });

    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secret.secretArn,
      description: 'Secrets Manager secret ARN',
      exportName: `${props.stackPrefix}-CloudFrontSecretArn`,
    });
  }
}

