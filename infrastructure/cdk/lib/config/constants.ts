/**
 * 共通定数定義
 */

export const ECR_LIFECYCLE_POLICY = {
  rules: [
    {
      rulePriority: 1,
      description: '保持するイメージは直近5つまで',
      selection: {
        tagStatus: 'any',
        countType: 'imageCountMoreThan',
        countNumber: 5,
      },
      action: {
        type: 'expire',
      },
    },
  ],
};

export const DOCKER_PLATFORMS = {
  ARM64: 'linux/arm64',
  AMD64: 'linux/amd64',
} as const;

export const TABLE_NAMES = {
  PLACE: 'cedix-place',
  CAMERA: 'cedix-camera',
  COLLECTOR: 'cedix-collector',
  DETECTOR: 'cedix-detector',
  DETECT_LOG: 'cedix-detect-log',
  DETECT_LOG_TAG: 'cedix-detect-log-tag',
  DETECT_TAG_TIMESERIES: 'cedix-detect-tag-timeseries',
  FILE: 'cedix-file',
  BOOKMARK: 'cedix-bookmark',
  BOOKMARK_DETAIL: 'cedix-bookmark-detail',
  TAG_CATEGORY: 'cedix-tag-category',
  TAG: 'cedix-tag',
  TRACK_LOG: 'cedix-track-log',
  TEST_MOVIE: 'cedix-test-movie',
  RTMP_NLB: 'cedix-rtmp-nlb',
} as const;

