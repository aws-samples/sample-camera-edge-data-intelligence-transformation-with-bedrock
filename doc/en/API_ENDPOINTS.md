# API Endpoints List
This document lists all API endpoints (85 endpoints) in this sample.

## 1. userinfo (User Information)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/userinfo/` | Get authenticated user information |
| GET | `/api/userinfo/cognito-details` | Get Cognito details |
| GET | `/api/userinfo/auth-debug` | Authentication debug information |
| POST | `/api/userinfo/change-password` | Change password |
| GET | `/api/userinfo/user-info` | Get user information |

## 2. place (Place Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/place/` | Get place list |
| GET | `/api/place/{place_id}` | Get place details |
| POST | `/api/place/` | Create place |
| PUT | `/api/place/{place_id}` | Update place |
| DELETE | `/api/place/{place_id}` | Delete place |

## 3. camera (Camera Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/camera/` | Get camera list |
| GET | `/api/camera/{camera_id}` | Get camera details |
| POST | `/api/camera/` | Create camera (starts CloudFormation deployment) |
| PUT | `/api/camera/{camera_id}` | Update camera |
| DELETE | `/api/camera/{camera_id}` | Delete camera |
| GET | `/api/camera/{camera_id}/deploy-status` | Get deployment status |
| GET | `/api/camera/{camera_id}/collectors` | Get camera's collector list |
| GET | `/api/camera/cameras/filtered` | Get filtered camera list |
| GET | `/api/camera/cameras` | Get camera list (simple) |
| GET | `/api/camera/cameras/{camera_id}` | Get camera details (simple) |
| POST | `/api/camera/upload-test-movie` | Generate test video upload URL |

## 4. camera-collector (Collector Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/camera-collector/` | Get collector list |
| GET | `/api/camera-collector/{collector_id}` | Get collector details |
| POST | `/api/camera-collector/` | Create collector (auto CloudFormation deployment) |
| PUT | `/api/camera-collector/{collector_id}` | Update collector |
| DELETE | `/api/camera-collector/{collector_id}` | Delete collector |
| GET | `/api/camera-collector/deploy-status/{collector_id}` | Check deployment status |
| GET | `/api/camera-collector/remove-status/{collector_id}` | Check deletion status |

## 5. file (File Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/file/camera/{camera_id}` | Get files by camera |
| GET | `/api/file/datetime/{camera_id}/{datetime_prefix}` | Get files by datetime |
| GET | `/api/file/hls/{camera_id}` | Get HLS URL |
| GET | `/api/file/mp4download/{file_id}` | Get download URL |
| POST | `/api/file/` | Create file |
| GET | `/api/file/{file_id}` | Get file details |
| PUT | `/api/file/{file_id}` | Update file |
| DELETE | `/api/file/{file_id}` | Delete file |
| GET | `/api/file/summary/{camera_id}/{datetime_prefix}` | Get hourly summary |

## 6. detector (Detector Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/detector/trigger-events` | Get trigger event list |
| GET | `/api/detector/cameras/{camera_id}/detectors` | Get detectors by camera |
| GET | `/api/detector/detectors/{detector_id}` | Get detector details |
| POST | `/api/detector/` | Create detector |
| PUT | `/api/detector/{detector_id}` | Update detector |
| DELETE | `/api/detector/{detector_id}` | Delete detector |
| GET | `/api/detector/load-from-category/{tagcategory_id}` | Load from tag category |

## 7. detect-log (Detection Log)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/detect-log/files/{file_id}/detect-logs` | Get detection logs by file |
| GET | `/api/detect-log/detect-logs/{detect_log_id}` | Get detection log details |
| PUT | `/api/detect-log/detect-logs/{detect_log_id}/notify` | Update notification flag |
| GET | `/api/detect-log/notifications/recent` | Get recent notifications |
| GET | `/api/detect-log/notifications/history` | Get notification history |

## 8. timeseries (Time Series Data)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/timeseries/tags` | Get tag list |
| POST | `/api/timeseries/timeseries` | Get time series data |
| POST | `/api/timeseries/detail-logs` | Get detailed logs |

## 9. search (Search)
| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/search/` | Full-text search |
| GET | `/api/search/tags` | Get search tags |
| GET | `/api/search/search-options` | Get search options |

## 10. bookmark (Bookmark)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/bookmark/` | Get bookmark list |
| POST | `/api/bookmark/` | Create bookmark |
| DELETE | `/api/bookmark/{bookmark_id}` | Delete bookmark |
| GET | `/api/bookmark/{bookmark_id}/details` | Get bookmark details list |
| POST | `/api/bookmark/{bookmark_id}/details` | Add bookmark detail |
| DELETE | `/api/bookmark/{bookmark_id}/details/{bookmark_no}` | Delete bookmark detail |
| POST | `/api/bookmark/detail` | Create bookmark detail |

## 11. report (Report)
| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/report/create` | Generate report with Bedrock |

## 12. tag (Tag Management)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/tag/categories/` | Get tag category list |
| POST | `/api/tag/categories/` | Create tag category |
| PUT | `/api/tag/categories/{tagcategory_id}` | Update tag category |
| DELETE | `/api/tag/categories/{tagcategory_id}` | Delete tag category |
| GET | `/api/tag/` | Get tag list |
| GET | `/api/tag/{tag_name}` | Get tag details |
| POST | `/api/tag/` | Create tag |
| PUT | `/api/tag/{tag_name}` | Update tag |
| DELETE | `/api/tag/{tag_name}` | Delete tag |
| POST | `/api/tag/upload-image/` | Upload tag image |
| GET | `/api/tag/{tag_name}/image-url/` | Get tag image URL |
| GET | `/api/tag/tags/sync` | Sync tags |
| GET | `/api/tag/tags/detection-stats` | Get tag detection stats |

## 13. tags (Tag List)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/tags/` | Get tag list (using Query) |

## 14. test-movie (Test Movie)
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/test-movie/` | Get test movie list |
| GET | `/api/test-movie/{test_movie_id}` | Get test movie details |
| POST | `/api/test-movie/` | Create test movie |
| GET | `/api/test-movie/{test_movie_id}/status` | Get deployment status |
| PUT | `/api/test-movie/{test_movie_id}` | Update test movie |
| DELETE | `/api/test-movie/{test_movie_id}` | Delete test movie |
| POST | `/api/test-movie/upload` | Generate upload URL |

## API Router Registration (main.py)
The following routers are registered in `backend/api_gateway/api/main.py`:
| Prefix | Router | Tag |
| --- | --- | --- |
| `/api/place` | place.router | Place |
| `/api/camera` | camera.router | Camera |
| `/api/camera-collector` | camera_collector.router | Camera Collector |
| `/api/file` | file.router | File |
| `/api/userinfo` | userinfo.router | User Info |
| `/api/detector` | detector.router | Detector |
| `/api/detect-log` | detect_log.router | Detect Log |
| `/api/bookmark` | bookmark.router | Bookmark |
| `/api/report` | report.router | Report |
| `/api/test-movie` | test_movie.router | Test Movie |
| `/api/search` | search.router | Search |
| `/api/timeseries` | detect_tag_timeseries.router | Timeseries |
| `/api/tag` | tag.router | Tag |
| `/api/tags` | tags.router | Tags |
