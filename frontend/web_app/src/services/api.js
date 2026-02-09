import { API, Auth } from 'aws-amplify';
import { requiredEnvVar } from '../utils/env';

const apiName = 'cedix_api';

// APIベースURLを取得するヘルパー関数
const getApiBaseUrl = () => requiredEnvVar('VITE_API_URL', import.meta.env.VITE_API_URL);

// Helper function to get auth headers
const getAuthHeaders = async () => {
  try {
    console.log('Getting auth headers...');
    const session = await Auth.currentSession();
    console.log('Current session:', session);
    const token = session.getIdToken().getJwtToken();
    console.log('JWT Token:', token.substring(0, 50) + '...');
    const headers = {
      Authorization: `Bearer ${token}`
    };
    console.log('Auth headers:', headers);
    return headers;
  } catch (error) {
    console.error('Error getting auth token:', error);
    return {};
  }
};

// Place API calls
export const getPlaces = async () => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, '/api/place', { headers });
  } catch (error) {
    console.error('Error fetching places:', error);
    throw error;
  }
};


export const getPlace = async (placeId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/place/${placeId}`, { headers });
  } catch (error) {
    console.error("Error fetching place %s:", placeId, error);
    throw error;
  }
};

export const createPlace = async (placeData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.post(apiName, '/api/place', { 
      headers,
      body: placeData
    });
  } catch (error) {
    console.error('Error creating place:', error);
    throw error;
  }
};

export const updatePlace = async (placeId, placeData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.put(apiName, `/api/place/${placeId}`, {
      headers,
      body: placeData
    });
  } catch (error) {
    console.error("Error updating place %s:", placeId, error);
    throw error;
  }
};

export const deletePlace = async (placeId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.del(apiName, `/api/place/${placeId}`, { headers });
  } catch (error) {
    console.error("Error deleting place %s:", placeId, error);
    throw error;
  }
};

// Camera API calls
export const getCameras = async (includeImage = false) => {
  try {
    const headers = await getAuthHeaders();
    const url = `/api/camera${includeImage ? '?image=true' : ''}`;
    console.log('Making API call to', url, 'with headers:', headers);
    
    // Try direct fetch for debugging
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}${url}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Response data:', data);
    return data;
    
    // Original Amplify API call (commented out for debugging)
    // return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error('Error fetching cameras:', error);
    throw error;
  }
};

export const getCamerasByPlace = async (placeId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/camera?place_id=${placeId}`, { headers });
  } catch (error) {
    console.error("Error fetching cameras for place %s:", placeId, error);
    throw error;
  }
};

export const getCamera = async (cameraId, includeImage = false) => {
  try {
    const headers = await getAuthHeaders();
    const url = `/api/camera/${cameraId}${includeImage ? '?image=true' : ''}`;
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching camera %s:", cameraId, error);
    throw error;
  }
};

export const getCameraCollectors = async (cameraId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/camera/${cameraId}/collectors`, { headers });
  } catch (error) {
    console.error("Error fetching camera collectors for %s:", cameraId, error);
    throw error;
  }
};

// File API calls
export const getFilesByCamera = async (cameraId, startDate, endDate) => {
  try {
    const headers = await getAuthHeaders();
    let url = `/api/file/camera/${cameraId}`;
    if (startDate && endDate) {
      url += `?start_date=${startDate}&end_date=${endDate}`;
    }
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching files for camera %s:", cameraId, error);
    throw error;
  }
};

export const getFilesByDateTime = async (cameraId, dateTimePrefix, collectorId, fileType, includePresignedUrl = false, includeDetectFlag = false, detectorId = null) => {
  try {
    // Validate required parameters
    if (!collectorId) {
      throw new Error('collectorId parameter is required');
    }
    if (!fileType) {
      throw new Error('fileType parameter is required');
    }
    if (!['image', 'video'].includes(fileType)) {
      throw new Error('fileType must be "image" or "video"');
    }
    
    const headers = await getAuthHeaders();
    let url = `/api/file/datetime/${cameraId}/${dateTimePrefix}`;
    const params = [
      `collector_id=${collectorId}`,
      `file_type=${fileType}`,
      `include_presigned_url=${includePresignedUrl}`,
      `include_detect_flag=${includeDetectFlag}`
    ];
    
    // detector_idが指定されている場合のみ追加
    if (detectorId) {
      params.push(`detector_id=${detectorId}`);
    }
    
    url += `?${params.join('&')}`;
    
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching files for camera %s at %s:", cameraId, dateTimePrefix, error);
    throw error;
  }
};

// HLS URL API call
export const hlsRecUrl = async (cameraId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/file/hls/${cameraId}`, { headers });
  } catch (error) {
    console.error("Error fetching HLS URL for camera %s:", cameraId, error);
    throw error;
  }
};

