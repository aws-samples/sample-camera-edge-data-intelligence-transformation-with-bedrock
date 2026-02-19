# Developer Guide
This document explains the procedures for developing this sample project in a local environment.
---

## Prerequisites
### Required Conditions

This guide assumes that **AWS deployment has been completed**.

- CEDIX is deployed to AWS environment (completed deployment steps in [README.md](README.md))
- At least the following CloudFormation stacks are running properly:
  - `{stackPrefix}-foundation`
  - `{stackPrefix}-application`
  - `{stackPrefix}-frontend`
  - `{stackPrefix}-keys`

### Required Software

| Software | Version | Purpose |
| --- | --- | --- |
| **Docker** | Latest | Container runtime environment |
| **Docker Compose** | v2.0 or later | Multi-container management |
| **AWS CLI** | v2.0 or later | AWS credentials & resource retrieval |
| **Python** | 3.11 or later | Backend development (optional) |
| **Node.js** | v20 or later | Frontend development |
| **Git** | Latest | Source code management |

### AWS Credentials
Local development uses AWS CLI credentials to access AWS resources. Please verify that authentication is configured.
```bash
# Check if AWS credentials are configured
aws sts get-caller-identity

# If credentials are not configured
aws configure
```
### 

### Database Design Document
- Please refer to [Database Design Document](database-design.md)

---

## Development Environment Verification
### 1. Development Environment
Currently, the development environment has only been tested on Mac.
- OS
  - macOS Monterey or later
- Memory
  - 16GB or more recommended

### 2. CDK Configuration Verification
Local development automatically retrieves configuration from deployed AWS resources. It should be configured during deployment, but `cdk.config.json` is important.
**cdk.config.json example**:
```json
{
  "stackPrefix": "cedix-dev",
  "region": "ap-northeast-1",
  "s3AdditionalPrefix": "your-unique-prefix"
}
```

### 3. About start.sh for Each Docker Startup
Please use the `start.sh` script for each service for local development.
```bash
# Normal startup (uses existing container image)
./start.sh

# Build and start (after code changes)
./start.sh --build

# Build without cache and start (after dependency changes)
./start.sh --build-no-cache
```

Startup Options
| Option | Description | When to Use |
| --- | --- | --- |
| None | Start with existing container image | Normal development |
| `--build` | Build code then start | After code changes |
| `--build-no-cache` | Build without cache then start | After requirements.txt changes, when adding dependencies |

---

## How to Start Each Service
### 1. Camera Management

#### 1.1 RTSP Receiver (RTSP Camera Connection)

**Overview**: Transfers video from RTSP cameras to Kinesis Video Streams

**How to Start**:
```bash
cd backend/camera_management/docker/rtsp_reciver
./start.sh
```

**Features**:
- Receives RTSP stream (RTSP Receiver is a client, so it connects to RTSP server to receive video)
- Transfers to Kinesis Video Streams via GStreamer


#### 1.2 RTMP Server (RTMP Camera Connection)

**Overview**: Receives video from RTMP cameras and transfers to Kinesis Video Streams

**How to Start**:
```bash
cd backend/camera_management/docker/rtmp_server
./start.sh
```

**Features**:
- Receives RTMP stream (RTMP Server is a server, so it receives video from RTSP clients)
- Transfers to Kinesis Video Streams via GStreamer

**Ports**:
- `1935`: RTMP (unencrypted)

---

### 2. Collector (Data Collection Service)

#### 2.1 HlsRec (HLS Image/Video Capture)

**Overview**: Captures images and videos from HLS streams

**How to Start**:
```bash
cd backend/collector/docker/hlsrec
./start.sh
```

**Features**:
- Periodically retrieves images and videos from HLS stream
- Saves to S3 bucket
- Registers metadata to DynamoDB
- Events triggered: (save_image, save_video)
- Notifies Detector via EventBridge
- Runs on ECS service

#### 2.2 HlsYolo (HLS + YOLOv9 Object Detection)

