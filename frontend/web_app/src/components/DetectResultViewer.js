import React from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Chip, 
  Switch, 
  FormControlLabel,
  Card,
  CardContent,
  Divider
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { formatUTCWithTimezone } from '../utils/timezone';
import { useTranslation } from 'react-i18next';

const DetectCard = styled(Card)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  borderRadius: theme.spacing(2),
}));

const TagContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(1),
  marginTop: theme.spacing(1),
}));

const DetectTag = styled(Chip)(({ theme }) => ({
  borderRadius: theme.spacing(2),
  fontSize: '0.75rem',
  height: '24px',
}));

const NotifyReasonBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(1),
  padding: theme.spacing(1),
  backgroundColor: theme.palette.grey[100],
  borderRadius: theme.spacing(1),
  fontSize: '0.875rem',
}));

const AreaDetectResultBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));

const AreaStatRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
}));

const AreaStatItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
}));

/**
 * detect_result がAreaDetectEvent形式のJSONかどうかを判定し、パースする
 */
const parseAreaDetectResult = (detectResult) => {
  if (!detectResult) return null;
  
  try {
    // JSON文字列かどうかを判定
    if (typeof detectResult === 'string' && detectResult.startsWith('{')) {
      const parsed = JSON.parse(detectResult);
      // area_detect_method または intrusion_count があればAreaDetectEventと判定
      if (parsed.area_detect_method !== undefined || parsed.intrusion_count !== undefined) {
        return parsed;
      }
    }
  } catch (e) {
    // パース失敗は通常のテキストとして扱う
  }
  return null;
};

/**
 * detect_result がClassDetectEvent形式のJSONかどうかを判定し、パースする
 */
const parseClassDetectResult = (detectResult) => {
  if (!detectResult) return null;
  
  try {
    // JSON文字列かどうかを判定
    if (typeof detectResult === 'string' && detectResult.startsWith('{')) {
      const parsed = JSON.parse(detectResult);
      // classes と total_count があればClassDetectEventと判定
      if (parsed.classes !== undefined && parsed.total_count !== undefined) {
        return parsed;
      }
    }
  } catch (e) {
    // パース失敗は通常のテキストとして扱う
  }
  return null;
};

// クラス検出結果用のスタイルコンポーネント
const ClassDetectResultBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
}));

const ClassStatRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: theme.spacing(2),
}));

const ClassStatItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
}));