// File Download API call (supports both MP4 and image files)
export const downloadFile = async (fileId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/file/mp4download/${fileId}`, { headers });
  } catch (error) {
    console.error("Error downloading file %s:", fileId, error);
    throw error;
  }
};

// User info API call
export const getUserInfo = async () => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, '/api/userinfo', { headers });
  } catch (error) {
    console.error('Error fetching user info:', error);
    throw error;
  }
};

export const getFilesSummaryByHour = async (cameraId, dateTimePrefix, collectorId = null, fileType = null, includeDetectFlag = false, detectorId = null) => {
  try {
    const headers = await getAuthHeaders();
    let url = `/api/file/summary/${cameraId}/${dateTimePrefix}`;
    const params = [];
    if (collectorId) {
      params.push(`collector_id=${collectorId}`);
    }
    if (fileType) {
      params.push(`file_type=${fileType}`);
    }
    if (includeDetectFlag) {
      params.push(`include_detect_flag=true`);
    }
    // detector_idが指定されている場合のみ追加
    if (detectorId) {
      params.push(`detector_id=${detectorId}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching file summary for camera %s at %s:", cameraId, dateTimePrefix, error);
    throw error;
  }
};

// Detector API calls
export const getCameraDetectors = async (cameraId, collectorId = null, fileType = null) => {
  try {
    const headers = await getAuthHeaders();
    let url = `/api/detector/cameras/${cameraId}/detectors`;
    const params = [];
    if (collectorId) {
      params.push(`collector_id=${collectorId}`);
    }
    if (fileType) {
      params.push(`file_type=${fileType}`);
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching camera detectors for %s:", cameraId, error);
    throw error;
  }
};

export const getDetectorDetails = async (detectorName) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/detector/detectors/${detectorName}`, { headers });
  } catch (error) {
    console.error("Error fetching detector details for %s:", detectorName, error);
    throw error;
  }
};

// Detect Log API calls
export const getFileDetectLogs = async (fileId, detectorId = null) => {
  try {
    const headers = await getAuthHeaders();
    let url = `/api/detect-log/files/${fileId}/detect-logs`;
    if (detectorId) {
      url += `?detector_id=${detectorId}`;
    }
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching detect logs for file %s:", fileId, error);
    throw error;
  }
};

export const getDetectLogDetails = async (detectLogId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/detect-log/detect-logs/${detectLogId}`, { headers });
  } catch (error) {
    console.error("Error fetching detect log details for %s:", detectLogId, error);
    throw error;
  }
};

export const updateDetectLogNotify = async (detectLogId, notifyFlg, notifyReason = null) => {
  try {
    console.log('API: Updating detect log notify flag:', { detectLogId, notifyFlg, notifyReason });
    const headers = await getAuthHeaders();
    const body = {
      notify_flg: notifyFlg
    };
    if (notifyReason !== null) {
      body.notify_reason = notifyReason;
    }
    const response = await API.put(apiName, `/api/detect-log/detect-logs/${detectLogId}/notify`, {
      headers,
      body
    });
    return response.data;
  } catch (error) {
    console.error('Error updating detect log notify flag:', error);
    throw error;
  }
};

