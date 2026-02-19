# Quick Start S3 for Camera

This document covers the setup specifically for S3 camera endpoints. For basic explanations, please refer to the RTSP Camera Quick Start documentation. This document only covers the differences for S3.

[Quick Start RTSP Camera](QUICK_START_RTSP.md)

---

## Create S3 Endpoint for Camera

![1770718062061.png](../image/1770718062061.png)

Once complete, an S3 upload endpoint will be created in the S3 path field.

![1770718116808.png](../image/1770718116808.png)

---

## Add Collector (Recorder)

Open the camera in edit mode and click ADD COLLECTOR.

> 📝 **Note**: This is optional and not a required step.

Select the s3Rec collector, set the mode to "Image+Video", and click SAVE.

![1770718211652.png](../image/1770718211652.png)

The collector takes some time due to CloudFormation deployment. To check the status, open the collector in Edit mode.

![1770718298183.png](../image/1770718298183.png)

---

## Add Collector (YOLO Detection)

Select the s3Yolo collector and choose Image for the mode (Video cannot be selected). Then configure the detection settings.

> ⚠️ **Note**: Unlike the HLS case, S3 processes files, so area entry/exit cannot be detected. Only class detection is possible, so specify the classes you want to detect.

Then select the YOLO Model. Currently running in CPU environment, so specify a small model like v9-s.

> 📝 **Hint**: You can train your own models. Place trained models with weights under `shared/yolo_detector/yolo`.

> 📝 **Note**: This is optional and not a required step.

![1770718287689.png](../image/1770718287689.png)

The collector takes some time due to CloudFormation deployment. To check the status, open the collector in Edit mode.

![1770718323828.png](../image/1770718323828.png)

---

## Add Detector

Open the camera in edit mode and click "ADD DETECTOR" on the s3Yolo collector you added earlier.

> 📝 **Note**: This is optional and not a required step.

> 📝 **Hint**: You can also set up a DETECTOR on the s3Rec collector instead of s3Yolo. The difference is that s3Rec runs the DETECTOR on all images/videos, while s3Yolo only runs the DETECTOR when class detection occurs.

![image/1770719361926.png](../image/1770719361926.png)

Select "Image" for File Type and "ClassDetectEvent" for Trigger Event (we selected ClassDetectEvent because we chose class detection in s3Yolo, but for s3Rec, select SaveImageEvent/VideoImageEvent).

Then describe the camera's role and what you want to detect in the prompt.

> 📝 **Important**: To register detection results as tags, you need to register the tags you want to detect in the Tag Management screen beforehand and load them using ADD TAG.

![image/1770725258158.png](../image/1770725258158.png)

![image/1770725410202.png](../image/1770725410202.png)

Once registered, it will appear as a "bedrock" Detector as shown below.

![image/1770725434075.png](../image/1770725434075.png)

---

## Test: Upload Images or Videos to S3 Endpoint

The upload method is up to you. You can use AWS CLI, AWS Console, or any method you prefer.

---

## Verify Collector (Recorder)

Select the camera and choose the IMAGE tab. Then select s3Rec from the Collector dropdown. If captured images are displayed in chronological order as shown below, it's successful.

![image/1770725883339.png](../image/1770725883339.png)

---

## Verify Collector (YOLO Detection)

Select the camera and choose the IMAGE tab. Then select s3Yolo from the Collector dropdown and select "collector-internal" for Detector. Select the "DETECTION" tab in the upper left and press the "DETECTION RESULT" button to open the right side panel. You'll see a screen like below.

Images are generated at the timing of specified class detection, and you can check the detection result details in RESULT.

![1770713609675.png](../image/1770713609675.png)

---

## Verify Detector

Select the camera and choose the IMAGE tab. Then select s3Yolo from the Collector dropdown and select "bedrock" for Detector.

Press the "DETECTION RESULT" button in the upper left to open the right side panel. You'll see a screen like below.

Detection is performed according to the instructions. If there are matching tags, you can also see the detected tags.

> ⏱️ **Note**: s3Yolo Detection takes 2-3 minutes to reflect during Cold Start due to Lambda startup time. Hot Start reflects immediately.

![image/1770726028983.png](../image/1770726028983.png)