const DetectResultViewer = ({ detectLogs, onNotifyToggle }) => {
  const { t } = useTranslation(['pages', 'common']);
  
  if (!detectLogs || detectLogs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('pages:cameraView.noDetections')}
        </Typography>
      </Box>
    );
  }

  const handleNotifyChange = (detectLogId, newValue) => {
    if (onNotifyToggle) {
      onNotifyToggle(detectLogId, newValue);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        {t('pages:cameraView.detectionResult')}
      </Typography>
      
      {detectLogs.map((log, index) => (
        <DetectCard key={log.detect_log_id || index} elevation={2}>
          <CardContent>
            {/* 検出器名とID */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="primary" gutterBottom>
                {log.detector_name}
              </Typography>
              {log.detector_id && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  ID: {log.detector_id}
                </Typography>
              )}
            </Box>
            
            {/* 検出結果 */}
            {log.detect_result && (() => {
              const areaResult = parseAreaDetectResult(log.detect_result);
              const classResult = parseClassDetectResult(log.detect_result);
              
              if (areaResult) {
                // AreaDetectEvent の場合、きれいに表示
                return (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      {t('pages:cameraView.detectionResultLabel')}
                    </Typography>
                    <AreaDetectResultBox>
                      {/* エリア内/エリア外の数 */}
                      <AreaStatRow>
                        <AreaStatItem>
                          <Typography variant="body2" color="text.secondary">
                            {t('pages:cameraView.areaInCount')}:
                          </Typography>
                          <Typography variant="body2" fontWeight="bold" color="primary">
                            {areaResult.area_in_count ?? 0}
                          </Typography>
                        </AreaStatItem>
                        <AreaStatItem>
                          <Typography variant="body2" color="text.secondary">
                            {t('pages:cameraView.areaOutCount')}:
                          </Typography>
                          <Typography variant="body2" fontWeight="bold">
                            {areaResult.area_out_count ?? 0}
                          </Typography>
                        </AreaStatItem>
                      </AreaStatRow>
                      
                      {/* 侵入/退出の数（0でなければ表示） */}
                      {(areaResult.intrusion_count > 0 || areaResult.exit_count > 0) && (
                        <AreaStatRow>
                          {areaResult.intrusion_count > 0 && (
                            <AreaStatItem>
                              <Chip 
                                label={`${t('pages:cameraView.intrusionCount')}: ${areaResult.intrusion_count}`}
                                color="error"
                                size="small"
                                variant="outlined"
                              />
                            </AreaStatItem>
                          )}
                          {areaResult.exit_count > 0 && (
                            <AreaStatItem>
                              <Chip 
                                label={`${t('pages:cameraView.exitCount')}: ${areaResult.exit_count}`}
                                color="info"
                                size="small"
                                variant="outlined"
                              />
                            </AreaStatItem>
                          )}
                        </AreaStatRow>
                      )}
                      
                      {/* 判定方法（参考情報として小さく表示） */}
                      {areaResult.area_detect_method && (
                        <Typography variant="caption" color="text.secondary">
                          {t('pages:cameraView.areaDetectMethod')}: {
                            areaResult.area_detect_method === 'class_count_change' 
                              ? t('pages:cameraView.classCountChange')
                              : t('pages:cameraView.trackIdsChange')
                          }
                        </Typography>
                      )}
                    </AreaDetectResultBox>
                  </Box>
                );
              }
              
              if (classResult) {
                // ClassDetectEvent の場合、きれいに表示
                // tracks からクラスごとの個数を集計
                const classCountMap = {};
                if (classResult.tracks && classResult.tracks.length > 0) {
                  classResult.tracks.forEach(track => {
                    const cls = track.class || 'unknown';
                    classCountMap[cls] = (classCountMap[cls] || 0) + 1;
                  });
                }
                const classCountEntries = Object.entries(classCountMap);
                
                return (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      {t('pages:cameraView.detectionResultLabel')}
                    </Typography>
                    <ClassDetectResultBox>
                      {/* 検出総数（フィルタ後） */}
                      <ClassStatRow>
                        <ClassStatItem>
                          <Typography variant="body2" color="text.secondary">
                            {t('pages:cameraView.totalCount')}:
                          </Typography>
                          <Typography variant="body2" fontWeight="bold" color="primary">
                            {classResult.filtered_count ?? 0}
                          </Typography>
                        </ClassStatItem>
                      </ClassStatRow>
                      
                      {/* クラス別個数 */}
                      {classCountEntries.length > 0 && (
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                            {t('pages:cameraView.classCountBreakdown')}:
                          </Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                            {classCountEntries.map(([cls, count], idx) => (
                              <Chip
                                key={idx}
                                label={`${cls}: ${count}`}
                                color="primary"
                                size="small"
                                variant="outlined"
                              />
                            ))}
                          </Box>
                        </Box>
                      )}
                    </ClassDetectResultBox>
                  </Box>
                );
              }
              
              // 通常の検出結果
              return (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('pages:cameraView.detectionResultLabel')}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {log.detect_result}
                  </Typography>
                </Box>
              );
            })()}
            
            {/* 検出タグ */}
            {log.detect_tag && log.detect_tag.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t('pages:cameraView.detectedTags')}
                </Typography>
                <TagContainer>
                  {log.detect_tag.map((tag, tagIndex) => (
                    <DetectTag
                      key={tagIndex}
                      label={tag}
                      color="secondary"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </TagContainer>
              </Box>
            )}
            
            <Divider sx={{ my: 2 }} />
            
            {/* 通知フラグ */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={log.detect_notify_flg || false}
                    onChange={(e) => handleNotifyChange(log.detect_log_id, e.target.checked)}
                    color="warning"
                  />
                }
                label={t('pages:cameraView.notifyFlag')}
              />
            </Box>
            
            {/* 通知理由 */}
            {log.detect_notify_flg && log.detect_notify_reason && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  {t('pages:cameraView.notifyReason')}
                </Typography>
                <NotifyReasonBox>
                  {log.detect_notify_reason}
                </NotifyReasonBox>
              </Box>
            )}
            
            {/* 信頼度スコア */}
            {log.confidence_score && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('pages:cameraView.confidence')}: {(log.confidence_score * 100).toFixed(1)}%
                </Typography>
              </Box>
            )}
            
            {/* タイムスタンプ */}
            {log.detect_timestamp && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('pages:cameraView.detectionDateTime')} {formatUTCWithTimezone(log.detect_timestamp, 'YYYY-MM-DD HH:mm:ss')}ｘ                </Typography>
              </Box>
            )}
          </CardContent>
        </DetectCard>
      ))}
    </Box>
  );
};

export default DetectResultViewer; 