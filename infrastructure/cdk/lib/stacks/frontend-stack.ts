import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { FoundationStack } from './foundation-stack';
import { ApplicationStack } from './application-stack';
import { CloudFrontKeysStack } from './cloudfront-keys-stack';

export interface FrontendStackProps extends cdk.StackProps {
  foundationStack: FoundationStack;
  applicationStack: ApplicationStack;
  keysStack: CloudFrontKeysStack;
  stackPrefix: string;
}

/**
 * Frontend Stack - フロントエンド層
 * 
 * 含まれるリソース:
 * - CloudFront Distribution (OAC, Cache Policies, Trusted Key Groups)
 * - S3 Bucket Policies for CloudFront
 * - Custom Resource (API Lambda環境変数更新)
 */
export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.IDistribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const foundation = props.foundationStack;
    const application = props.applicationStack;
    const keys = props.keysStack;

    // ========================================
    // 1. CloudFront Public Key & Key Group
    // ========================================
    // Keys Stackから取得したSecretを使用してPublic Keyを作成
    const publicKey = new cloudfront.CfnPublicKey(this, 'CloudFrontPublicKey', {
      publicKeyConfig: {
        name: `${props.stackPrefix}-CameraPublicKey`,
        callerReference: `${props.stackPrefix}-${this.account}-${this.region}`,
        // CloudFormation動的参照: {{resolve:secretsmanager:secretName:SecretString:public_key}}
        encodedKey: `{{resolve:secretsmanager:${keys.secretName}:SecretString:public_key}}`,
      },
    });

    // CloudFront Key Group
    const keyGroup = new cloudfront.CfnKeyGroup(this, 'CloudFrontKeyGroup', {
      keyGroupConfig: {
        name: `${props.stackPrefix}-CameraKeyGroup`,
        items: [publicKey.attrId],
      },
    });

    // ========================================
    // 2. CloudFront Origin Access Control (OAC)
    // ========================================
    const webAppOAC = new cloudfront.CfnOriginAccessControl(this, 'WebAppOAC', {
      originAccessControlConfig: {
        name: `${props.stackPrefix}-WebAppBucketOAC`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    const cameraOAC = new cloudfront.CfnOriginAccessControl(this, 'CameraOAC', {
      originAccessControlConfig: {
        name: `${props.stackPrefix}-CameraBucketOAC`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    // ========================================
    // 3. CloudFront Distribution
    // ========================================
    // S3 OriginをL1コンストラクトで作成（循環参照を回避）
    const cfnDistribution = new cloudfront.CfnDistribution(this, 'CloudFrontDistribution', {
      distributionConfig: {
        enabled: true,
        defaultRootObject: 'index.html',
        comment: `CloudFront distribution for ${props.stackPrefix}`,
        
        // デフォルトOrigin（WebAppBucket）
        origins: [
          {
            id: 'WebAppBucketOrigin',
            domainName: `${foundation.webAppBucket.bucketName}.s3.${this.region}.amazonaws.com`,
            s3OriginConfig: {},
            originAccessControlId: webAppOAC.attrId,
          },
          {
            id: 'CameraBucketOrigin',
            domainName: `${foundation.bucket.bucketName}.s3.${this.region}.amazonaws.com`,
            s3OriginConfig: {},
            originAccessControlId: cameraOAC.attrId,
          },
        ],
        
        // デフォルトBehavior
        defaultCacheBehavior: {
          targetOriginId: 'WebAppBucketOrigin',
          viewerProtocolPolicy: 'redirect-to-https',
          compress: true,
          cachePolicyId: cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId,
          allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
          cachedMethods: ['GET', 'HEAD'],
        },
        
        // 追加のBehavior
        cacheBehaviors: [
          {
            pathPattern: '/collect/*',
            targetOriginId: 'CameraBucketOrigin',
            viewerProtocolPolicy: 'https-only',
            compress: true,
            cachePolicyId: new cloudfront.CachePolicy(this, 'CollectCachePolicy', {
              cachePolicyName: `${props.stackPrefix}-CollectCachePolicy`,
              defaultTtl: cdk.Duration.seconds(3600),
              maxTtl: cdk.Duration.seconds(86400),
              minTtl: cdk.Duration.seconds(0),
              headerBehavior: cloudfront.CacheHeaderBehavior.none(),
              queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
              cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            }).cachePolicyId,
            allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
            cachedMethods: ['GET', 'HEAD'],
            trustedKeyGroups: [keyGroup.attrId],
          },
        ],
        
        // エラーレスポンス
        customErrorResponses: [
          {
            errorCode: 403,
            responseCode: 200,
            responsePagePath: '/index.html',
          },
          {
            errorCode: 404,
            responseCode: 200,
            responsePagePath: '/index.html',
          },
        ],
      },
    });

    // IDistributionインターフェース用のラッパーを作成
    this.distribution = cloudfront.Distribution.fromDistributionAttributes(this, 'Distribution', {
      distributionId: cfnDistribution.ref,
      domainName: cfnDistribution.attrDomainName,
    });

    // ========================================
    // 2-1. SSM Parameter への書き込み（Application/Foundation Stack再デプロイ時のデグレ防止）
    // ========================================
    // CloudFront Distribution ARN（Foundation StackのS3バケットポリシー復元用）
    new ssm.StringParameter(this, 'CloudFrontDistributionArnParam', {
      parameterName: '/cedix/frontend/cloudfront-distribution-arn',
      stringValue: `arn:aws:cloudfront::${this.account}:distribution/${cfnDistribution.ref}`,
      description: 'CloudFront distribution ARN for S3 bucket policies (Foundation Stack)',
    });

    // CloudFront Domain（Application StackのLambda環境変数用）
    new ssm.StringParameter(this, 'CloudFrontDomainParam', {
      parameterName: '/cedix/frontend/cloudfront-domain',
      stringValue: cfnDistribution.attrDomainName,
      description: 'CloudFront distribution domain name (Application Stack)',
    });

    // CloudFront Key Pair ID（Application StackのLambda環境変数用）
    new ssm.StringParameter(this, 'CloudFrontKeyPairIdParam', {
      parameterName: '/cedix/frontend/cloudfront-keypair-id',
      stringValue: publicKey.attrId,
      description: 'CloudFront public key ID (Application Stack)',
    });

    // CORS Origins（Application StackのAPI Gateway CORS設定用）
    new ssm.StringParameter(this, 'CorsOriginsParam', {
      parameterName: '/cedix/frontend/cors-origins',
      stringValue: JSON.stringify([
        'http://localhost:3000',
        'https://localhost:3000',
        `https://${cfnDistribution.attrDomainName}`
      ]),
      description: 'CORS allowed origins including CloudFront domain (Application Stack)',
    });

    // ========================================
    // 3. S3 Bucket Policies for CloudFront (Custom Resourceで設定)
    // ========================================
    // 注: FoundationStackのS3バケットに直接ポリシーを追加すると循環参照が発生するため、
    //     Custom Resourceを使用してデプロイ後にポリシーを追加します
    
    // UpdateBucketPolicyFunction用LogGroup（KMS暗号化）
    const updateBucketPolicyFunctionLogGroup = new logs.LogGroup(this, 'UpdateBucketPolicyFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-UpdateBucketPolicyFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const updateBucketPolicyFunction = new lambda.Function(this, 'UpdateBucketPolicyFunction', {
      functionName: `${props.stackPrefix}-UpdateBucketPolicyFunction`,
      logGroup: updateBucketPolicyFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import json
import boto3
from botocore.exceptions import ClientError

s3_client = boto3.client('s3')

def on_event(event, context):
    print(f"Event: {json.dumps(event)}")
    
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        webapp_bucket = event['ResourceProperties']['WebAppBucket']
        camera_bucket = event['ResourceProperties']['CameraBucket']
        distribution_arn = event['ResourceProperties']['DistributionArn']
        
        # WebAppBucketのポリシーを更新
        update_bucket_policy(webapp_bucket, distribution_arn)
        
        # CameraBucketのポリシーを更新
        update_bucket_policy(camera_bucket, distribution_arn)
        
        print(f"Updated bucket policies for CloudFront distribution")
        
        return {
            'PhysicalResourceId': f'bucket-policy-{distribution_arn}',
            'Data': {
                'Message': 'Bucket policies updated successfully'
            }
        }
    
    elif request_type == 'Delete':
        # 削除時は何もしない（ポリシーは残しておく）
        return {
            'PhysicalResourceId': event['PhysicalResourceId']
        }
    
    return {}

def update_bucket_policy(bucket_name, distribution_arn):
    try:
        # 既存のポリシーを取得
        response = s3_client.get_bucket_policy(Bucket=bucket_name)
        policy = json.loads(response['Policy'])
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchBucketPolicy':
            # ポリシーが存在しない場合は新規作成
            policy = {
                'Version': '2012-10-17',
                'Statement': []
            }
        else:
            raise
    
    # CloudFront用のポリシーステートメントを追加
    cloudfront_statement = {
        'Sid': 'AllowCloudFrontServicePrincipal',
        'Effect': 'Allow',
        'Principal': {
            'Service': 'cloudfront.amazonaws.com'
        },
        'Action': 's3:GetObject',
        'Resource': f'arn:aws:s3:::{bucket_name}/*',
        'Condition': {
            'StringEquals': {
                'AWS:SourceArn': distribution_arn
            }
        }
    }
    
    # 既存のCloudFrontステートメントを削除（重複を避ける）
    policy['Statement'] = [
        stmt for stmt in policy['Statement']
        if stmt.get('Sid') != 'AllowCloudFrontServicePrincipal'
    ]
    
    # 新しいステートメントを追加
    policy['Statement'].append(cloudfront_statement)
    
    # ポリシーを更新
    s3_client.put_bucket_policy(
        Bucket=bucket_name,
        Policy=json.dumps(policy)
    )
`),
      timeout: cdk.Duration.seconds(60),
    });

    // S3バケットポリシーの更新権限を付与
    updateBucketPolicyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetBucketPolicy',
          's3:PutBucketPolicy',
        ],
        resources: [
          foundation.webAppBucket.bucketArn,
          foundation.bucket.bucketArn,
        ],
      })
    );

    // Custom Resourceプロバイダーを作成
    const bucketPolicyProvider = new cr.Provider(this, 'BucketPolicyProvider', {
      onEventHandler: updateBucketPolicyFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    // Custom Resourceを作成
    const bucketPolicyResource = new cdk.CustomResource(this, 'BucketPolicyResource', {
      serviceToken: bucketPolicyProvider.serviceToken,
      properties: {
        WebAppBucket: foundation.webAppBucket.bucketName,
        CameraBucket: foundation.bucket.bucketName,
        DistributionArn: `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        Timestamp: Date.now().toString(),
      },
    });

    // Custom ResourceはCloudFront作成後に実行
    bucketPolicyResource.node.addDependency(this.distribution);

    // ========================================
    // 4. Custom Resource - API Lambda環境変数更新
    // ========================================
    // UpdateApiEnvFunction用LogGroup（KMS暗号化）
    const updateApiEnvFunctionLogGroup = new logs.LogGroup(this, 'UpdateApiEnvFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-UpdateApiEnvFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Custom Resourceを実行するLambda関数を作成
    const updateEnvFunction = new lambda.Function(this, 'UpdateApiEnvFunction', {
      functionName: `${props.stackPrefix}-UpdateApiEnvFunction`,
      logGroup: updateApiEnvFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import json
import boto3

lambda_client = boto3.client('lambda')

def on_event(event, context):
    print(f"Event: {json.dumps(event)}")
    
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        function_name = event['ResourceProperties']['FunctionName']
        cloudfront_domain = event['ResourceProperties']['CloudFrontDomain']
        key_pair_id = event['ResourceProperties']['KeyPairId']
        secret_name = event['ResourceProperties']['SecretName']
        
        # 現在の環境変数を取得
        response = lambda_client.get_function_configuration(FunctionName=function_name)
        env_vars = response.get('Environment', {}).get('Variables', {})
        
        # CloudFront関連の環境変数を追加
        env_vars['CLOUDFRONT_DOMAIN'] = cloudfront_domain
        env_vars['CLOUDFRONT_KEY_PAIR_ID'] = key_pair_id
        env_vars['CLOUDFRONT_SECRET_NAME'] = secret_name
        
        # Lambda関数の環境変数を更新
        lambda_client.update_function_configuration(
            FunctionName=function_name,
            Environment={'Variables': env_vars}
        )
        
        print(f"Updated Lambda {function_name} with CloudFront env vars")
        
        return {
            'PhysicalResourceId': f'{function_name}-cloudfront-env',
            'Data': {
                'Message': 'Environment variables updated successfully'
            }
        }
    
    elif request_type == 'Delete':
        # 削除時は何もしない（環境変数は残しておく）
        return {
            'PhysicalResourceId': event['PhysicalResourceId']
        }
    
    return {}
`),
      timeout: cdk.Duration.seconds(60),
    });

    // Lambda関数の設定を更新する権限を付与
    updateEnvFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:GetFunctionConfiguration',
          'lambda:UpdateFunctionConfiguration',
        ],
        resources: [application.apiFunction.functionArn],
      })
    );

    // Custom Resourceプロバイダーを作成
    const updateEnvProvider = new cr.Provider(this, 'UpdateApiEnvProvider', {
      onEventHandler: updateEnvFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    // Custom Resourceを作成
    const updateEnvResource = new cdk.CustomResource(this, 'UpdateApiEnvResource', {
      serviceToken: updateEnvProvider.serviceToken,
      properties: {
        FunctionName: application.apiFunction.functionName,
        CloudFrontDomain: this.distribution.distributionDomainName,
        KeyPairId: publicKey.attrId,
        SecretName: `/${props.stackPrefix}/cloudfront/keypair`,
        // デプロイごとに更新を強制するためのタイムスタンプ
        Timestamp: Date.now().toString(),
      },
    });

    // Custom ResourceはCloudFront作成後に実行
    updateEnvResource.node.addDependency(this.distribution);

    // ========================================
    // 5. Custom Resource - API Gateway CORS設定更新
    // ========================================
    // UpdateCorsFunction用LogGroup（KMS暗号化）
    const updateCorsFunctionLogGroup = new logs.LogGroup(this, 'UpdateCorsFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-UpdateCorsFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API GatewayのCORSにCloudFrontドメインを追加
    const updateCorsFunction = new lambda.Function(this, 'UpdateCorsFunction', {
      functionName: `${props.stackPrefix}-UpdateCorsFunction`,
      logGroup: updateCorsFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import json
import boto3

apigatewayv2_client = boto3.client('apigatewayv2')

def on_event(event, context):
    print(f"Event: {json.dumps(event)}")
    
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        api_id = event['ResourceProperties']['ApiId']
        cloudfront_domain = event['ResourceProperties']['CloudFrontDomain']
        
        # 現在のAPI設定を取得
        response = apigatewayv2_client.get_api(ApiId=api_id)
        
        # CORS設定を更新
        cors_config = response.get('CorsConfiguration', {})
        
        # CloudFrontドメインを追加
        cloudfront_url = f'https://{cloudfront_domain}'
        allow_origins = cors_config.get('AllowOrigins', [])
        
        if cloudfront_url not in allow_origins:
            allow_origins.append(cloudfront_url)
        
        # API Gateway CORS設定を更新
        apigatewayv2_client.update_api(
            ApiId=api_id,
            CorsConfiguration={
                'AllowOrigins': allow_origins,
                'AllowHeaders': cors_config.get('AllowHeaders', ['*']),
                'AllowMethods': cors_config.get('AllowMethods', ['*']),
                'AllowCredentials': cors_config.get('AllowCredentials', True),
            }
        )
        
        print(f"Updated API Gateway {api_id} CORS with CloudFront domain: {cloudfront_url}")
        
        return {
            'PhysicalResourceId': f'{api_id}-cors',
            'Data': {
                'Message': 'CORS configuration updated successfully'
            }
        }
    
    elif request_type == 'Delete':
        # 削除時は何もしない
        return {
            'PhysicalResourceId': event['PhysicalResourceId']
        }
    
    return {}
`),
      timeout: cdk.Duration.seconds(60),
    });

    // API Gateway更新権限を付与
    updateCorsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'apigateway:GET',
          'apigateway:PATCH',
        ],
        resources: [
          `arn:aws:apigateway:${this.region}::/apis/${application.httpApi.httpApiId}`,
        ],
      })
    );

    // Custom Resourceプロバイダーを作成
    const updateCorsProvider = new cr.Provider(this, 'UpdateCorsProvider', {
      onEventHandler: updateCorsFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    // Custom Resourceを作成
    const updateCorsResource = new cdk.CustomResource(this, 'UpdateCorsResource', {
      serviceToken: updateCorsProvider.serviceToken,
      properties: {
        ApiId: application.httpApi.httpApiId,
        CloudFrontDomain: this.distribution.distributionDomainName,
        Timestamp: Date.now().toString(),
      },
    });

    // Custom ResourceはCloudFront作成後に実行
    updateCorsResource.node.addDependency(this.distribution);

    // CloudFront Distribution ID用SSM Parameter（webapp-stack用）
    new ssm.StringParameter(this, 'CloudFrontDistributionIdParameter', {
      parameterName: '/Cedix/Main/CloudFrontDistributionId',
      stringValue: this.distribution.distributionId,
      description: 'CloudFront Distribution ID for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================
    // 6. Outputs
    // ========================================
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.distribution.distributionId,
      description: 'ID of the CloudFront distribution',
      exportName: `${props.stackPrefix}-CloudFrontDistributionId`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'Domain name of the CloudFront distribution',
      exportName: `${props.stackPrefix}-CloudFrontDomainName`,
    });

    new cdk.CfnOutput(this, 'WebAppUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'URL of the web application',
      exportName: `${props.stackPrefix}-WebAppUrl`,
    });

    new cdk.CfnOutput(this, 'CloudFrontKeyPairId', {
      value: publicKey.attrId,
      description: 'CloudFront Public Key ID for signed URLs',
      exportName: `${props.stackPrefix}-CloudFrontKeyPairId`,
    });
  }
}

