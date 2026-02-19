# DynamoDB Tables Structure

### 1. Place Table (cedix-place)
Stores information about locations.
| Attribute | Type | Description |
| --- | --- | --- |
| place_id | String (pk) | Unique identifier for the place |
| name | String | Name of the place |


### 2. Test Movie Table (cedix-test-movie)
| Attribute | Type | Description |
| --- | --- | --- |
| test_movie_id | String (pk) | Unique identifier for the test movie |
| name | String | Name of the test movie (user-specified, optional) |
| type | String | Video playback service setup for camera endpoint testing (none, rtsp, rtmp) |
| cloudformation_stack | String | CloudFormation stack name for camera endpoint testing video playback service (RTSP/RTMP) |
| test_movie_s3_path | String | S3 path of the test movie |
| rtsp_url | String | RTSP URL |
| create_at | String | Creation datetime (UTC, format follows project rules) |
| update_at | String | Update datetime (UTC, format follows project rules) |

### 3. Camera Table (cedix-camera)
Stores information about cameras.
| Attribute | Type | Description |
| --- | --- | --- |
| camera_id | String (pk) | Unique identifier for the camera |
| name | String | Name of the camera |
| place_id | String | Reference to the place where the camera is installed |
| type | String | Type of camera (e.g., kinesis, vsaas, s3) |
| vsaas_device_id | String | VSaaS device ID (if applicable) |
| vsaas_apikey | String | VSaaS API key (if applicable) |
| kinesis_streamarn | String | Kinesis stream name (if applicable) |
| s3path | String | Used for type s3. Path for upload |
| capture | String | S3 path for capture image |
| aws_access_key | String | AWS access key (kinesis, used when accessing other accounts) |
| aws_secret_access_key | String | AWS secret access key (kinesis, used when accessing other accounts) |
| aws_region | String | Region (kinesis, used when accessing other accounts) |
| camera_endpoint | String | Camera endpoint setup (none, rtsp, rtmp) |
| camera_endpoint_cloudformation_stack | String | CloudFormation stack name for camera endpoint (RTSP) |
| rtsp_url | String | RTSP server URL. Required when camera_endpoint is RTSP |
| rtmp_nlb_id | String | NLB ID for RTMP (when camera_endpoint='rtmp') |
| rtmp_port | Number | Port number for RTMP (when camera_endpoint='rtmp') |
| rtmp_stream_key | String | Stream key for RTMP (32-character alphanumeric random generation) |
| rtmp_endpoint | String | RTMP connection URL (auto-generated) |
| rtmp_kvs_stream_name | String | KVS stream name used for RTMP |
| rtmp_server_stack | String | CloudFormation stack name for RTMP server |



### 4. Camera Collector Table (cedix-collector)
Stores information about data collection methods for cameras.
| Attribute | Type | Description |
| --- | --- | --- |
| collector_id | String (pk, GSI-1-sk) | Unique identifier for the collector |
| camera_id | String (GSI-1-pk) | Unique identifier for the camera |
| collector | String | hlsRec/hlsYolo/s3Rec |
| collector_mode | String | image/video/image_and_video |
| cloudformation_stack | String | CloudFormation stack name for this collector |
| capture_cron | String | Camera cron schedule, used for batch capture |
| capture_image_interval | Number | Interval (seconds) (e.g., 5), used for real-time capture |
| capture_video_duration | Number | Video duration (seconds) (default: 60), used for real-time capture |
| model_path | String | Default is "yolo11n.pt". Any YOLO-compatible model can be specified. URL specification is also possible |
| capture_track_interval | Number | Interval (milliseconds) (e.g., 200), used for tracking frequency. capture_image_interval timing is always executed. If 0, tracking feature is off |
| capture_track_image_flg | Boolean | Used with capture_track_interval. Images are always saved when using detector, but turn ON if you want to save images periodically otherwise. Default is true |
| capture_track_image_counter | Number | Used with capture_track_interval. Specifies how often to save images. 1 means every time, 5 means every 5th time. Default is 25. If capture_track_interval is 200, this means once every 5 seconds |
| collect_class | String | Specify classes to collect such as person, car (assumes YOLOv9). e.g., "person", "car", "person,car" |
| confidence | Number | YOLO detection confidence threshold (0.0-1.0). Only detections with confidence above this value are included in filtered_detections. Default: 0.5 (50%) |
| track_eventtype | String | Event trigger condition. "class_detect": every time specified class is detected, "area_detect": only on area entry/exit |
| detect_area | String | Polygon coordinates for detection area (required when track_eventtype="area_detect"). e.g., "[(400,200), (880,200), (880,520), (400,520)]" |
| area_detect_type | String | Area detection method (only used when track_eventtype="area_detect"). "center": center point detection (default, fast), "intersects": partial overlap detection (for early detection, fast), "iou": IoU threshold detection (flexible, slightly slower) |
| area_detect_iou_threshold | Number | IoU threshold (only used when area_detect_type="iou"). 0.0-1.0. Default: 0.5. 0.0=any overlap, 0.5=more than half, 0.9=almost entire |
| area_detect_method | String | Area detection judgment method (only used when track_eventtype="area_detect"). "track_ids_change": judge by track_id change (default), "class_count_change": judge by count change (to avoid YOLO accuracy issues) |
| related_data_update_time | String | Last update time of related data (collector itself or detector) (ISO 8601 format). Auto-updated when collector is updated or detector is added/updated/deleted. Running collectors automatically restart when this value changes |
**GSI Configuration:**
- **GSI-1**: camera_id (PK) + collector_id (SK) - For searching collectors by camera

