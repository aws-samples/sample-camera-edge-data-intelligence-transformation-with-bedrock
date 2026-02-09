import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { TABLE_NAMES } from '../config/constants';

export interface FoundationStackProps extends cdk.StackProps {
  stackPrefix: string;
  s3AdditionalPrefix?: string;  // S3バケット名にグローバル一意性を持たせるための追加プレフィックス
}

/**
 * Foundation Stack - 基盤インフラスト

ラクチャ
 * 
 * 含まれるリソース:
 * - VPC、サブネット、VPCエンドポイント
 * - DynamoDB 13テーブル
 * - S3 3バケット
 * - Cognito (UserPool, Client, IdentityPool)
 * - ECS Cluster
 * - Service Discovery
 */
export class FoundationStack extends cdk.Stack {
  // 公開プロパティ
  public readonly vpc: ec2.IVpc;
  public readonly bucket: s3.IBucket;
  public readonly webAppBucket: s3.IBucket;
  public readonly zeroETLBucket: s3.IBucket;
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly cluster: ecs.ICluster;
  public readonly namespace: servicediscovery.IPrivateDnsNamespace;
  
  // DynamoDB テーブル（具体的なクラス型を使用）
  public readonly placeTable: dynamodb.Table;
  public readonly cameraTable: dynamodb.Table;
  public readonly collectorTable: dynamodb.Table;
  public readonly fileTable: dynamodb.Table;
  public readonly detectorTable: dynamodb.Table;
  public readonly detectLogTable: dynamodb.Table;
  public readonly detectLogTagTable: dynamodb.Table;
  public readonly detectTagTimeseriesTable: dynamodb.Table;
  public readonly bookmarkTable: dynamodb.Table;
  public readonly bookmarkDetailTable: dynamodb.Table;
  public readonly tagCategoryTable: dynamodb.Table;
  public readonly tagTable: dynamodb.Table;
  public readonly trackLogTable: dynamodb.Table;
  public readonly testMovieTable: dynamodb.Table;
  public readonly rtmpNlbTable: dynamodb.Table;
  
  // ECS関連（具体的なクラス型を使用）
  public readonly ecsTaskExecutionRole: iam.Role;
  public readonly ecsTaskRole: iam.Role;
  public readonly collectorSecurityGroup: ec2.SecurityGroup;

  // Lambda Collector関連
  public readonly lambdaCollectorRole: iam.Role;

