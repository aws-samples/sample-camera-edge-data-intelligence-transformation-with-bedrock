# Quick Start RTSP Camera (via Local Network)

This document covers the setup procedure when **AWS cannot directly connect to the RTSP camera**.

In environments where router port forwarding is not possible, you can set up an RTSP Receiver within the local network and send video to AWS via Kinesis Video Streams (KVS).

Basic operations (Collector, Detector, analytics features, etc.) are the same as the RTSP Camera Quick Start, so please refer to that as well.

[Quick Start RTSP Camera](QUICK_START_RTSP.md)

---

## Architecture Overview

```
[RTSP Camera] --RTSP--> [RTSP Receiver (Local PC)] --KVS--> [KVS on AWS]
                        (Docker Container)
```
- **RTSP Receiver**: Runs as a Docker container within the local network
- **Kinesis Video Streams**: Securely transfers video to AWS
---

## Prerequisites

### Local PC Requirements

| Item | Requirement |
| --- | --- |
| OS | Linux recommended (Ubuntu 20.04 or later), macOS, Windows (WSL2) |
| Docker | Docker Engine 20.10 or later |
| AWS CLI | v2 or later (used for credential configuration) |
| Network | Same network as RTSP camera, internet connection required |
| Memory | 4GB or more recommended |

### About OS
Any OS that can run Docker will work, but on Windows, start.sh cannot be used, so you'll need to create a script with similar functionality separately. If you must use Windows, using WSL2 is the smoothest option.

### AWS Credentials
The local PC needs AWS credentials configured using one of the following methods:
1. **IAM User long-term credentials** (for development/testing)
2. **IAM Roles Anywhere** (recommended for production)
3. **AWS IoT authentication mechanism** (for IoT devices)

> ⚠️ **Security Note**: Long-term credentials have leakage risks, so IAM Roles Anywhere or AWS IoT authentication is recommended for production environments.

---

## Setup Procedure
### Create Camera (KVS Endpoint)
Click CONNECT CAMERA on the camera screen.
![Camera Connection](../image/1770694215288.png)
Enter the name and place, select Kinesis for Type, and press the SAVE button. A message will appear indicating the camera is being created, so wait until it completes. This takes some time due to CloudFormation deployment.
*Since RTSP Receiver is set up locally, what's needed on the AWS side is the Kinesis Video Streams endpoint. Therefore, only Kinesis is created.![image/1770823956482.png](../image/1770823956482.png)
Once creation is complete, a **Kinesis Stream ARN** will be generated. Make sure to **copy** this value. However, you only need the "**Stream Name**" portion of the ARN.
arn:aws:kinesisvideo:<region>:<account>:stream/<cameraid>-stream/<stream_name>
Only the <stream_name> portion is sufficient.
![image/1770824243126.png](../image/1770824243126.png)
> 📝 **Important**: The Stream Name will be used in the RTSP Receiver configuration in later steps.

---

### Set Up RTSP Receiver
Execute the following steps on the local PC.

#### Clone Repository (if not done yet)
```bash
git clone https://github.com/your-org/sample-camera-edge-data-intelligence-transformation-with-bedrock.git
cd sample-camera-edge-data-intelligence-transformation-with-bedrock
```

#### Navigate to RTSP Receiver Directory
```bash
cd backend/camera_management/docker/rtsp_reciver
```

#### Create Environment Variable File (.env)
Create a `.env` file and configure AWS credentials.
Note that **this configuration uses long-term credentials and should be understood as a test-only setup.**
```bash
# Create .env file
cat << 'EOF' > .env
AWS_ACCESS_KEY_ID=<your-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
EOF
```
> ⚠️ **Security Note**: The `.env` file is included in `.gitignore`, but please handle credentials with care.

#### Edit start.sh
Open `start.sh` and configure the following environment variables.
```bash
# ========================================
# 0. Environment Variable Configuration
# ========================================
export STREAM_NAME="<copied Stream Name>"
export RTSP_URL="rtsp://<RTSP camera IP address>:<port>/<path>"
export GSTREAMER_LOG_MODE="stdout"  # stdout for debugging, null for production
```

**Configuration Examples:**
| Variable | Description | Example |
| --- | --- | --- |
| `STREAM_NAME` | KVS stream name created in CEDIX | `1770523904461` |
| `RTSP_URL` | RTSP camera URL | `rtsp://192.168.1.100:554/stream1` |
| `GSTREAMER_LOG_MODE` | Log output mode | `stdout` or `null` |

**RTSP Camera URL Format Examples:**
```bash
# General RTSP camera
export RTSP_URL="rtsp://192.168.1.100:554/stream1"

# When authentication is required
export RTSP_URL="rtsp://username:password@192.168.1.100:554/stream1"

# For RTSPS (TLS encrypted)
export RTSP_URL="rtsps://192.168.1.100:8322/stream"
```

---

### Start RTSP Receiver

#### First Startup (build required)
```bash
./start.sh --build
```
> ⏱️ **Note**: The first build includes KVS Producer SDK compilation and takes **15-30 minutes**. Subsequent runs use cache and are faster.

#### Subsequent Startups
```bash
./start.sh
```

#### Startup Confirmation
When started successfully, logs like the following will appear:
```
==========================================
RTSP Receiver Startup Script (Development Environment)
==========================================
✅ Builder image already exists: cedix-rtsp-receiver-builder:v1.0.0
   Using cache for fast build

Environment Variable Settings:
  - STREAM_NAME: place-00001-entrance-stream
  - RTSP_URL: rtsp://192.168.1.100:554/stream1
  - BUILDER_TAG: cedix-rtsp-receiver-builder:v1.0.0
  - GSTREAMER_LOG_MODE: stdout

AWS Settings:
  - AWS_REGION: ap-northeast-1
  - STACK_PREFIX: cedix

==========================================
Starting with Docker Compose...
==========================================
Starting GStreamer pipeline...
Checking connection to RTSP source...
RTSP source connection confirmed
Starting GStreamer pipeline...
Pipeline started successfully. PID: 12345
🚀 Pipeline started: 2025-02-11 10:30:00
```

---

### Verify Video on Web
Click the camera you created on the camera screen.
If video is displayed in the LIVE tab, the connection is successful.
![image/1770824774635.png](../image/1770824774635.png)
> 📝 **Note**: Initial connection may take 1-2 minutes for video to display. Please check while refreshing the LIVE screen.