**Overview**: Retrieves video from HLS stream and performs object detection with YOLOv9 and tracking with ByteTrack

**How to Start**:
```bash
cd backend/collector/docker/hlsyolo
./start.sh
```

**Features**:
- Extracts frames from HLS stream
- Object detection with YOLOv9 (MIT version) (80 classes including people, vehicles, etc.)
- Object tracking with ByteTrack algorithm
- Events triggered: (class_detect, area_detect)
- Notifies Detector via EventBridge
- Runs on ECS service


#### 2.3 S3Rec (S3 File Collection)

**Overview**: Collects static image and video files from S3 bucket

**How to Start**:
```bash
cd backend/collector/docker/s3rec
./start.sh
```

**Features**:
- Monitors S3 bucket EventBridge events
- Processes newly uploaded files
- Registers metadata to DynamoDB
- Events triggered: (save_image, save_video)
- Notifies Detector via EventBridge
- Runs on EventBridge + Lambda

#### 2.4 S3Yolo (S3 + YOLOv9 Object Detection)

**Overview**: Performs object detection with YOLOv9 on images uploaded to S3 bucket

**How to Start**:
```bash
cd backend/collector/docker/s3yolo
./start.sh
```

**Features**:
- Monitors S3 bucket EventBridge events
- Object detection with YOLOv9 (MIT version) (80 classes including people, vehicles, etc.)
- Entry/exit detection (area_detect) not supported (static images)
- Event-driven detection (class_detect)
- Notifies Detector via EventBridge
- Runs on EventBridge + Lambda

---

### 3. Detector (AI Detection Service)

#### Bedrock Detector (AWS Bedrock Video Analysis)

**Overview**: Video analysis using AWS Bedrock (generative AI models)

**How to Start**:
```bash
cd backend/detector/docker/bedrock
./start.sh
```

**Features**:
- Receives events from Collector via EventBridge
- Video analysis with AWS Bedrock multimodal models
- Flexible analysis with custom prompts
- Saves detection logs to DynamoDB + OpenSearch (OpenSearch via DynamoDB Stream + Lambda)

---

### 4. API Gateway (Integrated API Server)
**Overview**: Main entry point integrating all backend APIs
**How to Start**:
```bash
cd backend/api_gateway
./start.sh
```

**Access**:
- URL: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs` (Swagger UI)
- Health Check: `http://localhost:8000/health`

**Included APIs**:
- Camera Management API
- Collector API (Data Collection)
- Detector API (AI Detection)
- Analytics API (Analysis & Search)
- Place API (Place Management)
- Test Movie API

**Docker Hot Reload**:
- Code changes under `backend/api_gateway` are automatically reflected
- Common modules like `backend/shared`, `backend/camera_management` are also monitored

---

### 5. Ingestion (OpenSearch Data Ingestion)
**Overview**: Data ingestion from DynamoDB Streams → OpenSearch Serverless
**How to Start**:
```bash
cd backend/analytics/docker/ingestion
./start.sh
```

**Features**:
- Monitors changes to DynamoDB DetectLog table
- Registers indexes to OpenSearch Serverless
- Structures data for search

---

### 6. Frontend (React SPA)
#### Web App (React + Material-UI)

**Overview**: User-facing web application

**How to Start**:

**When referencing local API**:
```bash
cd frontend/web_app
./start.sh
```

**When referencing deployed API**:
```bash
cd frontend/web_app
./start.sh --prod
```

**Access**:
- URL: `http://localhost:3000`

**Development Notes**:
- Using `--prod` option connects to deployed API Gateway
- Without option, connects to local API at `http://localhost:8000`

---

### 7. Sample Data (Sample Data Insertion)

**Overview**: Inserts sample data into DynamoDB

**How to Start**:
```bash
cd infrastructure/testdata
./start.sh
```

**Options**:
- `--lang ja`: Japanese data (default)
- `--lang en`: English data
- `--build`: Build and execute

**Features**:
- Creates Tag sample data
- Sets up datasets for development and testing