Notes:
- Images are output at capture_image_interval timing
- Tracking results are saved at capture_track_interval timing (YOLO runs continuously but determines when to output track information)
- detect_timing track-log

### 5. Camera Track Log Table (cedix-track-log)
This table stores YOLO detection results for one frame. One record per frame.

| Attribute | Type | Description |
| --- | --- | --- |
| track_log_id | String(PK) | Track log ID (UUID) |
| camera_id | String | Unique identifier for the camera |
| collector_id | String(GSI-1-PK) | Unique ID for the collector |
| file_id | String | Corresponding file_id |
| time | String(GSI-1-SK) | Track time (ISO 8601 format) |
| track_alldata | Map | All track data detected (tracked) by YOLO (key: track_id, value: track info) |
| track_classdata | Map | Data from track_alldata filtered to only classes matching collect_class (key: track_id, value: track info) |
| area_in_data | Map | Track data from track_classdata that is considered inside the area (key: track_id, value: track info) |
| area_out_data | Map | Track data from track_classdata that is considered outside the area (key: track_id, value: track info) |
| area_in_count | Number | Count of area_in_data |
| area_out_count | Number | Count of area_out_data |
| entered_ids | String | List of track_ids that newly entered the area this time (pipe-separated, e.g., "1 | 2 | 3") |
| entered_ids_count | Number | Number of tracks that newly entered the area this time (difference from previous) |
| exited_ids | String | List of track_ids that newly exited the area this time (pipe-separated, e.g., "4 | 5") |
| exited_ids_count | Number | Number of tracks that newly exited the area this time (difference from previous) |
**GSI Configuration:**
- **GSI-1**: collector_id (PK) + time (SK) - For time-series search by collector
- **GSI-2**: file_id (PK) - For track log search from file ID



### 6. File Table (cedix-file)
Stores information about video files.

| Attribute | Type | Description |
| --- | --- | --- |
| file_id | String (pk) | Unique identifier for the file |
| camera_id | String (GSI-3-pk) | Reference to the camera that recorded the video |
| collector_id | String | Unique ID for the collector |
| file_type | String | image/video |
| collector_id_file_type | String (GSI-1-pk) | Composite key (collector_id + " | " + file_type) |
| start_time | String (GSI-1-sk) (GSI-3-sk) | Start time of video/image |
| end_time | String | End time of video/image (not used for images) |
| s3path | String (GSI-2-pk) | S3 path to video file or image folder. Format: s3://<bucket_name>/<collector_id>/<file_type>/.... |
| s3path_detect | String | S3 path to video file or image folder. Format: s3://<bucket_name>/<collector_id>/<file_type>_detect/.... |
**GSI Configuration:**
- **GSI-1**: collector_id_file_type (PK) + start_time (SK) - For search by collector and file type (main search GSI)
- **GSI-2**: s3path (PK) - For S3 path search
- **GSI-3**: camera_id (PK) + start_time (SK) - For basic search by camera

### 7. Detector Table (cedix-detector)
Stores information about detection configurations.

