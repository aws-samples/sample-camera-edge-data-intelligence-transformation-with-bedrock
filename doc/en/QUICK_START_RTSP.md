# Quick Start RTSP Camera

This document covers the setup procedure for video capture from RTSP cameras, AI video analysis, and analysis of detection results.

> 📝 **Note**: This setup assumes cases where AWS can directly connect to the RTSP camera over the network.

---

## Create a Place

Click on Places in the header. Press the ADD button.

![1770694015828.png](../image/1770694015828.png)

Enter a name and press SAVE.

![1770694039382.png](../image/1770694039382.png)

---

## Upload Test Video (Start a Simulated RTSP Camera)

Click on Test Videos in the header. Click CREATE NEW.

![1770694056841.png](../image/1770694056841.png)

Enter a name, upload a video, and click CREATE.

![1770694160300.png](../image/1770694160300.png)

> 📝 About uploaded videos
> Videos of 3 minutes or longer are recommended. Videos under 1 minute are not recommended.
> Using a 1-minute video causes the Receiver to reconnect and pull the video source each time, resulting in some disconnection time, which ultimately means only 40-50 seconds of video can be captured by the Connector.
> Note that actual RTSP sources typically don't have disconnections, so this issue doesn't occur.


Once created, copy the RTSP URL.

![1770694176794.png](../image/1770694176794.png)

---

## Connect to Camera

Click CONNECT CAMERA on the camera screen.

![1770694215288.png](../image/1770694215288.png)

Enter the name and place, select RTSP for Camera Endpoint, paste the RTSP URL you copied earlier, and press the SAVE button. A message will appear indicating the camera is being created, so wait until it completes. This takes some time due to CloudFormation deployment.

![1770694440021.png](../image/1770694440021.png)

Once successful, it will appear in the camera list. Click on it.

![1770694745485.png](../image/1770694745485.png)

If video appears on the LIVE screen, the connection is successful.

![1770713854778.png](../image/1770713854778.png)

---

## Add Collector (Recorder)

Open the camera in edit mode and click ADD COLLECTOR.

> 📝 **Note**: This is optional and not a required step.

![1770695569362.png](../image/1770695569362.png)

Select the hlsRec collector, set the mode to "Image+Video", and click SAVE.

![1770695606099.png](../image/1770695606099.png)

The collector takes some time due to CloudFormation deployment. To check the status, open the collector in Edit mode.

![1770695676911.png](../image/1770695676911.png)

![1770695848059.png](../image/1770695848059.png)

---

## Add Collector (YOLO Detection)

Select the hlsYolo collector and choose Image for the mode (Video cannot be selected). Then configure the detection settings.

The example below shows settings for detecting area entry/exit.

| Setting | Recommended Value |
| --- | --- |
| Event Trigger Condition | Area entry/exit only |
| Area Detection | Bounding box detection |
| Area Detection Method | Count change detection (currently recommended) |

Also, set the area using EDIT AREA. Then select the YOLO Model. Currently running in CPU environment, so specify a small model like v9-s.

> 📝 **Hint**: You can train your own models. Place trained models with weights under `shared/yolo_detector/yolo`.

> 📝 **Note**: This is optional and not a required step.

![1770696052544.png](../image/1770696052544.png)

**Area Setting Screen** (Click to specify region)

![1770714037383.png](../image/1770714037383.png)

---

## Verify Collector (Recorder)

Select the camera and choose the IMAGE tab. Then select hlsRec from the Collector dropdown. If captured images are displayed in chronological order as shown below, it's successful.

![1770713914735.png](../image/1770713914735.png)

Similarly, select the VIDEO tab and choose hlsRec for Collector. If videos are recorded, it's successful.

![1770713969591.png](../image/1770713969591.png)

---

## Verify Collector (YOLO Detection)

Select the camera and choose the IMAGE tab. Then select hlsYolo from the Collector dropdown and select "collector-internal" for Detector. Select the "DETECTION" tab in the upper left and press the "DETECTION RESULT" button to open the right side panel. You'll see a screen like below.

Images are generated at area entry/exit timing, and you can check the detection result details in RESULT.

![1770713609675.png](../image/1770713609675.png)

**[Other Pattern Examples]**

![1770696803935.png](../image/1770696803935.png)

---

## Add Detector to Collector

Open the camera in edit mode and click "ADD DETECTOR" on the hlsYolo collector you added earlier.

> 📝 **Note**: This is optional and not a required step.

> 📝 **Hint**: You can also set up a DETECTOR on the hlsRec collector instead of hlsYolo. The difference is that hlsRec runs the DETECTOR on all images/videos, while hlsYolo only runs the DETECTOR when YOLO detects a class or area entry/exit.

![1770697066596.png](../image/1770697066596.png)

Select "Image" for File Type and "AreaDetectEvent" for Trigger Event (we selected AreaDetectEvent because we chose area entry/exit detection in hlsYolo, but for hlsRec, select SaveImageEvent/VideoImageEvent).

Then describe the camera's role and what you want to detect in the prompt.

> 📝 **Important**: To register detection results as tags, you need to register the tags you want to detect in the Tag Management screen beforehand and load them using ADD TAG.

![1770700968173.png](../image/1770700968173.png)

![1770716077947.png](../image/1770716077947.png)

Once registered, it will appear as a "bedrock" Detector as shown below.

![1770701183404.png](../image/1770701183404.png)

---

## Verify Detector

Select the camera and choose the IMAGE tab. Then select hlsYolo from the Collector dropdown and select "bedrock" for Detector.

Press the "DETECTION RESULT" button in the upper left to open the right side panel. You'll see a screen like below.

Detection is performed according to the instructions. If there are matching tags, you can also see the detected tags.

![1770713550978.png](../image/1770713550978.png)

---

## About Notifications

When content that should be notified is detected, the bell icon in the upper right turns red. Click to see the latest notification content.

![1770712031046.png](../image/1770712031046.png)

---

## About Insight Analytics

You can visually check how many tags occurred over time.

![1770713705171.png](../image/1770713705171.png)

![1770713722451.png](../image/1770713722451.png)

---

## About Full-text Search

You can perform full-text search by entering keywords. You can also filter by place, camera, tag, detection time, etc.

![1770714226917.png](../image/1770714226917.png)

---

## About Bookmark & Reporting

When you find an interesting image or video, press the ADD BOOKMARK button in the upper right.

![1770716146918.png](../image/1770716146918.png)

A bookmark registration screen will appear where you can select/create a save destination.

![1770716128553.png](../image/1770716128553.png)

You can check saved bookmarks from the Bookmark Management screen.

![1770716232979.png](../image/1770716232979.png)

Furthermore, pressing the CREATE REPORT button in the upper right allows you to create reports based on the detection information of bookmarked images/videos. Report content can be specified via prompt.

![1770716444350.png](../image/1770716444350.png)
