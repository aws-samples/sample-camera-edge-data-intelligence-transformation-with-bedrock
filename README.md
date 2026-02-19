# sample-camera-edge-data-intelligence-transformation-with-bedrock

[English](README.md) | [日本語](README_ja.md)

## Overview

This sample is an implementation example of a platform that captures surveillance camera video in real-time to AWS and analyzes it using generative AI.
It provides a system that integrates and manages camera video from construction sites, factories, logistics centers, stores, etc. in the cloud, and automatically analyzes it using generative AI (Amazon Bedrock) and computer vision (YOLOv9), ready to deploy and try immediately.

This sample is the public version of what was exhibited at the following events by the Construction and Real Estate team:

- AWS Summit Japan 2025
- JAPAN BUILD TOKYO Construction DX Exhibition 2025
- Construction RX Consortium Exhibition 2025

**Related Blogs:**

- [AWS Summit Japan 2025 Construction and Real Estate Booth](https://aws.amazon.com/jp/blogs/news/aws-summit-2025-japan-cre-booth-and-sessions/)
- [JAPAN BUILD TOKYO Construction DX Exhibition 2025](https://aws.amazon.com/jp/blogs/news/japan-build-tokyo-cre-booth-and-sessions/)

---

## Use Case

By extending this sample, you can address the following use cases:

- **Construction site safety monitoring**: Automatic detection of missing helmets, entry into restricted areas
- **Factory quality control**: Manufacturing line anomaly detection, work procedure verification
- **Logistics center monitoring**: Package movement tracking, work efficiency analysis
- **Store security**: Suspicious person detection, congestion status monitoring

---

## Architecture

![1770573228433.png](doc/image/1770573228433.png)

---

## Key Feature

| Challenge | Solution |
| --- | --- |
| **Multi-source video integration** | Supports video collection from different sources including RTSP cameras, RTMP cameras, VSaaS cloud cameras, KVS, and S3. Provides ETL to centrally aggregate video sources. |
| **AI/ML video analysis** | For aggregated video analysis, real-time analysis with YOLOv9 (MIT license version) and image/video analysis with Amazon Bedrock are available. Analysis results are tagged to images/videos. Custom models can also be integrated. |
| **24/7 automatic video monitoring** | No need for humans to watch all 24 hours of video. Important events detected by AI can be notified. Notification results can be verified with one click. |
| **Scalable video architecture** | Even as the number of connected cameras increases, ECS & serverless architecture can handle it. |

---

## Feature details

![1770573186494.png](doc/image/1770573186494.png)

### Camera Management

![1770450691363.png](doc/image/1770450691363.png)

This sample supports both real-time video collection and batch video collection.
For real-time collection, it retrieves streaming video from surveillance cameras (RTSP/RTMP) and VSaaS cameras, providing HLS endpoints. Basically, video is converted to Kinesis Video Streams (KVS), and its HLS endpoint is used for subsequent processing. If the VSaaS has a default feature to generate HLS endpoints, that endpoint is used directly.
For batch collection, it's a video collection feature that directly uploads videos and images. CEDIX provides an S3 bucket for camera video uploads, and files uploaded there are managed chronologically through collectors.

**[Managed Camera List Screen]**

![1770566886511.png](doc/image/1770566886511.png)

**[Camera Edit Screen]**

![1770568506151.png](doc/image/1770568506151.png)

#### Real-time Collection

**RTSP Camera**

- CEDIX can connect to cameras with RTSP/RTSPS servers to retrieve video.
- CEDIX provides two connection patterns for RTSP cameras.
- The first is a pattern where AWS directly connects to the RTSP camera. In this case, port forwarding is required on the network where the RTSP camera is located. For testing this, we provide a "Test Video" feature.
- The second is a pattern where an RTSP collection client is placed on the same network as the RTSP camera. CEDIX provides the RTSP collection client as a Dockerfile, which can be set up and run on any device to collect video.

**RTMP Camera**

- CEDIX can expose an RTMP endpoint and receive video from cameras with RTMP client functionality. For testing purposes, you can also test by streaming from a smartphone RTMP client app.
- Note: Only RTMP is supported (RTMPS not supported).
- To support RTMPS, the simplest configuration is to terminate TLS at the Network Load Balancer (NLB) (using public certificates issued by AWS Certificate Manager is recommended) and send plain RTMP to the downstream RTMP server.
- If you want to maintain TLS between NLB → ECS, you'll need to place certificates on the ECS side.

**Cloud Camera (VSaaS Support)**

- VSaaS support is available for specific VSaaS providers, but is currently disabled. For AWS corporate customers, please consult your Solution Architect.

**About Other Video Sources**

- You can also set up Kinesis Video Streams as an endpoint.
- Therefore, if a camera-equipped system can send video to KVS, it can integrate video with CEDIX.

#### Batch Collection

**S3**

- When you create an S3 type camera in CEDIX, it generates an S3 collection endpoint (S3 bucket path).
- If you send images/videos to that S3 path, the backend S3 collector will store and manage them chronologically. At that timing, analysis with YOLOv9 (MIT license version) and Amazon Bedrock can also be performed.

#### Connection Patterns:
| Type | Source | Video Collection Method | Converted Video Endpoint | Quick Start |
| --- | --- | --- | --- | --- |
| RTSP | RTSP Camera | On-site RTSP client (Docker) connects to RTSP camera on same network to retrieve RTSP video and send to KVS | KVS (HLS) | [RTSP (Local)](doc/en/QUICK_START_RTSP_LOCAL.md) |
| RTSP | RTSP Camera | AWS directly connects to on-site RTSP camera to retrieve RTSP video and send to KVS | KVS (HLS) | [RTSP](doc/en/QUICK_START_RTSP.md) |
| RTMP | RTMP Camera | On-site RTMP camera connects to RTMP endpoint exposed by AWS to send video. This is converted to KVS. | KVS (HLS) | [RTMP](doc/en/QUICK_START_RTMP.md) |
| VSaaS | Cloud Camera | Uses VSaaS-provided API (to get HLS endpoint) directly without conversion | VSaaS(HLS) | - |
| KVS Direct | Embedded Camera (example) | Source implementation sends video directly to KVS | KVS (HLS) | - |
| S3 | Embedded Camera (example) | Source implementation sends video (video/image) directly to S3 | S3 Bucket (File) | [S3](doc/en/QUICK_START_S3.md) |

#### RTMP Camera Requirements

- Codec is H.264 only. Resolution limit, frame rate, and bitrate limit depend on Kinesis Video Streams. Theoretical values are 4K resolution, max 60fps frame rate, max 100Mbps bitrate (as of 2026-2-10), but practically depends on the ECS service specs processing the video in Camera Management. Audio is currently discarded.
- When using the recorder feature with Collector, due to memory issues with the ECS service running the recorder, currently only up to 720p resolution is supported. For higher resolution image/video extraction, increase the memory.
- Initial connection may take 1-3 minutes after starting streaming.

#### RTSP Camera Requirements

- Codec is H.264 only. Resolution limit, frame rate, and bitrate limit depend on Kinesis Video Streams. Theoretical values are 4K resolution, max 60fps frame rate, max 100Mbps bitrate (as of 2026-2-10), but practically depends on the ECS service specs processing the video in Camera Management. Audio is currently discarded.
- When using the recorder feature with Collector, due to memory issues with the ECS service running the recorder, currently only up to 720p resolution is supported. For higher resolution image/video extraction, increase the memory.

#### About RTSP Camera Connection

**When you can open a port on the router for direct AWS connection:**

- When AWS directly connects to an RTSP camera, port forwarding on the router where the RTSP camera is installed is generally required.
- To test this feature, use the "Test Video" feature. Test Video builds an RTSP server within an ECS service that plays the specified video, enabling RTSP camera testing using it as a source.

**When you cannot open a port on the router for direct AWS connection:**

- Install the program set from `backend/camera_management/docker/rtsp_reciver` on any PC and run Docker within the RTSP camera's network.
- It will pull video from the RTSP camera on the local network and send it to Kinesis Video Streams, eliminating the need for router port forwarding.
- Linux is recommended for the PC, and aws-cli and Docker are required. AWS credentials that can connect to AWS are also required. Long-term credentials are generally not recommended, so consider using IAM Roles Anywhere or AWS IoT authentication mechanisms.

#### About Live View

- For HLS-based video sources, you can view live video on the camera screen.

---

### Collector

![1770450735956.png](doc/image/1770450735956.png)

Collectors are modules that connect directly to video sources and perform real-time/near-real-time processing.
The most basic is the recorder feature, which extracts images and videos from video sources.
There's also a feature to analyze video sources in real-time with YOLOv9 (MIT license version) models. Specifically, it provides real-time object detection and entry/exit detection for specified areas.
Each collector feature publishes Events to EventBridge when it performs its assigned processing. Subsequent Detectors are expected to process based on these events.

#### Recorder Feature

- A feature that extracts and saves videos and images from video sources.
- For HLS-based video sources, it starts an ECS service, receives HLS in real-time, extracts and saves videos and images, and adds chronological information.
- For S3-based video sources, it starts Lambda when saving to S3, copies saved videos and images to the management area, and adds chronological information.
- When saving images or videos, it publishes `save_image` or `save_video` events to EventBridge. Subsequent Detectors can start processing based on these events.

**[Screen to View Images Recorded by Recorder]**

![1770566332154.png](doc/image/1770566332154.png)

#### Real-time YOLO Detection Feature

- Object tracking with YOLOv9 MIT & ByteTrack algorithm
  - `class_detect`: Detection of specific class objects
  - `area_detect`: Entry/exit detection for specified polygon areas
- For HLS-based video sources, it starts an ECS service, receives HLS, and performs real-time class detection & entry/exit detection
- For S3-based video sources, it performs class detection triggered by image/video save events. Entry/exit detection is not available for S3-based sources.
- For usage, you can use it as-is, use it as a reference when integrating your own models into CEDIX, or use it as a filter feature to reduce Amazon Bedrock detection counts for cost optimization. Since analyzing every image/video with generative AI is costly, pre-filtering with YOLO enables efficiency.
- When `class_detect` or `area_detect` occurs, it publishes events to EventBridge. Subsequent Detectors start processing based on these events.
- When creating a YOLOv9 (MIT license version) collector, a Detector called `collector-internal` is automatically created. This is a Detector that saves YOLO detection results, so please don't delete it.

**[Screen to View Images and Detection Results from YOLO]**

![1770566373082.png](doc/image/1770566373082.png)

| Type | Feature | Collector Name | Execution Environment | Description | Events Generated |
| --- | --- | --- | --- | --- | --- |
| HLS | Recorder Feature | **hlsrec** | ECS | Image/video capture from HLS stream | `save_image` `save_video` |
| HLS | Real-time YOLO Detection Feature | **hlsyolo** | ECS | YOLOv9 (MIT license version) real-time object detection + entry/exit detection for specified polygon areas | `class_detect` `area_detect` |
| S3 | Recorder Feature | **s3rec** | EventBridge + Lambda | Media collection from S3 | `save_image` `save_video` |
| S3 | Real-time YOLO Detection Feature | **s3yolo** | EventBridge + Lambda | YOLOv9 (MIT license version) object detection | `class_detect` |

---


### Detector

![1770450942980.png](doc/image/1770450942980.png)

Uses Amazon Bedrock's generative AI models to perform video analysis and tagging. Tags to detect from video can be specified in natural language. Since analysis content can be specified in natural language for each camera, camera configuration is possible without AI expertise.

#### Tag Creation & Management Feature

- Tags to be detected by Bedrock need to be registered in advance using the tag management feature. Open the tag management screen and register in order of tag group, then tag.
- While you can register tags from scratch for each camera, in many cases the same tags need to be set for multiple cameras. Therefore, using tag management effectively is recommended.
- The Detector registration screen allows batch loading of tag groups or individual loading of individual tags, enabling flexible configuration.

**[Tag Management Screen]**

![1770568260485.png](doc/image/1770568260485.png)

#### Detector Feature

- Analyzes images or videos using foundation models provided by Amazon Bedrock, triggered by any of `save_image`, `save_video`, `class_detect`, or `area_detect` events.
- Configuration involves specifying the "foundation model", then using natural language to specify the "role", "what to detect", and tag settings for "what state of detected items should output what tags". Tag settings can be easily loaded from the tag management feature mentioned above.
- Any model available through Amazon Bedrock can be used as the foundation model, but for image analysis, models supporting img2txt are required, and for video analysis, models supporting video2txt are required.

**Examples of Models Suitable for Image Analysis (as of 2026-2-7)**

- Claude Haiku 4.5, Claude Sonnet 4.5, Amazon Nova2 Lite, Amazon Nova2 Pro, etc.

**Examples of Models Suitable for Video Analysis**

- Amazon Nova2 Lite, Amazon Nova2 Pro, etc.
- Amazon Nova series models are recommended for video. Nova series supports video file transfer via Amazon S3 URI, enabling 1GB file analysis, while other models have limits like 25MB (information as of 2026-2-7, may have changed. Please verify with AWS Documentation)
- Details: https://docs.aws.amazon.com/nova/latest/nova2-userguide/using-multimodal-models.html#video-understanding

> ⚠️ **Configuration Note**: If file type and trigger event are configured incorrectly, nothing will be detected.

**[Screen to View Detector Detection Results]**

![1770569003328.png](doc/image/1770569003328.png)

**[Detector Configuration Screen]**

![1770568419425.png](doc/image/1770568419425.png)

---

### Notify
- When registering tags in Detector, turning "Notification" ON will notify when that tag is detected. Currently, notification display is only within the CEDIX UI.
- If notification to email, Slack, Teams, etc. is needed, there's currently a section (backend/analytics/docker/ingestion) that retrieves changes to the cedix-detect-log table via DynamoDB Stream and processes with Lambda. It's recommended to add branching logic there to push record contents to Amazon SNS when detect_notify_flg is true.
- From Amazon SNS, you can send to email, and through Amazon Q Developer in chat applications, you can send notification messages to Teams/Slack.

[Notify History Screen]
![1770571618462.png](doc/image/1770571618462.png)

---

### Analytics

Detection results are stored in the cedix-detect-log table and simultaneously linked to Amazon OpenSearch Service via DynamoDB Streams + Lambda. Analysis is performed using data stored in OpenSearch, with some exceptions.
OpenSearch is set up for full-text search, but vectorization is also possible by modifying the storage logic. Amazon OpenSearch Service can execute full-text search and vector search simultaneously.

#### Detection Result Search Feature (Full-text Search)

- Fast search of detection results using Amazon OpenSearch Service is possible.
- In addition to full-text search with keywords of interest, filtering by place, camera, tag, etc. is possible.
- You can also jump from hit detection results to actual images/videos for verification.

**[Search Screen]**

![1770571657844.png](doc/image/1770571657844.png)

#### Time-series Insight Analysis Feature (Insight Analytics)

- After filtering by place and camera, visualizes the occurrence frequency of each tag mapped chronologically
- This allows you to see how many of which tags occurred at what time
- You can also jump from hit detection results to actual images/videos for verification

**[Insight Analysis Screen]**

![1770571689881.png](doc/image/1770571689881.png)

![1770571719492.png](doc/image/1770571719492.png)

#### Bookmark and Report Feature (Bookmark & Reporting)

- In CEDIX, you can bookmark images and videos extracted by Collector from the screen.
- Results can be viewed from the Bookmark screen and checked in a list.
- Furthermore, pressing the Create Report button loads the `detect-log` of selected images/videos and creates reports according to the specified prompt
- However, this feature is a simple sample implementation. Ideally, it would be more accurate to read specified images/videos as binary and analyze based on specifications, but currently it performs simple analysis based on Detector detection results.

**[Bookmark Screen]**

![1770571778406.png](doc/image/1770571778406.png)

![1770571847683.png](doc/image/1770571847683.png)

---

## Repo Structure
```
CEDIX/
├── backend/                      # Backend services
│   ├── api_gateway/             # Integrated API gateway (FastAPI + Mangum)
│   ├── camera_management/       # Camera management service
│   │   ├── deployment/         # RTMP/RTSP/VSaaS deployment settings
│   │   └── docker/             # RTMP/RTSP/VSaaS receiver containers
│   ├── collector/               # Data collection service
│   │   ├── deployment/         # hlsrec/hlsyolo/s3rec/s3yolo
│   │   └── docker/             # Various collection containers
│   ├── detector/                # AI detection service (Bedrock analysis)
│   ├── analytics/               # Analysis & search service (OpenSearch integration)
│   ├── place/                   # Place management service
│   ├── test_movie/              # Test video streaming service
│   └── shared/                  # Common modules (auth, DB, timezone, etc.)
│
├── frontend/                    # Frontend
│   └── web_app/                # React SPA (Vite)
│       └── src/
│           ├── components/     # Reusable components
│           ├── pages/          # Page components
│           ├── services/       # API communication logic
│           ├── utils/          # Utility functions
│           └── i18n/           # Internationalization settings (Japanese/English)
│
├── infrastructure/              # Infrastructure
│   ├── cdk/                    # AWS CDK definitions
│   ├── edge/                   # Edge device related
│   ├── migrations/             # DB migrations
│   └── testdata/               # Test data
│
├── _doc/                        # Documentation
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Quick Setup

### Prerequisites

**Build Environment (Verified)**:

- OS
  - macOS Monterey or later
  - Ubuntu 24.04 LTS (on EC2)
    - [Ubuntu Setup Guide](doc/en/README_Ubuntu_INSTALL.md)
- Memory
  - 16GB or more recommended

**Required Software**:

- AWS CLI (with credentials configured)
- Node.js v20 or later
- AWS CDK (`npm install -g aws-cdk`)
- Docker

### Deployment Steps

#### Prerequisites

Assumes you have cloned this repository and are in the root directory.

#### Step 1: YOLOv9 Configuration File Setup

Download YOLOv9 MIT configuration files.

```bash
cd backend/shared/yolo_detector
./setup_yolo.sh
cd ../../../
```

#### Step 2: CDK Configuration File Setup

```bash
cd infrastructure/cdk
cp cdk.config.json.template cdk.config.json
```

Edit `cdk.config.json`:

```json
{
  "stackPrefix": "cedix-prod",
  "region": "ap-northeast-1",
  "s3AdditionalPrefix": "<unique-prefix>"
}
```

| Key | Required | Description | Example |
| --- | --- | --- | --- |
| `stackPrefix` | ✅ | Prefix for CloudFormation stack names. Used for all AWS resource names. Set different values for each environment. | `cedix-dev`, `cedix-prod` |
| `region` | ✅ | AWS region for deployment. Specify a region where Bedrock is available. | `ap-northeast-1`, `us-east-1` |
| `s3AdditionalPrefix` | ✅ | Prefix to ensure S3 bucket name global uniqueness. Set a value that won't conflict with others, such as organization name or date. Alphanumeric only. | `mycompany-2025`, `project-abc` |

#### Step 3: CDK Bootstrap

```bash
cdk bootstrap

## If you get ts-node not found or similar, run the following first
npm install
```

#### Step 4: Create CloudFront Signing Keys

```bash
sudo rm -rf keys/
./setup-cloudfront-keys.sh
```

#### Step 5: Deploy Resources

**Batch Deploy Main Resources:**

```bash
# Basic
./run-cdk.sh deploy --all

# To run without any confirmation
./run-cdk.sh deploy --all --require-approval never
```

> 📝 **Note**: If batch deployment fails, individual deployment is recommended. See [CDK_ARCHITECTURE](doc/en/CDK_ARCHITECTURE.md) for details.

**Deploy Web Application:**

```bash
# Basic
./run-cdk-webapp.sh deploy --all

# To run without any confirmation
./run-cdk-webapp.sh deploy --all --require-approval never
```

> 📝 **Hint**: The above execution will issue a CEDIX CloudFront URL.

#### Step 6: Insert Test Data (optional)

Create test data for tag management. This is not required.

```bash
cd infrastructure/testdata
./start.sh --lang en

# For Ubuntu/EC2 environment (using IAM role)
./start.sh --ubuntu --lang en
```

#### Step 7: Login Configuration

CEDIX authenticates with Cognito, so user creation is required.

1. Log in to AWS Console → Search for Cognito → Select User Pool (`<stackPrefix>-user-pool`)
2. Select User Management > Users from the sidebar
3. Click Create User to create a user
4. Access the CloudFront URL
5. Log in with the created user

---

## Cleanup

You can clean up deployed resources with the following command.

```bash
cd infrastructure/cdk
./cleanup_resources.sh
```

> ⚠️ **Warning**: This script deletes all resources. Use with caution in production environments.

---

## Getting Started

Please refer to the following documentation:

- [Quick Start RTSP Camera](doc/en/QUICK_START_RTSP.md)
- [Quick Start RTSP Camera (via Local Network)](doc/en/QUICK_START_RTSP_LOCAL.md)
- [Quick Start RTMP Camera](doc/en/QUICK_START_RTMP.md)
- [Quick Start S3 Camera](doc/en/QUICK_START_S3.md)

---

## Related Documentation

### Technical Documentation

| Document | Description |
| --- | --- |
| [API Endpoints List](doc/en/API_ENDPOINTS.md) | List of all endpoints |
| [CDK Architecture Guide](doc/en/CDK_ARCHITECTURE.md) | Details and dependencies of 16 stacks |
| [Developer Guide](doc/en/README_DEV.md) | Development environment setup and workflow |
| [Database Design Document](doc/en/database-design.md) | Database design document |

---

## CONTRIBUTING

For questions or improvement suggestions for this project, please see [CONTRIBUTING](CONTRIBUTING.md)

---

## LICENSE

Please see [LICENSE](LICENSE)