// Get recent notifications
export const getRecentNotifications = async () => {
  try {
    console.log('=== getRecentNotifications API function called ===');
    console.log('Getting auth headers...');
    const headers = await getAuthHeaders();
    console.log('Auth headers received:', headers);
    
    console.log('Making API call to /api/detect-log/notifications/recent');
    const response = await API.get(apiName, '/api/detect-log/notifications/recent', { headers });
    
    console.log('Raw API response:', response);
    console.log('Response type:', typeof response);
    console.log('Response keys:', Object.keys(response || {}));
    
    const result = response;
    console.log('Final result:', result);
    console.log('=== getRecentNotifications API function end ===');
    return result;
  } catch (error) {
    console.error('=== getRecentNotifications API function error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
};

// Get notification history with pagination
export const getNotificationHistory = async (page = 1, limit = 20) => {
  try {
    console.log('=== getNotificationHistory API function called ===');
    console.log('Getting auth headers...');
    const headers = await getAuthHeaders();
    console.log('Auth headers received:', headers);
    
    const url = `/api/detect-log/notifications/history?page=${page}&limit=${limit}`;
    console.log(`Making API call to ${url}`);
    const response = await API.get(apiName, url, { headers });
    
    console.log('Raw API response:', response);
    console.log('Response type:', typeof response);
    console.log('Response keys:', Object.keys(response || {}));
    
    const result = response;
    console.log('Final result:', result);
    console.log('=== getNotificationHistory API function end ===');
    return result;
  } catch (error) {
    console.error('=== getNotificationHistory API function error ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
};

// OpenSearch 検索機能（修正版）
export const searchNotifications = async (searchParams) => {
  try {
    console.log('=== searchNotifications API function called ===');
    console.log('Search params received:', searchParams);
    
    const headers = await getAuthHeaders();
    
    // Search.jsのパラメータ名に合わせて修正
    const searchRequest = {
      query: searchParams.query && searchParams.query.trim() !== '' ? searchParams.query : null,
      tags: searchParams.tags && searchParams.tags.length > 0 ? searchParams.tags : null,
      tag_search_mode: searchParams.tag_search_mode || 'AND',  // 追加
      page: searchParams.page || 1,
      limit: searchParams.limit || 20,
      place_id: searchParams.place_id || null,      // 修正: placeId → place_id
      camera_id: searchParams.camera_id || null,    // 修正: cameraId → camera_id  
      collector: searchParams.collector || null,
      file_type: searchParams.file_type || null,    // 修正: fileType → file_type
      detector: searchParams.detector || null,
      detect_notify_flg: searchParams.detect_notify_flg || null, // 追加
      start_date: searchParams.start_date || null,  // 修正: startDate → start_date
      end_date: searchParams.end_date || null       // 修正: endDate → end_date
    };
    
    console.log('Search request to be sent:', searchRequest);
    
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(searchRequest)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Search response received:', result);
    console.log('=== searchNotifications API function end ===');
    return result;
  } catch (error) {
    console.error('Error searching notifications:', error);
    throw error;
  }
};

export const getAvailableTags = async () => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/search/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching available tags:', error);
    throw error;
  }
};

// 検索オプション取得
export const getSearchOptions = async () => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/search/search-options`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching search options:', error);
    throw error;
  }
};

// フィルタリング対応カメラ一覧取得
export const getFilteredCameras = async ({ placeIds = [], searchTerm = '', page = 1, limit = 20, includeImage = false } = {}) => {
  try {
    const headers = await getAuthHeaders();
    
    // クエリパラメータ構築
    const params = new URLSearchParams();
    
    // 場所IDが指定されている場合
    if (placeIds && placeIds.length > 0) {
      placeIds.forEach(placeId => params.append('place_ids', placeId));
    }
    
    // 検索語が指定されている場合
    if (searchTerm && searchTerm.trim() !== '') {
      params.append('search_term', searchTerm.trim());
    }
    
    // ページング
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    
    // 画像URL含めるか
    if (includeImage) {
      params.append('include_image', 'true');
    }
    
    const url = `/api/camera/cameras/filtered?${params.toString()}`;
    console.log('Fetching filtered cameras:', url);
    
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error('Error fetching filtered cameras:', error);
    throw error;
  }
};

// Timeseries API functions for Insight page
export const getTimeseriesTags = async (placeId = null, cameraId = null) => {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (placeId) params.append('place_id', placeId);
    if (cameraId) params.append('camera_id', cameraId);
    
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/timeseries/tags?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching timeseries tags:', error);
    throw error;
  }
};

export const getTimeseriesData = async (tags, granularity, placeId = null, cameraId = null, startTime = null, endTime = null) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const requestBody = {
      tags,
      granularity,
      place_id: placeId,
      camera_id: cameraId
    };
    
    // 時間範囲が指定されている場合は追加（既に文字列形式で渡される）
    if (startTime && endTime) {
      requestBody.start_time = startTime;
      requestBody.end_time = endTime;
    }
    
    const response = await fetch(`${baseUrl}/api/timeseries/timeseries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching timeseries data:', error);
    throw error;
  }
};

