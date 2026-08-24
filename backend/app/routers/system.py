from fastapi import APIRouter

from .. import schemas
from ..services import separation

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/info", response_model=schemas.SystemInfo)
def system_info():
    return schemas.SystemInfo(gpu_available=separation.has_gpu())
