# Stage 1: Build dependencies on Lambda Python 3.12 (glibc 2.34)
# checkov:skip=CKV_DOCKER_2:Builder stage - intermediate image
# Python 3.12 Lambda image has glibc 2.34, so manylinux_2_28 wheels work
FROM public.ecr.aws/lambda/python:3.12 AS builder

# Install git for cloning YOLO (same approach as hlsyolo)
RUN dnf install -y git && dnf clean all

# Copy requirements
COPY collector/docker/s3yolo/requirements.txt /tmp/

# Install dependencies
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Install YOLOv9 MIT from GitHub (same approach as hlsyolo)
RUN git clone https://github.com/WongKinYiu/YOLO.git /tmp/yolo && \
    cd /tmp/yolo && \
    pip install --no-cache-dir . && \
    rm -rf /tmp/yolo

# Stage 2: Lambda runtime
# checkov:skip=CKV_DOCKER_2:Lambda container - HEALTHCHECK is not applicable for serverless functions
FROM public.ecr.aws/lambda/python:3.12

# Set working directory
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy Python packages from builder stage
COPY --from=builder /var/lang/lib/python3.12/site-packages/ /var/lang/lib/python3.12/site-packages/

# Copy YOLO config files
COPY shared/yolo_detector/yolo/config shared/yolo_detector/yolo/config

# Copy shared modules
COPY shared/ shared/

# Copy s3yolo Lambda function
COPY collector/docker/s3yolo/s3yolo.py .

# Security: Use Lambda's non-root user
USER 1051

# Set command
CMD ["s3yolo.lambda_handler"]
