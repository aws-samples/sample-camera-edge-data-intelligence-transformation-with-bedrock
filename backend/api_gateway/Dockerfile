# checkov:skip=CKV_DOCKER_2:Lambda container - HEALTHCHECK is not applicable for serverless functions
FROM public.ecr.aws/lambda/python:3.11

WORKDIR ${LAMBDA_TASK_ROOT}

# Install API Gateway requirements
COPY api_gateway/requirements.txt .
RUN pip install -r requirements.txt

# Copy shared modules
COPY shared/ shared/

# Copy all backend modules (only necessary files)
COPY camera_management/api/ camera_management/api/
COPY camera_management/deployment/ camera_management/deployment/
COPY camera_management/__init__.py camera_management/__init__.py

COPY place/api/ place/api/
COPY place/__init__.py place/__init__.py

COPY collector/api/ collector/api/
COPY collector/deployment/ collector/deployment/
COPY collector/__init__.py collector/__init__.py

COPY detector/api/ detector/api/
COPY detector/deployment/ detector/deployment/
COPY detector/__init__.py detector/__init__.py

COPY analytics/api/ analytics/api/
COPY analytics/deployment/ analytics/deployment/
COPY analytics/__init__.py analytics/__init__.py

COPY test_movie/api/ test_movie/api/
COPY test_movie/deployment/ test_movie/deployment/
COPY test_movie/__init__.py test_movie/__init__.py

# Copy API Gateway (main entry point) - only necessary files
COPY api_gateway/api/ api_gateway/api/
COPY api_gateway/lambda_function.py api_gateway/lambda_function.py
COPY api_gateway/__init__.py api_gateway/__init__.py

# セキュリティ対策: Lambda の非 root ユーザーを使用
USER 1051

CMD ["api_gateway.lambda_function.lambda_handler"]