  // CloudWatch Logs暗号化用KMS Key
  public readonly logsEncryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: FoundationStackProps) {
    super(scope, id, props);

    // ========================================
    // 1. VPC
    // ========================================
    this.vpc = new ec2.Vpc(this, 'CameraVPC', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // VPCエンドポイント
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // ========================================
    // 1-1. KMS Key for CloudWatch Logs
    // ========================================
    this.logsEncryptionKey = new kms.Key(this, 'LogsEncryptionKey', {
      enableKeyRotation: true,
      description: 'KMS Key for CloudWatch Logs encryption',
      alias: `alias/${props?.stackPrefix}/cloudwatch-logs`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // CloudWatch Logsサービスにキーの使用を許可
    this.logsEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogs',
      actions: [
        'kms:Encrypt*',
        'kms:Decrypt*',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:Describe*',
      ],
      principals: [
        new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`),
      ],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
        },
      },
    }));

    // ========================================
    // 2. DynamoDB テーブル
    // ========================================
    this.placeTable = new dynamodb.Table(this, 'PlaceTable', {
      tableName: TABLE_NAMES.PLACE,
      partitionKey: { name: 'place_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.cameraTable = new dynamodb.Table(this, 'CameraTable', {
      tableName: TABLE_NAMES.CAMERA,
      partitionKey: { name: 'camera_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.collectorTable = new dynamodb.Table(this, 'CollectorTable', {
      tableName: TABLE_NAMES.COLLECTOR,
      partitionKey: { name: 'collector_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.collectorTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'camera_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'collector_id', type: dynamodb.AttributeType.STRING },
    });

    this.fileTable = new dynamodb.Table(this, 'FileTable', {
      tableName: TABLE_NAMES.FILE,
      partitionKey: { name: 'file_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.fileTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'collector_id_file_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
    });

    this.fileTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 's3path', type: dynamodb.AttributeType.STRING },
    });

    this.fileTable.addGlobalSecondaryIndex({
      indexName: 'globalindex3',
      partitionKey: { name: 'camera_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.detectorTable = new dynamodb.Table(this, 'DetectorTable', {
      tableName: TABLE_NAMES.DETECTOR,
      partitionKey: { name: 'detector_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.detectorTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'collector_id_file_type', type: dynamodb.AttributeType.STRING },
    });

    this.detectorTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 'camera_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'collector_id', type: dynamodb.AttributeType.STRING },
    });

    this.detectLogTable = new dynamodb.Table(this, 'DetectLogTable', {
      tableName: TABLE_NAMES.DETECT_LOG,
      partitionKey: { name: 'detect_log_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.detectLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'collector_id_file_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
    });

    this.detectLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 'detect_notify_flg', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
    });

    this.detectLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex3',
      partitionKey: { name: 'collector_id_file_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
    });

    this.detectLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex4',
      partitionKey: { name: 'file_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'detector_id', type: dynamodb.AttributeType.STRING },
    });

    // GSI-5: has_detect判定用（collector_id + detector_id で直接クエリ可能）
    this.detectLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex5',
      partitionKey: { name: 'collector_id_detector_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'start_time', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.detectLogTagTable = new dynamodb.Table(this, 'DetectLogTagTable', {
      tableName: TABLE_NAMES.DETECT_LOG_TAG,
      partitionKey: { name: 'data_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'detect_tag_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.detectTagTimeseriesTable = new dynamodb.Table(this, 'DetectTagTimeseriesTable', {
      tableName: TABLE_NAMES.DETECT_TAG_TIMESERIES,
      partitionKey: { name: 'tag_name', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'time_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.detectTagTimeseriesTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'place_tag_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'time_key', type: dynamodb.AttributeType.STRING },
    });

    this.detectTagTimeseriesTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 'camera_tag_key', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'time_key', type: dynamodb.AttributeType.STRING },
    });

    this.bookmarkTable = new dynamodb.Table(this, 'BookmarkTable', {
      tableName: TABLE_NAMES.BOOKMARK,
      partitionKey: { name: 'bookmark_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.bookmarkTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'updatedate', type: dynamodb.AttributeType.STRING },
    });

    this.bookmarkDetailTable = new dynamodb.Table(this, 'BookmarkDetailTable', {
      tableName: TABLE_NAMES.BOOKMARK_DETAIL,
      partitionKey: { name: 'bookmark_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'bookmark_no', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.bookmarkDetailTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'bookmark_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'datetime', type: dynamodb.AttributeType.STRING },
    });

    this.tagCategoryTable = new dynamodb.Table(this, 'TagCategoryTable', {
      tableName: TABLE_NAMES.TAG_CATEGORY,
      partitionKey: { name: 'tagcategory_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.tagTable = new dynamodb.Table(this, 'TagTable', {
      tableName: TABLE_NAMES.TAG,
      partitionKey: { name: 'tag_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.tagTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'tagcategory_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'tag_name', type: dynamodb.AttributeType.STRING },
    });

    this.tagTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 'tag_name', type: dynamodb.AttributeType.STRING },
    });

    this.trackLogTable = new dynamodb.Table(this, 'TrackLogTable', {
      tableName: TABLE_NAMES.TRACK_LOG,
      partitionKey: { name: 'track_log_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.trackLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex1',
      partitionKey: { name: 'collector_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'time', type: dynamodb.AttributeType.STRING },
    });

    this.trackLogTable.addGlobalSecondaryIndex({
      indexName: 'globalindex2',
      partitionKey: { name: 'file_id', type: dynamodb.AttributeType.STRING },
    });

    // TestMovie Table (テスト動画管理用)
    this.testMovieTable = new dynamodb.Table(this, 'TestMovieTable', {
      tableName: TABLE_NAMES.TEST_MOVIE,
      partitionKey: { name: 'test_movie_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // RTMP NLB Table (RTMP用NLB管理用)
    this.rtmpNlbTable = new dynamodb.Table(this, 'RtmpNlbTable', {
      tableName: TABLE_NAMES.RTMP_NLB,
      partitionKey: { name: 'nlb_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.rtmpNlbTable.addGlobalSecondaryIndex({
      indexName: 'status-created_at-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    });

    // ========================================
    // 3. S3 バケット
    // ========================================
    // S3バケット名はグローバルで一意である必要があるため、s3AdditionalPrefixを使用
    const s3BucketPrefix = props?.s3AdditionalPrefix 
      ? `${props.stackPrefix}-${props.s3AdditionalPrefix}`
      : props?.stackPrefix;
    
    this.bucket = new s3.Bucket(this, 'CameraBucket', {
      bucketName: `${s3BucketPrefix}-bucket`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
          allowedOrigins: ['*'],
          exposedHeaders: [
            'ETag',
            'x-amz-server-side-encryption',
            'x-amz-request-id',
            'x-amz-id-2',
            'Content-Length',
            'Content-Type',
            'Connection',
            'Date',
          ],
          maxAge: 3600,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.webAppBucket = new s3.Bucket(this, 'WebAppBucket', {
      bucketName: `${s3BucketPrefix}-webapp`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.zeroETLBucket = new s3.Bucket(this, 'ZeroETLBucket', {
      bucketName: `${s3BucketPrefix}-zerotl`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteOldExports',
          enabled: true,
          expiration: cdk.Duration.days(7),
        },
        {
          id: 'DeleteOldNlbAccessLogs',
          enabled: true,
          prefix: 'nlb-access-logs/',
          expiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // NLBアクセスログ用のバケットポリシーを追加
    this.zeroETLBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AWSLogDeliveryWrite',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [`${this.zeroETLBucket.bucketArn}/nlb-access-logs/*`],
        conditions: {
          StringEquals: {
            's3:x-amz-acl': 'bucket-owner-full-control',
          },
        },
      })
    );
    this.zeroETLBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AWSLogDeliveryAclCheck',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:GetBucketAcl'],
        resources: [this.zeroETLBucket.bucketArn],
      })
    );

    // ========================================
    // 4. Cognito
    // ========================================
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props?.stackPrefix}-user-pool`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('UserPoolClient', {
      userPoolClientName: `${props?.stackPrefix}-app-client`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        adminUserPassword: true,
        custom: false,
      },
      preventUserExistenceErrors: true,
    });

    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `${props?.stackPrefix}-identity-pool`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // IAM Role for authenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess')],
    });

    // Identity Pool Role Attachment
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // ========================================
    // 5. ECS クラスター
    // ========================================
    this.namespace = new servicediscovery.PrivateDnsNamespace(this, 'ServiceDiscoveryNamespace', {
      name: `${props?.stackPrefix}.internal`,  // stackPrefixを使用してアカウント間で一意に
      vpc: this.vpc,
      description: 'Service discovery namespace for CEDIX ECS services',
    });

    this.cluster = new ecs.Cluster(this, 'CameraCluster', {
      clusterName: `${props?.stackPrefix}-cluster`,  // stackPrefixを使用してアカウント+リージョン内で一意に
      vpc: this.vpc,
    });

    // Service Connect設定（template.yamlのServiceConnectDefaultsに相当）
    const cfnCluster = this.cluster.node.defaultChild as ecs.CfnCluster;
    cfnCluster.serviceConnectDefaults = {
      namespace: this.namespace.namespaceArn,
    };

    this.ecsTaskExecutionRole = new iam.Role(this, 'EcsTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    this.ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonKinesisVideoStreamsFullAccess'),
      ],
    });

    // ECS Exec用ポリシー（デバッグ用）
    this.ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      })
    );

    // EventBridge発行権限
    this.ecsTaskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      })
    );

    // ========================================
    // Lambda Collector共通Role
    // ========================================
    this.lambdaCollectorRole = new iam.Role(this, 'LambdaCollectorRole', {
      roleName: `${props?.stackPrefix}-LambdaCollectorRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Common execution role for Lambda Collectors (S3Rec, GetClip)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonKinesisVideoStreamsReadOnlyAccess'),
      ],
    });

    // EventBridge発行権限（S3Rec用）
    this.lambdaCollectorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      })
    );

    this.collectorSecurityGroup = new ec2.SecurityGroup(this, 'CollectorSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Collector ECS tasks',
      allowAllOutbound: true,
    });

    this.collectorSecurityGroup.addIngressRule(
      this.collectorSecurityGroup,
      ec2.Port.allTraffic(),
      'Allow all traffic from same security group (for Service Connect)'
    );

    // ========================================
    // 5-1. Custom Resource - S3バケットポリシー復元（Frontend Stack再デプロイ時のデグレ防止）
    // ========================================
    // RestoreBucketPolicyFunction用LogGroup（KMS暗号化）
    const restoreBucketPolicyFunctionLogGroup = new logs.LogGroup(this, 'RestoreBucketPolicyFunctionLogGroup', {
      logGroupName: `/aws/lambda/${props?.stackPrefix}-RestoreBucketPolicyFunction`,
      encryptionKey: this.logsEncryptionKey,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SSM ParameterからCloudFront Distribution ARNを取得してS3バケットポリシーを復元
    const restoreBucketPolicyFunction = new lambda.Function(this, 'RestoreBucketPolicyFunction', {
      functionName: `${props?.stackPrefix}-RestoreBucketPolicyFunction`,
      logGroup: restoreBucketPolicyFunctionLogGroup,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import boto3
import json
from botocore.exceptions import ClientError

ssm = boto3.client('ssm')
s3 = boto3.client('s3')

def on_event(event, context):
    request_type = event['RequestType']
    
    if request_type in ['Create', 'Update']:
        webapp_bucket = event['ResourceProperties']['WebAppBucket']
        camera_bucket = event['ResourceProperties']['CameraBucket']
        param_name = event['ResourceProperties']['DistributionArnParameterName']
        
        try:
            # (1) SSM Parameterの存在チェック
            response = ssm.get_parameter(Name=param_name)
            distribution_arn = response['Parameter']['Value']
            print(f"✓ Parameter found: {param_name} = {distribution_arn}")
            
            # (2) S3バケットポリシーを復元
            update_bucket_policy(webapp_bucket, distribution_arn)
            update_bucket_policy(camera_bucket, distribution_arn)
            
            return {
                'PhysicalResourceId': f'bucket-policy-restore-{distribution_arn}',
                'Data': {
                    'Message': 'Bucket policies restored successfully'
                }
            }
        except ssm.exceptions.ParameterNotFound:
            # (3) Frontend Stack未デプロイの場合はスキップ
            print(f"⚠ Parameter not found: {param_name}. Skipping bucket policy update (Frontend Stack not deployed yet).")
            return {
                'PhysicalResourceId': 'bucket-policy-restore-pending',
                'Data': {
                    'Message': 'Frontend Stack not deployed yet. Bucket policies will be set by Frontend Stack.'
                }
            }
    
    return {'PhysicalResourceId': event.get('PhysicalResourceId', 'dummy')}

def update_bucket_policy(bucket_name, distribution_arn):
    try:
        # 既存のポリシーを取得
        response = s3.get_bucket_policy(Bucket=bucket_name)
        policy = json.loads(response['Policy'])
    except ClientError as e:
        if e.response['Error']['Code'] in ['NoSuchBucketPolicy', 'NoSuchKey']:
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
    s3.put_bucket_policy(
        Bucket=bucket_name,
        Policy=json.dumps(policy)
    )
    print(f"✓ Updated bucket policy for {bucket_name}")
`),
      timeout: cdk.Duration.seconds(60),
    });

    // SSM Parameter取得権限を付与
    restoreBucketPolicyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/cedix/frontend/*`],
      })
    );

    // S3バケットポリシーの更新権限を付与
    restoreBucketPolicyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetBucketPolicy',
          's3:PutBucketPolicy',
        ],
        resources: [
          this.webAppBucket.bucketArn,
          this.bucket.bucketArn,
        ],
      })
    );

    // Custom Resourceプロバイダーを作成
    const restoreBucketPolicyProvider = new cr.Provider(this, 'RestoreBucketPolicyProvider', {
      onEventHandler: restoreBucketPolicyFunction,
      // logRetention は指定しない（LogGroupを事前作成済み）
    });

    // Custom Resourceを作成
    const restoreBucketPolicyResource = new cdk.CustomResource(this, 'RestoreBucketPolicyResource', {
      serviceToken: restoreBucketPolicyProvider.serviceToken,
      properties: {
        WebAppBucket: this.webAppBucket.bucketName,
        CameraBucket: this.bucket.bucketName,
        DistributionArnParameterName: '/cedix/frontend/cloudfront-distribution-arn',
      },
    });

    // S3バケット作成後に実行
    restoreBucketPolicyResource.node.addDependency(this.webAppBucket);
    restoreBucketPolicyResource.node.addDependency(this.bucket);

    // ========================================
    // 6. Outputs
    // ========================================
    
    // VPC・ネットワーク関連
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${props?.stackPrefix}-VpcId`,
    });

    new cdk.CfnOutput(this, 'PublicSubnet1Id', {
      value: this.vpc.publicSubnets[0].subnetId,
      description: 'Public Subnet 1 ID',
      exportName: `${props?.stackPrefix}-PublicSubnet1Id`,
    });

    new cdk.CfnOutput(this, 'PublicSubnet2Id', {
      value: this.vpc.publicSubnets[1].subnetId,
      description: 'Public Subnet 2 ID',
      exportName: `${props?.stackPrefix}-PublicSubnet2Id`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnet1Id', {
      value: this.vpc.privateSubnets[0].subnetId,
      description: 'Private Subnet 1 ID',
      exportName: `${props?.stackPrefix}-PrivateSubnet1Id`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnet2Id', {
      value: this.vpc.privateSubnets[1].subnetId,
      description: 'Private Subnet 2 ID',
      exportName: `${props?.stackPrefix}-PrivateSubnet2Id`,
    });

    new cdk.CfnOutput(this, 'CollectorSecurityGroupId', {
      value: this.collectorSecurityGroup.securityGroupId,
      description: 'Collector Security Group ID',
      exportName: `${props?.stackPrefix}-CollectorSecurityGroupId`,
    });

    // DynamoDB テーブル名
    new cdk.CfnOutput(this, 'PlaceTableName', {
      value: this.placeTable.tableName,
      description: 'Place table name',
      exportName: `${props?.stackPrefix}-PlaceTableName`,
    });

    new cdk.CfnOutput(this, 'CameraTableName', {
      value: this.cameraTable.tableName,
      description: 'Camera table name',
      exportName: `${props?.stackPrefix}-CameraTableName`,
    });

    new cdk.CfnOutput(this, 'CollectorTableName', {
      value: this.collectorTable.tableName,
      description: 'Collector table name',
      exportName: `${props?.stackPrefix}-CollectorTableName`,
    });

    new cdk.CfnOutput(this, 'FileTableName', {
      value: this.fileTable.tableName,
      description: 'File table name',
      exportName: `${props?.stackPrefix}-FileTableName`,
    });

    new cdk.CfnOutput(this, 'DetectorTableName', {
      value: this.detectorTable.tableName,
      description: 'Detector table name',
      exportName: `${props?.stackPrefix}-DetectorTableName`,
    });

    new cdk.CfnOutput(this, 'DetectLogTableName', {
      value: this.detectLogTable.tableName,
      description: 'Detect log table name',
      exportName: `${props?.stackPrefix}-DetectLogTableName`,
    });

    new cdk.CfnOutput(this, 'DetectLogTagTableName', {
      value: this.detectLogTagTable.tableName,
      description: 'Detect log tag table name',
      exportName: `${props?.stackPrefix}-DetectLogTagTableName`,
    });

    new cdk.CfnOutput(this, 'DetectTagTimeseriesTableName', {
      value: this.detectTagTimeseriesTable.tableName,
      description: 'Detect tag timeseries table name',
      exportName: `${props?.stackPrefix}-DetectTagTimeseriesTableName`,
    });

    new cdk.CfnOutput(this, 'BookmarkTableName', {
      value: this.bookmarkTable.tableName,
      description: 'Bookmark table name',
      exportName: `${props?.stackPrefix}-BookmarkTableName`,
    });

    new cdk.CfnOutput(this, 'BookmarkDetailTableName', {
      value: this.bookmarkDetailTable.tableName,
      description: 'Bookmark detail table name',
      exportName: `${props?.stackPrefix}-BookmarkDetailTableName`,
    });

    new cdk.CfnOutput(this, 'TagCategoryTableName', {
      value: this.tagCategoryTable.tableName,
      description: 'Tag category table name',
      exportName: `${props?.stackPrefix}-TagCategoryTableName`,
    });

    new cdk.CfnOutput(this, 'TagTableName', {
      value: this.tagTable.tableName,
      description: 'Tag table name',
      exportName: `${props?.stackPrefix}-TagTableName`,
    });

    new cdk.CfnOutput(this, 'TrackLogTableName', {
      value: this.trackLogTable.tableName,
      description: 'Track log table name',
      exportName: `${props?.stackPrefix}-TrackLogTableName`,
    });

    new cdk.CfnOutput(this, 'RtmpNlbTableName', {
      value: this.rtmpNlbTable.tableName,
      description: 'RTMP NLB table name',
      exportName: `${props?.stackPrefix}-RtmpNlbTableName`,
    });

    // S3 バケット
    new cdk.CfnOutput(this, 'CameraBucketName', {
      value: this.bucket.bucketName,
      description: 'Camera bucket name',
      exportName: `${props?.stackPrefix}-CameraBucketName`,
    });

    new cdk.CfnOutput(this, 'WebAppBucketName', {
      value: this.webAppBucket.bucketName,
      description: 'Web App S3 Bucket Name',
      exportName: `${props?.stackPrefix}-WebAppBucketName`,
    });

    // Cognito
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${props?.stackPrefix}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${props?.stackPrefix}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${props?.stackPrefix}-IdentityPoolId`,
    });

    // Cognito用SSM Parameters（webapp-stack用）
    new ssm.StringParameter(this, 'UserPoolIdParameter', {
      parameterName: '/Cedix/Main/UserPoolId',
      stringValue: this.userPool.userPoolId,
      description: 'Cognito User Pool ID for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'UserPoolClientIdParameter', {
      parameterName: '/Cedix/Main/UserPoolClientId',
      stringValue: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'IdentityPoolIdParameter', {
      parameterName: '/Cedix/Main/IdentityPoolId',
      stringValue: this.identityPool.ref,
      description: 'Cognito Identity Pool ID for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'WebAppBucketNameParameter', {
      parameterName: '/Cedix/Main/WebAppBucketName',
      stringValue: this.webAppBucket.bucketName,
      description: 'Web App S3 Bucket Name for webapp build',
      tier: ssm.ParameterTier.STANDARD,
    });

    // ECS・Service Discovery
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster name',
      exportName: `${props?.stackPrefix}-ClusterName`,
    });

    new cdk.CfnOutput(this, 'EcsTaskRoleArn', {
      value: this.ecsTaskRole.roleArn,
      description: 'ECS Task Role ARN',
      exportName: `${props?.stackPrefix}-EcsTaskRoleArn`,
    });

    new cdk.CfnOutput(this, 'EcsTaskExecutionRoleArn', {
      value: this.ecsTaskExecutionRole.roleArn,
      description: 'ECS Task Execution Role ARN',
      exportName: `${props?.stackPrefix}-EcsTaskExecutionRoleArn`,
    });

    new cdk.CfnOutput(this, 'LambdaCollectorRoleArn', {
      value: this.lambdaCollectorRole.roleArn,
      description: 'Lambda Collector Role ARN',
      exportName: `${props?.stackPrefix}-LambdaCollectorRoleArn`,
    });

    // SSM Parameters
    new ssm.StringParameter(this, 'StackNameParameter', {
      parameterName: '/Cedix/Main/StackName',
      stringValue: props?.stackPrefix || this.stackName,
      description: 'Stack prefix for Cedix deployment',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'EcsTaskRoleArnParameter', {
      parameterName: '/Cedix/Main/EcsTaskRoleArn',
      stringValue: this.ecsTaskRole.roleArn,
      description: 'ECS Task Role ARN for Cedix collectors',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'EcsTaskExecutionRoleArnParameter', {
      parameterName: '/Cedix/Main/EcsTaskExecutionRoleArn',
      stringValue: this.ecsTaskExecutionRole.roleArn,
      description: 'ECS Task Execution Role ARN for Cedix collectors',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'LambdaCollectorRoleArnParameter', {
      parameterName: '/Cedix/Main/LambdaCollectorRoleArn',
      stringValue: this.lambdaCollectorRole.roleArn,
      description: 'Lambda Collector Role ARN for S3Rec and GetClip',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'CollectorSecurityGroupIdParameter', {
      parameterName: '/Cedix/Main/CollectorSecurityGroupId',
      stringValue: this.collectorSecurityGroup.securityGroupId,
      description: 'Security Group ID for Collectors',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'CameraClusterNameParameter', {
      parameterName: '/Cedix/Main/CameraClusterName',
      stringValue: this.cluster.clusterName,
      description: 'ECS Cluster Name for Cameras',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'CameraBucketNameParameter', {
      parameterName: '/Cedix/Main/CameraBucketName',
      stringValue: this.bucket.bucketName,
      description: 'S3 Bucket Name for Camera data',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'ZeroETLBucketNameParameter', {
      parameterName: '/Cedix/Main/ZeroETLBucketName',
      stringValue: this.zeroETLBucket.bucketName,
      description: 'S3 Bucket Name for ZeroETL and NLB access logs',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'PrivateSubnet1IdParameter', {
      parameterName: '/Cedix/Main/PrivateSubnet1Id',
      stringValue: this.vpc.privateSubnets[0].subnetId,
      description: 'Private Subnet 1 ID',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'PrivateSubnet2IdParameter', {
      parameterName: '/Cedix/Main/PrivateSubnet2Id',
      stringValue: this.vpc.privateSubnets[1].subnetId,
      description: 'Private Subnet 2 ID',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'PublicSubnet1IdParameter', {
      parameterName: '/Cedix/Main/PublicSubnet1Id',
      stringValue: this.vpc.publicSubnets[0].subnetId,
      description: 'Public Subnet 1 ID',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'PublicSubnet2IdParameter', {
      parameterName: '/Cedix/Main/PublicSubnet2Id',
      stringValue: this.vpc.publicSubnets[1].subnetId,
      description: 'Public Subnet 2 ID',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'VpcIdParameter', {
      parameterName: '/Cedix/Main/VpcId',
      stringValue: this.vpc.vpcId,
      description: 'VPC ID',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'RtmpNlbTableNameParameter', {
      parameterName: '/Cedix/Main/RtmpNlbTableName',
      stringValue: this.rtmpNlbTable.tableName,
      description: 'RTMP NLB DynamoDB Table Name',
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, 'LogsKmsKeyArnParameter', {
      parameterName: '/Cedix/Main/LogsKmsKeyArn',
      stringValue: this.logsEncryptionKey.keyArn,
      description: 'KMS Key ARN for CloudWatch Logs encryption',
      tier: ssm.ParameterTier.STANDARD,
    });

    new cdk.CfnOutput(this, 'LogsKmsKeyArn', {
      value: this.logsEncryptionKey.keyArn,
      description: 'KMS Key ARN for CloudWatch Logs encryption',
      exportName: `${props?.stackPrefix}-LogsKmsKeyArn`,
    });

    new cdk.CfnOutput(this, 'ServiceDiscoveryNamespaceId', {
      value: this.namespace.namespaceId,
      description: 'Service Discovery Namespace ID',
      exportName: `${props?.stackPrefix}-ServiceDiscoveryNamespaceId`,
    });

    new cdk.CfnOutput(this, 'ServiceDiscoveryNamespaceArn', {
      value: this.namespace.namespaceArn,
      description: 'Service Discovery Namespace ARN',
      exportName: `${props?.stackPrefix}-ServiceDiscoveryNamespaceArn`,
    });
  }
}

