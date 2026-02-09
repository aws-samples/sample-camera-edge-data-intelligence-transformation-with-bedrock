import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { FoundationStack } from './foundation-stack';
import { TABLE_NAMES } from '../config/constants';

export interface ApplicationStackProps extends cdk.StackProps {
  foundationStack: FoundationStack;
  apiDockerImageAsset: ecr_assets.DockerImageAsset;
  ingestionDockerImageAsset: ecr_assets.DockerImageAsset;
  stackPrefix: string;
}

/**
 * Application Stack - アプリケーション層
 * 
 * 含まれるリソース:
 * - OpenSearch Serverless (Collection, Policies)
 * - Lambda Functions (API, Ingestion)
 * - API Gateway (HTTP API)
 * - Parameter Store
 */
export class ApplicationStack extends cdk.Stack {
  // 公開プロパティ
  public readonly apiFunction: lambda.IFunction;
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly apiUrl: string;
  public readonly opensearchCollection: opensearchserverless.CfnCollection;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const foundation = props.foundationStack;

    // ========================================
    // 0. SSM Parameter取得用Custom Resource（Frontend Stackで設定される値を取得）
    // ========================================
    
    // GetParameterFunction用LogGroup（KMS暗号化）
    const getParameterFunctionLogGroup = new logs.LogGroup(this, 'GetParameterFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-GetParameterFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SSM Parameterから値を取得するLambda関数
    const getParameterFunction = new lambda.Function(this, 'GetParameterFunction', {
      functionName: `${props.stackPrefix}-GetParameterFunction`,
      logGroup: getParameterFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import boto3
import json

ssm = boto3.client('ssm')

def on_event(event, context):
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        param_name = event['ResourceProperties']['ParameterName']
        default_value = event['ResourceProperties']['DefaultValue']
        
        try:
            # (1) SSM Parameterの存在チェック
            response = ssm.get_parameter(Name=param_name)
            value = response['Parameter']['Value']
            print(f"✓ Parameter found: {param_name} = {value}")
        except ssm.exceptions.ParameterNotFound:
            # (3) 存在しない場合はデフォルト値
            value = default_value
            print(f"⚠ Parameter not found: {param_name}, using default: {default_value}")
        except Exception as e:
            print(f"✗ Error getting parameter {param_name}: {str(e)}")
            value = default_value
        
        return {
            'PhysicalResourceId': f'param-{param_name}',
            'Data': {
                'Value': value
            }
        }
    
    return {'PhysicalResourceId': event.get('PhysicalResourceId', 'dummy')}
`),
      timeout: cdk.Duration.seconds(60),
    });

    getParameterFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cedix/frontend/*`],
    }));

    const getParameterProvider = new cr.Provider(this, 'GetParameterProvider', {
      onEventHandler: getParameterFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    // CloudFrontドメインを取得
    const cloudfrontDomainResource = new cdk.CustomResource(this, 'CloudFrontDomainResource', {
      serviceToken: getParameterProvider.serviceToken,
      properties: {
        ParameterName: '/cedix/frontend/cloudfront-domain',
        DefaultValue: 'pending',
        ForceUpdate: Date.now().toString(), // 毎回異なる値で強制更新
      },
    });

    // CloudFront Key Pair IDを取得
    const cloudfrontKeyPairIdResource = new cdk.CustomResource(this, 'CloudFrontKeyPairIdResource', {
      serviceToken: getParameterProvider.serviceToken,
      properties: {
        ParameterName: '/cedix/frontend/cloudfront-keypair-id',
        DefaultValue: 'pending',
        ForceUpdate: Date.now().toString(), // 毎回異なる値で強制更新
      },
    });

    // CORS Originsを取得
    const corsOriginsResource = new cdk.CustomResource(this, 'CorsOriginsResource', {
      serviceToken: getParameterProvider.serviceToken,
      properties: {
        ParameterName: '/cedix/frontend/cors-origins',
        DefaultValue: JSON.stringify(['http://localhost:3000', 'https://localhost:3000']),
      },
    });

    // ========================================
    // 1. OpenSearch Serverless
    // ========================================
    const opensearchEncryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchEncryptionPolicy', {
      name: `${props.stackPrefix}-encrypt`,  // stackPrefixを使用してリージョン内で一意に
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${props.stackPrefix}-collection`],
          },
        ],
        AWSOwnedKey: true,
      }),
    });

    const opensearchNetworkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchNetworkPolicy', {
      name: `${props.stackPrefix}-network`,  // stackPrefixを使用してリージョン内で一意に
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${props.stackPrefix}-collection`],
              ResourceType: 'collection',
            },
            {
              Resource: [`collection/${props.stackPrefix}-collection`],
              ResourceType: 'dashboard',
            },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    // OpenSearch Ingestion Role
    const opensearchIngestionRole = new iam.Role(this, 'OpenSearchIngestionRole', {
      roleName: `${props.stackPrefix}_OSIP_Role`,
      assumedBy: new iam.ServicePrincipal('osis-pipelines.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    // OpenSearch Ingestion Role に詳細なポリシーを追加
    opensearchIngestionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'allowRunExportJob',
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:DescribeTable',
          'dynamodb:DescribeContinuousBackups',
          'dynamodb:ExportTableToPointInTime',
          'dynamodb:GetShardIterator',
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
        ],
        resources: [
          `${foundation.detectLogTable.tableArn}/stream/*`,
          foundation.detectLogTable.tableArn,
          `${foundation.detectLogTagTable.tableArn}/stream/*`,
          foundation.detectLogTagTable.tableArn,
        ],
      })
    );

    opensearchIngestionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'allowCheckExportjob',
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:ExportTableToPointInTime', 'dynamodb:DescribeExport'],
        resources: [
          foundation.detectLogTable.tableArn,
          `${foundation.detectLogTable.tableArn}/export/*`,
          foundation.detectLogTagTable.tableArn,
          `${foundation.detectLogTagTable.tableArn}/export/*`,
        ],
      })
    );

    opensearchIngestionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'allowReadAndWriteToS3ForExport',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:AbortMultipartUpload', 's3:PutObject', 's3:PutObjectAcl'],
        resources: [`${foundation.zeroETLBucket.bucketArn}/*`],
      })
    );

    opensearchIngestionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'aoss:CreateSecurityPolicy',
          'aoss:UpdateSecurityPolicy',
          'aoss:BatchGetCollection',
          'aoss:APIAccessAll',
          'aoss:GetSecurityPolicy',
        ],
        resources: [
          `arn:aws:aoss:${this.region}:${this.account}:collection/*`,
          `arn:aws:aoss:${this.region}:${this.account}:securitypolicy/*/*`,
        ],
      })
    );

    // Ingestion Lambda Role
    const ingestionLambdaRole = new iam.Role(this, 'IngestionLambdaRole', {
      roleName: `${props.stackPrefix}-IngestionLambdaRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    ingestionLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:DescribeStream', 'dynamodb:ListStreams'],
        resources: [`${foundation.detectLogTable.tableArn}/stream/*`],
      })
    );

    ingestionLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`],
      })
    );

    ingestionLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:ListBucket', 's3:GetBucketLocation'],
        resources: [foundation.zeroETLBucket.bucketArn, `${foundation.zeroETLBucket.bucketArn}/*`],
      })
    );

    // ========================================
    // 2. Lambda 関数の Role（先に作成）
    // ========================================
    
    // API Lambda Role（OpenSearchDataAccessPolicy で参照するため先に作成）
    const apiLambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      roleName: `${props.stackPrefix}-ApiLambdaRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // OpenSearch Data Access Policy（初期状態では API Lambda Role を除外して循環依存を回避）
    const opensearchDataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'OpenSearchDataAccessPolicy', {
      name: `${props.stackPrefix}-data`,  // stackPrefixを使用してリージョン内で一意に
      type: 'data',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${props.stackPrefix}-collection`],
              Permission: ['aoss:CreateCollectionItems', 'aoss:DeleteCollectionItems', 'aoss:UpdateCollectionItems', 'aoss:DescribeCollectionItems'],
              ResourceType: 'collection',
            },
            {
              Resource: [`index/${props.stackPrefix}-collection/${TABLE_NAMES.DETECT_LOG}`],
              Permission: ['aoss:CreateIndex', 'aoss:DeleteIndex', 'aoss:UpdateIndex', 'aoss:DescribeIndex', 'aoss:ReadDocument', 'aoss:WriteDocument'],
              ResourceType: 'index',
            },
          ],
          // 初期状態では Ingestion 関連のみ（API Lambda は Custom Resource で後から追加）
          Principal: [
            opensearchIngestionRole.roleArn,
            ingestionLambdaRole.roleArn,
            `arn:aws:iam::${this.account}:role/Admin`,
          ],
        },
      ]),
    });

    opensearchDataAccessPolicy.node.addDependency(opensearchIngestionRole);
    opensearchDataAccessPolicy.node.addDependency(ingestionLambdaRole);

    this.opensearchCollection = new opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: `${props.stackPrefix}-collection`,  // stackPrefixを使用してリージョン内で一意に
      type: 'SEARCH',
      description: 'OpenSearch collection for camera data',
      standbyReplicas: 'DISABLED',
    });

    this.opensearchCollection.node.addDependency(opensearchDataAccessPolicy);
    this.opensearchCollection.node.addDependency(opensearchNetworkPolicy);
    this.opensearchCollection.node.addDependency(opensearchEncryptionPolicy);

    // ========================================
    // 3. Lambda 関数
    // ========================================
    
    // API Lambda用LogGroup（KMS暗号化）
    const apiFunctionLogGroup = new logs.LogGroup(this, 'ApiFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-ApiFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Lambda
    this.apiFunction = new lambda.DockerImageFunction(this, 'ApiFunction', {
      functionName: `${props.stackPrefix}-ApiFunction`,
      logGroup: apiFunctionLogGroup,
      role: apiLambdaRole,
      code: lambda.DockerImageCode.fromEcr(
        props.apiDockerImageAsset.repository,
        { tagOrDigest: props.apiDockerImageAsset.assetHash }
      ),
      architecture: lambda.Architecture.X86_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      reservedConcurrentExecutions: 500,
      environment: {
        COGNITO_USER_POOL_ID: foundation.userPool.userPoolId,
        COGNITO_CLIENT_ID: foundation.userPoolClient.userPoolClientId,
        COGNITO_REGION: this.region,
        AUTH_MODE: 'cognito_authorizer',
        DEPLOY_MODE: 'production',
        CAMERA_RESOURCE_DEPLOY: 'on',
        COLLECTION_RESOURCE_DEPLOY: 'on',
        DETECTOR_RESOURCE_DEPLOY: 'on',
        BUCKET_NAME: foundation.bucket.bucketName,
        AOSS_COLLECTION_ENDPOINT: this.opensearchCollection.attrCollectionEndpoint,
        AWS_STACK_NAME: props.stackPrefix,
        LOG_LEVEL: 'INFO',  // Lambda環境でのログレベル（DEBUG, INFO, WARNING, ERROR）
        // CloudFront関連の環境変数（SSM Parameterから取得、Frontend Stack未デプロイ時は"pending"）
        CLOUDFRONT_DOMAIN: cloudfrontDomainResource.getAttString('Value'),
        CLOUDFRONT_KEY_PAIR_ID: cloudfrontKeyPairIdResource.getAttString('Value'),
        CLOUDFRONT_SECRET_NAME: `/${props.stackPrefix}/cloudfront/keypair`,
      },
    });

    // API Lambda に必要な権限を付与
    [
      foundation.placeTable,
      foundation.cameraTable,
      foundation.collectorTable,
      foundation.fileTable,
      foundation.detectorTable,
      foundation.detectLogTable,
      foundation.detectLogTagTable,
      foundation.detectTagTimeseriesTable,
      foundation.bookmarkTable,
      foundation.bookmarkDetailTable,
      foundation.tagCategoryTable,
      foundation.tagTable,
      foundation.trackLogTable,
      foundation.testMovieTable,
      foundation.rtmpNlbTable,
    ].forEach((table) => {
      table.grantReadWriteData(this.apiFunction);
    });

    foundation.bucket.grantReadWrite(this.apiFunction);
    foundation.userPool.grant(this.apiFunction, 'cognito-idp:AdminGetUser', 'cognito-idp:AdminListGroupsForUser', 'cognito-idp:ListUsers');

    // OpenSearch Serverless へのアクセス権限
    // Note: Data Access Policy で Principal を指定しているため、IAM Policy の resources は '*' で OK
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`],  // 循環依存回避のため具体的な ARN ではなくワイルドカード
      })
    );

    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:Converse',
          'bedrock:ConverseStream',
          'bedrock:GetFoundationModel',
          'bedrock:ListFoundationModels',
        ],
        resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      })
    );

    // CloudFormation、ECS、IAM等の権限も追加（簡略化）
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:*',
          'ecs:*',
          'iam:PassRole',
          'iam:GetRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:ListRolePolicies',
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath',
          'ecr:DescribeImages',
          'ecr:DescribeRepositories',
          'ecr:GetAuthorizationToken',
          'ecr:BatchGetImage',
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:DescribeLogGroups',
          'logs:PutRetentionPolicy',
          'logs:TagLogGroup',
          'events:DescribeRule',
          'events:PutRule',
          'events:PutTargets',
          'events:RemoveTargets',
          'events:DeleteRule',
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:UpdateFunctionConfiguration',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:TagResource',
          'lambda:UntagResource',
          'lambda:PutFunctionConcurrency',
          'lambda:DeleteFunctionConcurrency',
          // EC2 (Security Groups for NLB)
          'ec2:CreateSecurityGroup',
          'ec2:DeleteSecurityGroup',
          'ec2:DescribeSecurityGroups',
          'ec2:AuthorizeSecurityGroupIngress',
          'ec2:AuthorizeSecurityGroupEgress',
          'ec2:RevokeSecurityGroupIngress',
          'ec2:RevokeSecurityGroupEgress',
          'ec2:CreateTags',
          'ec2:DeleteTags',
          'ec2:DescribeVpcs',
          'ec2:DescribeSubnets',
          'ec2:DescribeAccountAttributes',
          // Elastic Load Balancing (NLB)
          'elasticloadbalancing:*',
          // KMS permissions for CloudFormation resource creation
          'kms:CreateKey',
          'kms:CreateAlias',
          'kms:DeleteAlias',
          'kms:DescribeKey',
          'kms:EnableKeyRotation',
          'kms:GetKeyPolicy',
          'kms:PutKeyPolicy',
          'kms:ScheduleKeyDeletion',
          'kms:TagResource',
          'kms:UntagResource',
          'kms:Decrypt',
          'kms:Encrypt',
          'kms:GenerateDataKey',
          'kms:GenerateDataKeyWithoutPlaintext',
          // Secrets Manager permissions for CloudFormation resource creation
          'secretsmanager:CreateSecret',
          'secretsmanager:DeleteSecret',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:UpdateSecret',
          'secretsmanager:TagResource',
          'secretsmanager:UntagResource',
          // Tagging permissions for CloudFormation resource creation
          'kinesisvideo:TagResource',
          'kinesisvideo:UntagResource',
          'ecs:TagResource',
          'ecs:UntagResource',
        ],
        resources: ['*'],
      })
    );

    // API Lambda に Secrets Manager へのアクセス権限を付与（キーペアの取得用）
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:/${props.stackPrefix}/cloudfront/keypair*`],
      })
    );

    // IAM Service Linked Role for ELB (required for first NLB creation in account)
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:CreateServiceLinkedRole'],
        resources: ['arn:aws:iam::*:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing'],
        conditions: {
          StringEquals: {
            'iam:AWSServiceName': 'elasticloadbalancing.amazonaws.com',
          },
        },
      })
    );

    // API Lambda に Kinesis Video Streams へのフルアクセス権限を付与
    // （HLS URL取得用 + CloudFormation経由でのStream作成・削除・属性取得用）
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kinesisvideo:*',
        ],
        resources: ['*'],
      })
    );

    // API Lambda に Kinesis Video Archived Media へのアクセス権限を付与
    this.apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kinesis-video-archived-media:GetHLSStreamingSessionURL',
          'kinesis-video-archived-media:GetClip',
          'kinesis-video-archived-media:GetImages',
        ],
        resources: ['*'],
      })
    );

    // Ingestion Lambda用LogGroup（KMS暗号化）
    const ingestionFunctionLogGroup = new logs.LogGroup(this, 'IngestionFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-IngestionFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Ingestion Lambda
    const ingestionFunction = new lambda.DockerImageFunction(this, 'IngestionFunction', {
      functionName: `${props.stackPrefix}-IngestionFunction`,
      logGroup: ingestionFunctionLogGroup,
      code: lambda.DockerImageCode.fromEcr(
        props.ingestionDockerImageAsset.repository,
        { tagOrDigest: props.ingestionDockerImageAsset.assetHash }
      ),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      reservedConcurrentExecutions: 100,
      role: ingestionLambdaRole,
      environment: {
        OPENSEARCH_ENDPOINT: this.opensearchCollection.attrCollectionEndpoint,
        INDEX_NAME: TABLE_NAMES.DETECT_LOG,
        DLQ_BUCKET: foundation.zeroETLBucket.bucketName,
        DLQ_PREFIX: 'dlqs/lambda/',
      },
      events: [
        new eventsources.DynamoEventSource(foundation.detectLogTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 100,
          maxBatchingWindow: cdk.Duration.seconds(10),
          bisectBatchOnError: true,
          retryAttempts: 2,
          onFailure: new eventsources.S3OnFailureDestination(foundation.zeroETLBucket),
        }),
      ],
    });

    // ========================================
    // 2.6. OpenSearch Data Access Policy 更新用 Custom Resource
    // ========================================
    
    // UpdateDataAccessPolicyFunction用LogGroup（KMS暗号化）
    const updateDataAccessPolicyFunctionLogGroup = new logs.LogGroup(this, 'UpdateDataAccessPolicyFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props.stackPrefix}-UpdateDataAccessPolicyFunction`,
      encryptionKey: foundation.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Lambda Role を Data Access Policy に追加する Custom Resource
    const updateDataAccessPolicyFunction = new lambda.Function(this, 'UpdateDataAccessPolicyFunction', {
      functionName: `${props.stackPrefix}-UpdateDataAccessPolicyFunction`,
      logGroup: updateDataAccessPolicyFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import boto3
import json

aoss = boto3.client('opensearchserverless')

def on_event(event, context):
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        policy_name = event['ResourceProperties']['PolicyName']
        stack_prefix = event['ResourceProperties']['StackPrefix']
        api_lambda_role_arn = event['ResourceProperties']['ApiLambdaRoleArn']
        ingestion_role_arn = event['ResourceProperties']['IngestionRoleArn']
        ingestion_lambda_role_arn = event['ResourceProperties']['IngestionLambdaRoleArn']
        admin_role_arn = event['ResourceProperties']['AdminRoleArn']
        index_name = event['ResourceProperties']['IndexName']
        
        # 既存のポリシーを取得
        try:
            response = aoss.get_access_policy(name=policy_name, type='data')
            print(f"✓ Found existing policy: {policy_name}")
        except aoss.exceptions.ResourceNotFoundException:
            print(f"⚠ Policy not found: {policy_name}")
            return {
                'PhysicalResourceId': f'update-policy-{policy_name}',
                'Data': {'Status': 'PolicyNotFound'}
            }
        
        # ポリシーを更新（API Lambda Role を追加）
        updated_policy = [
            {
                "Rules": [
                    {
                        "Resource": [f"collection/{stack_prefix}-collection"],
                        "Permission": [
                            "aoss:CreateCollectionItems",
                            "aoss:DeleteCollectionItems",
                            "aoss:UpdateCollectionItems",
                            "aoss:DescribeCollectionItems"
                        ],
                        "ResourceType": "collection"
                    },
                    {
                        "Resource": [f"index/{stack_prefix}-collection/{index_name}"],
                        "Permission": [
                            "aoss:CreateIndex",
                            "aoss:DeleteIndex",
                            "aoss:UpdateIndex",
                            "aoss:DescribeIndex",
                            "aoss:ReadDocument",
                            "aoss:WriteDocument"
                        ],
                        "ResourceType": "index"
                    }
                ],
                "Principal": [
                    ingestion_role_arn,
                    ingestion_lambda_role_arn,
                    api_lambda_role_arn,  # ← API Lambda Role を追加
                    admin_role_arn
                ]
            }
        ]
        
        aoss.update_access_policy(
            name=policy_name,
            type='data',
            policyVersion=response['accessPolicyDetail']['policyVersion'],
            policy=json.dumps(updated_policy)
        )
        
        print(f"✓ Updated Data Access Policy: {policy_name} with API Lambda Role")
        
        return {
            'PhysicalResourceId': f'update-policy-{policy_name}',
            'Data': {'Status': 'Updated'}
        }
    
    return {'PhysicalResourceId': event.get('PhysicalResourceId', 'dummy')}
`),
      timeout: cdk.Duration.seconds(60),
    });

    updateDataAccessPolicyFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['aoss:GetAccessPolicy', 'aoss:UpdateAccessPolicy'],
      resources: ['*'],  // OpenSearch Serverless access policies require * resource
    }));

    const updateDataAccessPolicyProvider = new cr.Provider(this, 'UpdateDataAccessPolicyProvider', {
      onEventHandler: updateDataAccessPolicyFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    const updateDataAccessPolicyResource = new cdk.CustomResource(this, 'UpdateDataAccessPolicyResource', {
      serviceToken: updateDataAccessPolicyProvider.serviceToken,
      properties: {
        PolicyName: `${props.stackPrefix}-data`,  // stackPrefixを使用
        StackPrefix: props.stackPrefix,  // Collection名生成に使用
        ApiLambdaRoleArn: apiLambdaRole.roleArn,
        IngestionRoleArn: opensearchIngestionRole.roleArn,
        IngestionLambdaRoleArn: ingestionLambdaRole.roleArn,
        AdminRoleArn: `arn:aws:iam::${this.account}:role/Admin`,
        IndexName: TABLE_NAMES.DETECT_LOG,
      },
    });

    // Custom Resource は Policy と Collection と API Function が作成された後に実行
    updateDataAccessPolicyResource.node.addDependency(opensearchDataAccessPolicy);
    updateDataAccessPolicyResource.node.addDependency(this.opensearchCollection);
    updateDataAccessPolicyResource.node.addDependency(this.apiFunction);

    // ========================================
    // 3. API Gateway (HTTP API)
    // ========================================
    
    // CORS 設定
    // Note: CloudFront ドメインは Frontend Stack の Custom Resource で追加されるため、
    //       ここでは基本的な localhost のみを設定
    //       SSM Parameter から取得した値は参考情報として使用するが、
    //       Frontend Stack の UpdateCorsResource が最終的な CORS 設定を行う
    const cloudfrontDomain = cloudfrontDomainResource.getAttString('Value');
    const allowOrigins = [
      'http://localhost:3000',
      'https://localhost:3000',
    ];
    
    // CloudFront ドメインが存在し、"pending" でない場合は追加
    // （ただし、Frontend Stack の Custom Resource で確実に追加されるため、これはバックアップ）
    if (cloudfrontDomain && cloudfrontDomain !== 'pending') {
      allowOrigins.push(`https://${cloudfrontDomain}`);
    }
    
    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: allowOrigins,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Amz-User-Agent'],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST, apigatewayv2.CorsHttpMethod.PUT, apigatewayv2.CorsHttpMethod.DELETE, apigatewayv2.CorsHttpMethod.OPTIONS],
        allowCredentials: true,
      },
    });

    // Cognito Authorizer の作成
    const cognitoAuthorizer = new authorizers.HttpUserPoolAuthorizer('CognitoAuth', foundation.userPool, {
      userPoolClients: [foundation.userPoolClient],
      identitySource: ['$request.header.Authorization'],
    });

    // Lambda統合
    const integration = new integrations.HttpLambdaIntegration('ApiIntegration', this.apiFunction);
    
    // 認証が必要なルート
    // Note: OPTIONS リクエストは corsPreflight 設定により API Gateway が自動応答するため、
    //       ここでは GET/POST/PUT/DELETE のみを指定
    this.httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [
        apigatewayv2.HttpMethod.GET,
        apigatewayv2.HttpMethod.POST,
        apigatewayv2.HttpMethod.PUT,
        apigatewayv2.HttpMethod.DELETE,
      ],
      integration,
      authorizer: cognitoAuthorizer,
    });

    this.apiUrl = this.httpApi.apiEndpoint;

    // ========================================
    // 4. Parameter Store
    // ========================================
    // Note: Foundation Stackで作成されるリソースのParameterは、Foundation Stackで保存される
    // Application Stackでは、Application固有のリソース情報のみを保存

    new ssm.StringParameter(this, 'GstreamerLogModeParameter', {
      parameterName: '/Cedix/Main/GstreamerLogMode',
      stringValue: 'null',
      description: 'GStreamer log mode for RTSP receivers (stdout or null)',
    });

    // API URL用SSM Parameter（webapp-stack用）
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: '/Cedix/Main/ApiUrl',
      stringValue: this.apiUrl,
      description: 'API Gateway URL for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ========================================
    // 5. Outputs
    // ========================================
    
    // API関連
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'URL of the API Gateway endpoint',
      exportName: `${props.stackPrefix}-ApiUrl`,
    });

    new cdk.CfnOutput(this, 'HttpApiId', {
      value: this.httpApi.httpApiId,
      description: 'ID of the HTTP API Gateway (for CORS configuration by Frontend Stack)',
      exportName: `${props.stackPrefix}-HttpApiId`,
    });

    new cdk.CfnOutput(this, 'ApiFunctionName', {
      value: this.apiFunction.functionName,
      description: 'Name of the API Lambda function',
      exportName: `${props.stackPrefix}-ApiFunctionName`,
    });

    // OpenSearch Serverless
    new cdk.CfnOutput(this, 'AossCollectionId', {
      value: this.opensearchCollection.ref,
      description: 'ID of the OpenSearch Serverless collection',
      exportName: `${props.stackPrefix}-AossCollectionId`,
    });

    new cdk.CfnOutput(this, 'AossCollectionArn', {
      value: this.opensearchCollection.attrArn,
      description: 'ARN of the OpenSearch Serverless collection',
      exportName: `${props.stackPrefix}-AossCollectionArn`,
    });

    new cdk.CfnOutput(this, 'AossCollectionEndpoint', {
      value: this.opensearchCollection.attrCollectionEndpoint,
      description: 'Collection endpoint of the OpenSearch Serverless collection',
      exportName: `${props.stackPrefix}-AossCollectionEndpoint`,
    });

    // Ingestion Lambda
    new cdk.CfnOutput(this, 'IngestionFunctionName', {
      value: ingestionFunction.functionName,
      description: 'Name of the Ingestion Lambda function',
      exportName: `${props.stackPrefix}-IngestionFunctionName`,
    });

    new cdk.CfnOutput(this, 'IngestionFunctionArn', {
      value: ingestionFunction.functionArn,
      description: 'ARN of the Ingestion Lambda function',
      exportName: `${props.stackPrefix}-IngestionFunctionArn`,
    });

    new cdk.CfnOutput(this, 'IngestionRoleArn', {
      value: ingestionLambdaRole.roleArn,
      description: 'ARN of the Ingestion Lambda execution role',
      exportName: `${props.stackPrefix}-IngestionRoleArn`,
    });

    // Parameter Store キー名
    new cdk.CfnOutput(this, 'StackNameParameterOutput', {
      value: '/Cedix/Main/StackName',
      description: 'Parameter Store key for Stack name',
      exportName: `${props.stackPrefix}-StackNameParameter`,
    });

    new cdk.CfnOutput(this, 'CameraBucketNameParameterOutput', {
      value: '/Cedix/Main/CameraBucketName',
      description: 'Parameter Store key for Camera bucket name',
      exportName: `${props.stackPrefix}-CameraBucketNameParameter`,
    });

    new cdk.CfnOutput(this, 'EcsTaskRoleArnParameterOutput', {
      value: '/Cedix/Main/EcsTaskRoleArn',
      description: 'Parameter Store key for ECS Task Role ARN',
      exportName: `${props.stackPrefix}-EcsTaskRoleArnParameter`,
    });

    new cdk.CfnOutput(this, 'EcsTaskExecutionRoleArnParameterOutput', {
      value: '/Cedix/Main/EcsTaskExecutionRoleArn',
      description: 'Parameter Store key for ECS Task Execution Role ARN',
      exportName: `${props.stackPrefix}-EcsTaskExecutionRoleArnParameter`,
    });

    new cdk.CfnOutput(this, 'CollectorSecurityGroupIdParameterOutput', {
      value: '/Cedix/Main/CollectorSecurityGroupId',
      description: 'Parameter Store key for Collector Security Group ID',
      exportName: `${props.stackPrefix}-CollectorSecurityGroupIdParameter`,
    });

    new cdk.CfnOutput(this, 'CameraClusterNameParameterOutput', {
      value: '/Cedix/Main/CameraClusterName',
      description: 'Parameter Store key for Camera Cluster name',
      exportName: `${props.stackPrefix}-CameraClusterNameParameter`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnet1IdParameterOutput', {
      value: '/Cedix/Main/PrivateSubnet1Id',
      description: 'Parameter Store key for Private Subnet 1 ID',
      exportName: `${props.stackPrefix}-PrivateSubnet1IdParameter`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnet2IdParameterOutput', {
      value: '/Cedix/Main/PrivateSubnet2Id',
      description: 'Parameter Store key for Private Subnet 2 ID',
      exportName: `${props.stackPrefix}-PrivateSubnet2IdParameter`,
    });

    // CloudFront関連（start.sh用に残す）
    new cdk.CfnOutput(this, 'CloudFrontDistributionDomainName', {
      value: cloudfrontDomainResource.getAttString('Value'),
      description: 'CloudFront Distribution Domain Name (for start.sh)',
      exportName: `${props.stackPrefix}-CloudFrontDistributionDomainName`,
    });
  }
}