export const getTimeseriesDetailLogs = async (startTime, endTime, tagName, placeId = null, cameraId = null) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/timeseries/detail-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({
        start_time: startTime,
        end_time: endTime,
        tag_name: tagName,
        place_id: placeId,
        camera_id: cameraId
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching timeseries detail logs:', error);
    throw error;
  }
};

// 新しい共通タグ取得API
export const getDetectorTags = async (placeId = null, cameraId = null) => {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (placeId) params.append('place_id', placeId);
    if (cameraId) params.append('camera_id', cameraId);
    
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/tags?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching detector tags:', error);
    throw error;
  }
};

// Bookmark API functions
export const getUserBookmarks = async () => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching user bookmarks:', error);
    throw error;
  }
};

export const createBookmark = async (bookmarkData) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(bookmarkData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error creating bookmark:', error);
    throw error;
  }
};

export const deleteBookmark = async (bookmarkId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/${bookmarkId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return true; // 成功時
  } catch (error) {
    console.error('Error deleting bookmark:', error);
    throw error;
  }
};

export const deleteBookmarkDetail = async (bookmarkId, bookmarkNo) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/${bookmarkId}/details/${bookmarkNo}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting bookmark detail:', error);
    throw error;
  }
};

export const getBookmarkDetails = async (bookmarkId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/${bookmarkId}/details`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching bookmark details:', error);
    throw error;
  }
};

export const addBookmarkDetail = async (bookmarkId, detailData) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/${bookmarkId}/details`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(detailData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error adding bookmark detail:', error);
    throw error;
  }
};

