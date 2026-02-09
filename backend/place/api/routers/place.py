from fastapi import APIRouter, Depends, HTTPException, status, Request
from typing import List, Dict, Any
from shared.models.models import Place, PlaceCreate
from shared.database import get_all_places, get_place, create_place, update_place, delete_place, get_cameras_count_by_place
from shared.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/", response_model=List[Dict[str, Any]])
async def get_places(current_user: dict = Depends(get_current_user)):
    """
    場所一覧を取得
    """
    try:
        places = get_all_places()
        return places
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"場所一覧取得エラー: {str(e)}")

@router.get("/{place_id}", response_model=Place)
async def read_place(place_id: str, user: dict = Depends(get_current_user)):
    """
    Get a place by ID
    """
    place = get_place(place_id)
    if place is None:
        raise HTTPException(status_code=404, detail="Place not found")
    return place

@router.post("/", response_model=Place, status_code=status.HTTP_201_CREATED)
async def create_new_place(place: PlaceCreate, user: dict = Depends(get_current_user)):
    """
    Create a new place
    """
    # Generate place_id automatically
    place_id = str(uuid.uuid4())
    
    place_data = place.model_dump()
    place_data['place_id'] = place_id
    
    return create_place(place_data)

@router.put("/{place_id}", response_model=Place)
async def update_existing_place(place_id: str, place: Place, user: dict = Depends(get_current_user)):
    """
    Update a place
    """
    # Check if place exists
    existing_place = get_place(place_id)
    if not existing_place:
        raise HTTPException(status_code=404, detail="Place not found")
    
    place_data = place.model_dump()
    updated_place = update_place(place_id, place_data)
    if not updated_place:
        raise HTTPException(status_code=500, detail="Failed to update place")
    
    return updated_place

@router.delete("/{place_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_place(place_id: str, cascade: bool = False, user: dict = Depends(get_current_user)):
    """
    Delete a place
    """
    # Check if place exists
    existing_place = get_place(place_id)
    if not existing_place:
        raise HTTPException(status_code=404, detail="Place not found")
    
    # Check if there are cameras associated with this place
    camera_count = get_cameras_count_by_place(place_id)
    if camera_count > 0 and not cascade:
        raise HTTPException(
            status_code=400, 
            detail=f"この場所には{camera_count}台のカメラが関連付けられています。先にカメラを削除してください。"
        )
    
    success = delete_place(place_id, cascade)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete place")
    return None
