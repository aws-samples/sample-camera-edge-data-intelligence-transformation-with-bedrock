import os
import logging

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from api_gateway.api.routers import userinfo
from shared.common import setup_logger
from camera_management.api.routers import camera
from place.api.routers import place
from collector.api.routers import file, camera_collector
from detector.api.routers import detector, detect_log, detect_tag_timeseries  
from analytics.api.routers import tag, bookmark, report, search, tags
from test_movie.api.routers import test_movie
from shared.auth import cognito_auth_middleware
import boto3


# デプロイモードの確認
DEPLOY_MODE = os.getenv('DEPLOY_MODE', 'development')
IS_LAMBDA = os.getenv('AWS_EXECUTION_ENV') is not None

# ロガーの設定
logger = setup_logger('api_gateway')

# Lambda環境の場合、追加のログ設定
if IS_LAMBDA:
    logger.info("Running in Lambda environment")
    # Mangumのログも有効化
    mangum_logger = logging.getLogger('mangum')
    mangum_logger.setLevel(logging.INFO)
else:
    logger.info("Running in local/Docker environment")

logger.info(f"DEPLOY_MODE: {DEPLOY_MODE}")
logger.info(f"IS_LAMBDA: {IS_LAMBDA}")

# 環境変数の確認用ログ
logger.info(f"AUTH_MODE: {os.getenv('AUTH_MODE', 'not set')}")
logger.info(f"CLOUDFRONT_DOMAIN: {os.getenv('CLOUDFRONT_DOMAIN', 'not set')}")
logger.info(f"CAMERA_RESOURCE_DEPLOY: {os.getenv('CAMERA_RESOURCE_DEPLOY', 'not set')}")
logger.info(f"COLLECTION_RESOURCE_DEPLOY: {os.getenv('COLLECTION_RESOURCE_DEPLOY', 'not set')}")
logger.info(f"DETECTOR_RESOURCE_DEPLOY: {os.getenv('DETECTOR_RESOURCE_DEPLOY', 'not set')}")

# CORS設定用のOriginリストを動的に構築
allowed_origins = [
    "http://localhost:3000",
    "https://localhost:3000",
]

# CloudFrontドメインを環境変数から取得して追加
cloudfront_domain = os.getenv('CLOUDFRONT_DOMAIN')
if cloudfront_domain:
    # https://プレフィックスがない場合は追加
    if not cloudfront_domain.startswith('https://'):
        cloudfront_domain = f"https://{cloudfront_domain}"
    allowed_origins.append(cloudfront_domain)
    logger.info(f"Added CloudFront domain to CORS: {cloudfront_domain}")
    logger.info(f"Also added raw CloudFront domain: https://{os.getenv('CLOUDFRONT_DOMAIN')}")

logger.info(f"Allowed origins: {allowed_origins}")


app = FastAPI(
    title="Cedix API",
    description="API for Cedix project",
    version="1.0.0"
)

# Add Cognito authentication middleware FIRST
app.middleware("http")(cognito_auth_middleware)

# Add CORS middleware AFTER authentication middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Accept-Language",
        "Content-Language",
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
    ],
    expose_headers=["*"],
)

# Include routers
app.include_router(place.router, prefix="/api/place", tags=["Place"])
app.include_router(camera.router, prefix="/api/camera", tags=["Camera"])
app.include_router(camera_collector.router, prefix="/api/camera-collector", tags=["Camera Collector"])
app.include_router(file.router, prefix="/api/file", tags=["File"])
app.include_router(userinfo.router, prefix="/api/userinfo", tags=["User Info"])
app.include_router(detector.router, prefix="/api/detector", tags=["Detector"])
app.include_router(detect_log.router, prefix="/api/detect-log", tags=["Detect Log"])
app.include_router(bookmark.router, prefix="/api/bookmark", tags=["Bookmark"])
app.include_router(report.router, prefix="/api/report", tags=["Report"])
app.include_router(test_movie.router, prefix="/api/test-movie", tags=["Test Movie"])

app.include_router(search.router, prefix="/api/search", tags=["Search"])
app.include_router(detect_tag_timeseries.router, prefix="/api/timeseries", tags=["Timeseries"])
app.include_router(tag.router, prefix="/api/tag", tags=["Tag"])
app.include_router(tags.router, prefix="/api/tags", tags=["Tags"])

@app.get("/")
async def root():
    return {"message": "Welcome to the CEDIX Camera API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Lambda handler
handler = Mangum(app)