// Create bookmark detail using new API endpoint
export const createBookmarkDetail = async (detailData) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    
    const response = await fetch(`${baseUrl}/api/bookmark/detail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(detailData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error creating bookmark detail:', error);
    throw error;
  }
};

// Tag API calls
export const getTags = async (categoryId = null, includeDetails = false) => {
  try {
    const headers = await getAuthHeaders();
    let url = '/api/tag';
    const params = [];
    
    if (categoryId) {
      params.push(`category_id=${categoryId}`);
    }
    if (includeDetails) {
      params.push('include_details=true');
    }
    
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error('Error fetching tags:', error);
    throw error;
  }
};

export const getTagCategories = async () => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, '/api/tag/categories', { headers });
  } catch (error) {
    console.error('Error fetching tag categories:', error);
    throw error;
  }
};

// Camera create/update API calls
export const createCamera = async (cameraData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.post(apiName, '/api/camera', {
      headers,
      body: cameraData
    });
  } catch (error) {
    console.error('Error creating camera:', error);
    throw error;
  }
};

export const updateCamera = async (cameraId, cameraData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.put(apiName, `/api/camera/${cameraId}`, {
      headers,
      body: cameraData
    });
  } catch (error) {
    console.error("Error updating camera %s:", cameraId, error);
    throw error;
  }
};

// Camera Collector API calls
export const createCameraCollector = async (collectorData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.post(apiName, '/api/camera-collector/', {
      headers,
      body: collectorData
    });
  } catch (error) {
    console.error('Error creating camera collector:', error);
    throw error;
  }
};

export const updateCameraCollector = async (collectorId, collectorData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.put(apiName, `/api/camera-collector/${collectorId}`, {
      headers,
      body: collectorData
    });
  } catch (error) {
    console.error("Error updating camera collector %s:", collectorId, error);
    throw error;
  }
};

export const deleteCameraCollector = async (collectorId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.del(apiName, `/api/camera-collector/${collectorId}`, { headers });
  } catch (error) {
    console.error("Error deleting camera collector %s:", collectorId, error);
    throw error;
  }
};

export const checkCameraCollectorDeployStatus = async (collectorId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/camera-collector/deploy-status/${collectorId}`, { headers });
  } catch (error) {
    console.error("Error checking deploy status for %s:", collectorId, error);
    throw error;
  }
};

// Detector API calls
export const createDetector = async (detectorData) => {
  try {
    const headers = await getAuthHeaders();
    console.log('createDetector送信body:', detectorData);
    return await API.post(apiName, '/api/detector', {
      headers,
      body: detectorData
    });
  } catch (error) {
    console.error('Error creating detector:', error);
    throw error;
  }
};

export const updateDetector = async (detectorId, detectorData) => {
  try {
    const headers = await getAuthHeaders();
    console.log('updateDetector送信body:', detectorData);
    return await API.put(apiName, `/api/detector/${detectorId}`, {
      headers,
      body: detectorData
    });
  } catch (error) {
    console.error("Error updating detector %s:", detectorId, error);
    throw error;
  }
};

export const deleteDetector = async (detectorId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.del(apiName, `/api/detector/${detectorId}`, { headers });
  } catch (error) {
    console.error("Error deleting detector %s:", detectorId, error);
    throw error;
  }
};