| Attribute | Type | Description |
| --- | --- | --- |
| detector_id | String (pk) | Unique identifier for the detector |
| camera_id | String(GSI-2-pk) | Reference to the camera |
| collector_id | String(GSI-2-sk) | Unique ID for the collector |
| file_type | String | File type for detection (image/video) |
| collector_id_file_type | String (GSI-1-pk) | Composite key (collector_id + " | " + file_type) |
| trigger_event | String | SaveVideoEvent/SaveImageEvent/AreaDetectEvent/ClassDetectEvent |
| detector | String | Detection method (bedrock/sagemaker/custom) |
| detect_interval | Number | Interval (milliseconds) (e.g., 5000), used for real-time capture |
| model | String | AI model |
| system_prompt | String | Role definition (system prompt) |
| detect_prompt | String | Detection conditions/what to detect (detection prompt) |
| tag_prompt_list | Set | Tag output criteria (criteria for outputting tags based on what was detected). Includes cedix-tag's tag_id, tag_name, tag_prompt, and notify_flg (Boolean) and compare_file_flg (Boolean) |
| tag_list | String | List of tags to detect (pipe-separated, tag_name) |
| compare_file_flg | Boolean | Flag to compare with old files |
| max_tokens | Number | Maximum tokens |
| temperature | Number | Generation temperature parameter |
| top_p | Number | Top-p sampling parameter |
| lambda_endpoint_arn | String | Lambda ARN |
| event_notify | Boolean | Flag to save event info to detect-log and notify. Default false, but AreaDetectEvent defaults to true |
**GSI Configuration:**
- **GSI-1**: collector_id_file_type (PK) - For search by collector and file type
- **GSI-2**: camera_id (PK) + collector_id (SK) - For search by camera

### 8. DetectLog Table (cedix-detect-log)
Stores detection results and logs.

| Attribute | Type | Description |
| --- | --- | --- |
| detect_log_id | String (pk) | Unique identifier for the detection log |
| detector_id | String | Unique identifier for the detector |
| camera_id | String | Reference to the camera |
| collector_id | String | Unique ID for the collector |
| file_type | String | File type for detection (image/video) |
| collector_id_file_type | String (GSI-1-pk) | Composite key (collector_id + " | " + file_type) |
| file_id | String (GSI-3-pk) | Reference to the processed file |
| s3path | String | S3 path for detection result image |
| s3path_detect | String | S3 path to video file or image folder. Format: s3://<bucket_name>/<collector_id>/<file_type>_detect/.... |
| start_time | String(GSI-1-sk) (GSI-2-sk) | Detection start time |
| end_time | String | Detection end time |
| detect_result | String | Detection result details |
| detect_tag | Set | Set of detected tags |
| detect_notify_flg (GSI-2-pk) | Boolean | Whether notification was sent |
| detect_notify_reason | String | Reason for notification |
| place_id | String | Reference to the place |
| place_name | String | Name of the place |
| camera_name | String | Name of the camera |
| collector | String | Collection method used |
| detector | String | Detection method used (vlmImage/vlmVideo/cvImage) |
| track_log_id | String | Corresponding track log ID |
| trigger_event | String | SaveVideoEvent/SaveImageEvent/AreaDetectEvent/ClassDetectEvent |
**GSI Configuration:**
- **GSI-1**: collector_id_file_type (PK) + start_time (SK) - For search by collector and file type
- **GSI-2**: detect_notify_flg (PK) + start_time (SK) - For search by notification flag
- **GSI-3**: collector_id_file_type (PK) + start_time (SK) - Optimized for timeline display (ProjectionType: ALL, changed 2025-11-19) *Scheduled for deletion due to overlap with GSI-1
- **GSI-4**: file_id (PK) + detector_id (SK) - For search by file and detector ID
- **GSI-5**: collector_id_detector_id (PK) + start_time (SK) - For has_detect judgment (ProjectionType: KEYS_ONLY, added 2026-01-27)

### 9. DetectLogTag Table (cedix-detect-log-tag)
Accumulates tags detected in cedix-detect-log by overall/place/camera.
| Attribute | Type | Description |
| --- | --- | --- |
| data_type | String (PK) | TAG or PLACE\ | {place_id} or CAMERA\ | {camera_id} |
| detect_tag_name | String (SK) | Name of the detected tag |

**data_type values:**
- `TAG` - Overall tag list
- `PLACE|{place_id}` - Tags detected at a specific place
- `CAMERA|{camera_id}` - Tags detected by a specific camera

**Query examples:**
```python
# Get all tags
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': 'TAG'})

# Get tags for specific place_id
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': f'PLACE|{place_id}'})

# Get tags for specific camera_id
table.query(KeyConditionExpression="data_type = :dt", ExpressionAttributeValues={':dt': f'CAMERA|{camera_id}'})
```

### 10. Time Series Data (cedix-detect-tag-timeseries)
| Attribute | Type | Description |
| --- | --- | --- |
| tag_name | String (PK) | Tag name |
| time_key | String (SK, GSI-1-SK, GSI-2-SK) | Time key (MINUTE | yyyy-mm-ddThh:mm, HOUR | yyyy-mm-ddThh, DAY | yyyy-mm-dd, time is based on aggregation start time) |
| count | Number | Count |
| place_id | String | Place ID (for GSI) |
| camera_id | String | Camera ID (for GSI) |
| place_tag_key | String (GSI-1-PK) | Composite key (place_id + " | " + tag_name) |
| camera_tag_key | String (GSI-2-PK) | Composite key (camera_id + " | " + tag_name) |
| start_time | String | Aggregation start time |
| end_time | String | Aggregation end time |
| granularity | String | Granularity (MINUTE/HOUR/DAY) |
| data_type | String | TAG/PLACE/CAMERA (which aggregation unit the data belongs to) |
[GSI Design]
// GSI-1: For place > tag search
GSI-1-PK: place_tag_key
GSI-1-SK: time_key

