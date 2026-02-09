from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from typing import List
from shared.models.models import File, FileCreate, FileQuery, HlsUrl, Mp4Download
from shared.database import (
    get_file, get_files_by_camera, get_files_by_datetime, get_files_summary_by_hour,
    create_file, update_file, delete_file, get_hls_url, get_file_for_download
)
from shared.auth import get_current_user

router = APIRouter()

@router.get("/camera/{camera_id}", response_model=List[File])
async def read_files_by_camera(
    camera_id: str, 
    collector_id: str = None,
    file_type: str = None,
    start_date: str = None, 
    end_date: str = None, 
    user: dict = Depends(get_current_user)
):
    """
    Get files by camera_id with optional collector_id, file_type and date range
    """
    return get_files_by_camera(camera_id, collector_id, file_type, start_date, end_date)

@router.get("/datetime/{camera_id}/{datetime_prefix}", response_model=FileQuery)
async def read_files_by_datetime(
    camera_id: str, 
    datetime_prefix: str,  # Format: YYYYMMDDHH or YYYYMMDDHHMM
    collector_id: str,  # Required parameter
    file_type: str,  # Required parameter
    include_presigned_url: bool = False,  # Default to False for performance
    include_detect_flag: bool = False,  # Whether to include has_detect flag
    detector_id: str = None,  # Optional detector ID to filter detect logs
    user: dict = Depends(get_current_user)
):
    """
    Get files by camera_id and datetime prefix (YYYYMMDDHH or YYYYMMDDHHMM)
    
    Args:
        camera_id: Camera ID
        datetime_prefix: Datetime prefix in YYYYMMDDHH or YYYYMMDDHHMM format
        collector_id: Collector ID (UUID, required)
        file_type: File type 'image' or 'video' (required)
        include_presigned_url: Whether to include presigned URLs (default: False for timeline display)
        include_detect_flag: Whether to include has_detect flag (default: False)
        detector_id: Optional detector_id to filter detect logs (default: None)
    """
    try:
        # Validate datetime_prefix format
        if len(datetime_prefix) not in [10, 12] or not datetime_prefix.isdigit():
            raise HTTPException(
                status_code=400,
                detail="Invalid datetime format. Expected format: YYYYMMDDHH or YYYYMMDDHHMM"
            )
        
        # Validate required parameters
        if not collector_id:
            raise HTTPException(
                status_code=400,
                detail="collector_id parameter is required"
            )
        if not file_type:
            raise HTTPException(
                status_code=400,
                detail="file_type parameter is required"
            )
        if file_type not in ['image', 'video']:
            raise HTTPException(
                status_code=400,
                detail="file_type must be 'image' or 'video'"
            )
        
        files = get_files_by_datetime(camera_id, datetime_prefix, collector_id, file_type, include_presigned_url, include_detect_flag, detector_id)
        return {
            "camera_id": camera_id,
            "datetime": datetime_prefix,
            "files": files
        }
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(
            status_code=400,
            detail=str(ve)
        )
    except Exception as e:
        print(f"Error in read_files_by_datetime: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error while fetching files"
        )

@router.get("/hls/{camera_id}", response_model=HlsUrl)
async def get_camera_hls_url(camera_id: str, user: dict = Depends(get_current_user)):
    """
    Get HLS URL for a camera
    """
    hls_url = get_hls_url(camera_id)
    if not hls_url:
        raise HTTPException(status_code=404, detail="Camera not found or HLS URL not available")
    return hls_url

@router.get("/mp4download/{file_id}", response_model=Mp4Download)
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    """
    Get download URL for a file (supports both video and image files)
    """
    print(f"Processing download request for file_id: {file_id}")
    file = get_file_for_download(file_id)
    if not file:
        print(f"File not found or not available for download: {file_id}")
        raise HTTPException(status_code=404, detail="File not found or not available for download")
    
    print(f"File found: {file}")
    
    if not file.get('s3path'):
        print(f"File has no S3 path: {file_id}")
        raise HTTPException(status_code=404, detail="File has no S3 path")
    
    # Check if we have a presigned URL
    if not file.get('presigned_url'):
        print(f"Failed to generate presigned URL for file: {file_id}")
        raise HTTPException(status_code=500, detail="Failed to generate presigned URL")
    
    print(f"Returning presigned URL for file: {file_id}")
    return {
        "file_id": file_id,
        "s3path": file.get('s3path'),
        "presigned_url": file.get('presigned_url')
    }

@router.post("/", response_model=File, status_code=status.HTTP_201_CREATED)
async def create_new_file(file: FileCreate, user: dict = Depends(get_current_user)):
    """
    Create a new file
    """
    file_data = file.model_dump()
    return create_file(file_data)

@router.get("/{file_id}", response_model=File)
async def read_file(file_id: str, user: dict = Depends(get_current_user)):
    """
    Get a file by ID
    """
    file = get_file(file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    return file

@router.put("/{file_id}", response_model=File)
async def update_existing_file(
    file_id: str, 
    file: File, 
    user: dict = Depends(get_current_user)
):
    """
    Update a file
    """
    # Check if file exists
    existing_file = get_file(file_id)
    if not existing_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    file_data = file.model_dump()
    updated_file = update_file(file_id, file_data)
    if not updated_file:
        raise HTTPException(status_code=500, detail="Failed to update file")
    
    return updated_file

@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_file(file_id: str, user: dict = Depends(get_current_user)):
    """
    Delete a file
    """
    success = delete_file(file_id)
    if not success:
        raise HTTPException(status_code=404, detail="File not found")
    return None

@router.get("/summary/{camera_id}/{datetime_prefix}")
async def read_files_summary_by_hour(
    camera_id: str, 
    datetime_prefix: str,  # Format: YYYYMMDDHH
    collector_id: str = None,
    file_type: str = None,
    include_detect_flag: bool = False,  # ✅ 新規パラメータ
    detector_id: str = None,  # Optional detector ID to filter detect logs
    user: dict = Depends(get_current_user)
):
    """
    Get summary of files by camera_id and hour (YYYYMMDDHH) - returns which minutes have data
    This is optimized for Timeline display
    detector_id: Optional detector_id to filter detect logs
    """
    try:
        # Validate datetime_prefix format
        if len(datetime_prefix) != 10 or not datetime_prefix.isdigit():
            raise HTTPException(
                status_code=400,
                detail="Invalid datetime format. Expected format: YYYYMMDDHH"
            )
        
        summary = get_files_summary_by_hour(camera_id, datetime_prefix, collector_id, file_type, include_detect_flag, detector_id)
        return {
            "camera_id": camera_id,
            "datetime": datetime_prefix,
            "summary": summary
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in read_files_summary_by_hour: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error while fetching file summary"
        )