export const getTriggerEvents = async (collectorId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/detector/trigger-events?collector_id=${collectorId}`, { headers });
  } catch (error) {
    console.error("Error fetching trigger events for collector %s:", collectorId, error);
    throw error;
  }
};

// Tag Category Management API calls
export const createTagCategory = async (categoryData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.post(apiName, '/api/tag/categories/', {
      headers,
      body: categoryData
    });
  } catch (error) {
    console.error('Error creating tag category:', error);
    throw error;
  }
};

export const updateTagCategory = async (categoryId, categoryData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.put(apiName, `/api/tag/categories/${categoryId}`, {
      headers,
      body: categoryData
    });
  } catch (error) {
    console.error("Error updating tag category %s:", categoryId, error);
    throw error;
  }
};

export const deleteTagCategory = async (categoryId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.del(apiName, `/api/tag/categories/${categoryId}`, { headers });
  } catch (error) {
    console.error("Error deleting tag category %s:", categoryId, error);
    throw error;
  }
};

// Individual Tag Management API calls
export const getTag = async (tagName, includeImage = false) => {
  try {
    const headers = await getAuthHeaders();
    const url = `/api/tag/${tagName}${includeImage ? '?include_image=true' : ''}`;
    return await API.get(apiName, url, { headers });
  } catch (error) {
    console.error("Error fetching tag %s:", tagName, error);
    throw error;
  }
};

export const createTag = async (tagData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.post(apiName, '/api/tag/', {
      headers,
      body: tagData
    });
  } catch (error) {
    console.error('Error creating tag:', error);
    throw error;
  }
};

export const updateTag = async (tagName, tagData) => {
  try {
    const headers = await getAuthHeaders();
    return await API.put(apiName, `/api/tag/${tagName}`, {
      headers,
      body: tagData
    });
  } catch (error) {
    console.error("Error updating tag %s:", tagName, error);
    throw error;
  }
};

export const deleteTag = async (tagName) => {
  try {
    const headers = await getAuthHeaders();
    return await API.del(apiName, `/api/tag/${tagName}`, { headers });
  } catch (error) {
    console.error("Error deleting tag %s:", tagName, error);
    throw error;
  }
};

// Tag Image Management API calls
export const uploadTagImage = async (tagName, file) => {
  try {
    const headers = await getAuthHeaders();
    
    // Create FormData for file upload
    const formData = new FormData();
    formData.append('tag_name', tagName);
    formData.append('file', file);
    
    // Use fetch instead of Amplify API for file uploads
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/tag/upload-image/`, {
      method: 'POST',
      headers: {
        ...headers
        // Don't set Content-Type - let browser set it with boundary for FormData
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error("Error uploading image for tag %s:", tagName, error);
    throw error;
  }
};

export const getTagImageUrl = async (tagName) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/tag/${tagName}/image-url/`, { headers });
  } catch (error) {
    console.error("Error fetching image URL for tag %s:", tagName, error);
    throw error;
  }
};

export const deleteCamera = async (cameraId, cascade = false) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/camera/${cameraId}${cascade ? '?cascade=true' : ''}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error("Error deleting camera %s:", cameraId, error);
    throw error;
  }
};

export const createReport = async ({ bookmark_id, report_title, report_content, model_id }) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/report/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({ bookmark_id, report_title, report_content, model_id })
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating report:', error);
    throw error;
  }
};

export const loadFromTagCategory = async (tagcategoryId) => {
  try {
    const headers = await getAuthHeaders();
    return await API.get(apiName, `/api/detector/load-from-category/${tagcategoryId}`, { headers });
  } catch (error) {
    console.error("Error loading from tag category %s:", tagcategoryId, error);
    throw error;
  }
};

// Camera Creation Status API (Step Functions) - DEPRECATED
export const getCameraCreationStatus = async (executionArn) => {
  try {
    const headers = await getAuthHeaders();
    // execution_arnにはコロンが含まれるため、エンコードが必要
    const encodedArn = encodeURIComponent(executionArn);
    return await API.get(apiName, `/api/camera/creation-status/${encodedArn}`, { headers });
  } catch (error) {
    console.error("Error fetching camera creation status for %s:", executionArn, error);
    throw error;
  }
};

// Camera Deploy Status API (CloudFormation)
export const getCameraDeployStatus = async (cameraId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/camera/${cameraId}/deploy-status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching camera deploy status %s:", cameraId, error);
    throw error;
  }
};

// Test Movie API calls
export const getTestMovies = async () => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching test movies:', error);
    throw error;
  }
};

export const getTestMovie = async (testMovieId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/${testMovieId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching test movie %s:", testMovieId, error);
    throw error;
  }
};

export const createTestMovie = async (testMovieData) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(testMovieData)
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating test movie:', error);
    throw error;
  }
};

export const getTestMovieStatus = async (testMovieId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/${testMovieId}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching test movie status %s:", testMovieId, error);
    throw error;
  }
};

export const updateTestMovie = async (testMovieId, testMovieData) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/${testMovieId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(testMovieData)
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error updating test movie %s:", testMovieId, error);
    throw error;
  }
};

export const deleteTestMovie = async (testMovieId) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/${testMovieId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return true;
  } catch (error) {
    console.error("Error deleting test movie %s:", testMovieId, error);
    throw error;
  }
};

export const uploadTestMovieFile = async (filename) => {
  try {
    const headers = await getAuthHeaders();
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/api/test-movie/upload?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error getting upload URL for test movie:', error);
    throw error;
  }
};