// GSI-2: For camera > tag search
GSI-2-PK: camera_tag_key
GSI-2-SK: time_key

(1) Time series by tag
PK = "tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

(2) Time series by place > tag
PK = "place01|tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

(3) Time series by camera > tag
PK = "camera01|tag1"
SK between "MINUTE|2025-01-12T00:00" and "MINUTE|2025-01-12T23:59"

### 11. Bookmark (cedix-bookmark)
Stores bookmark information created by users.
| Attribute | Type | Description |
| --- | --- | --- |
| bookmark_id | String (pk) | Unique identifier for the bookmark |
| bookmark_name | String | Name of the bookmark |
| username | String | Cognito username (email address) |
| updatedate | String (GSI-1-pk) | Creation/update datetime |
(GSI Configuration)
- GSI-1: updatedate (pk) - For search by update datetime

### 12. Bookmark Detail (cedix-bookmark-detail)
Stores detailed information about specific files and data contained in bookmarks.
| Attribute | Type | Description |
| --- | --- | --- |
| bookmark_id | String (pk, GSI-1-pk) | Unique identifier for the bookmark |
| bookmark_no | Number (sk) | Sequence number within the bookmark |
| file_id | String | Reference to the file |
| collector_id | String | Unique ID for the collector |
| collector | String | Collector |
| file_type | String | File type (image/video) |
| datetime | String(GSI-1-sk) | File datetime (YYYYMMDDHHMM format) |
| camera_id | String | Unique identifier for the camera |
| camera_name | String | Name of the camera |
| place_id | String | Unique identifier for the place |
| place_name | String | Name of the place |
| detector_id | String | Unique identifier for the detector |
| detector | String | Detection method used (vlmImage/vlmVideo/cvImage) |

### 13. Tag Category (cedix-tag-category)
Stores category information for classifying tags.
| Attribute | Type | Description |
| --- | --- | --- |
| tagcategory_id | String (pk) | Unique identifier for the tag category |
| tagcategory_name | String | Name of the tag category |
| updatedate | String | Update datetime |
| system_prompt | String | Role definition (system prompt template) |
| detect_prompt | String | Detection conditions/what to detect (prompt template) |

### 14. Tag (cedix-tag)
Stores master information for detection tags.
| Attribute | Type | Description |
| --- | --- | --- |
| tag_id | String (pk) | Tag name (unique identifier) |
| tag_name | String (GSI-2-pk, GSI-1-sk) | Tag name (unique identifier) |
| detect_tag_name | String | CV tag |
| tag_prompt | String | Tag output criteria/criteria for outputting tags based on what was detected (prompt template) |
| description | String | Tag description |
| tagcategory_id | String(GSI-1-pk) | Reference to tag category |
| s3path | String | S3 path for reference image used as judgment criteria |
| file_format | String | Reference image file format (e.g., jpg, png) |
| updatedate | String | Update datetime |
Note: This tag table is not a strict "master".
It simply exists to make it easy to create cedix-detect.


### 15. RTMP NLB Management (cedix-rtmp-nlb)
Table for managing shared NLB for RTMP cameras.
| Attribute | Type | Description |
| --- | --- | --- |
| nlb_id | String (pk) | Unique identifier for the NLB (e.g., rtmp-nlb-001) |
| nlb_arn | String | NLB ARN |
| nlb_dns_name | String | NLB DNS name |
| security_group_id | String | Security group ID for NLB |
| port_range_start | Number | Port range start for this NLB (e.g., 1935) |
| port_range_end | Number | Port range end for this NLB (e.g., 1984) |
| used_ports | Number | Number of ports in use (0-50) |
| allocated_ports | List | List of allocated port numbers |
| status | String (GSI-1-pk) | NLB status (active/deleting) |
| stack_name | String | CloudFormation stack name |
| created_at | String (GSI-1-sk) | Creation datetime (ISO 8601 format, UTC) |
| updated_at | String | Update datetime (ISO 8601 format, UTC) |
**GSI Configuration:**
- **GSI-1**: status (PK) + created_at (SK) - For search by status

**Design Overview:**
- 1 NLB = 50 ports (NLB listener limit)
- 100 NLBs × 50 ports = supports 5000 RTMP cameras
- Port range: 1935-6934
- NLB is automatically created when the first RTMP camera is added
- NLB is automatically deleted when used ports becomes 0
