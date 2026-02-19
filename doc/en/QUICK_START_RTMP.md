# Quick Start RTMP Camera

This document covers the setup specifically for RTMP cameras. All other operations are the same as RTSP cameras, so please refer to that documentation.

[Quick Start RTSP Camera](QUICK_START_RTSP.md)

---

## Connect to Camera

Click CONNECT CAMERA on the camera screen.

![1770694215288.png](../image/1770694215288.png)

Enter the name and place, select RTMP for Camera Endpoint, and press the SAVE button. A message will appear indicating the camera is being created, so wait until it completes. This takes some time due to CloudFormation deployment.

> ⚠️ **Note**: For RTMP cameras, please do not navigate away from the screen during creation.

![1770716627124.png](../image/1770716627124.png)

Upon success, an RTMP URL and Stream Key will be generated.
Make sure to **copy** these.

> 🔒 **Security Note**: Please manage the connection information carefully to prevent leakage.

![1770718488369.png](../image/1770718488369.png)

---

## Camera Testing

For RTMP cameras, you cannot use the test video feature, so you need to prepare your own RTMP camera.

The easiest method is to use an RTMP client app on your smartphone. Searching the app store will reveal several apps with RTMP client (streaming) functionality.

We'll skip app recommendations, but most RTMP clients have fields for specifying the RTMP URL and Stream Key, so enter the information copied from the RTMP camera edit screen and start streaming.

> 📝 **Hint**: If there's only an RTMP URL field, the full URL is also shown on the RTMP camera edit screen, so you can use that.

If the video streamed from your smartphone's RTMP client app appears on the camera's LIVE screen, it's successful.

> ⏱️ **Note**: The first time may take 1-3 minutes to display. Please check while refreshing the LIVE screen. After connection, low-latency streaming is possible.

![image/1770726243225.png](../image/1770726243225.png)
