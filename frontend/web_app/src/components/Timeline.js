import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { formatUTCWithTimezone } from '../utils/timezone';

const TimelineContainer = styled.div`
  background-color: white;
  border-radius: 10px;
  padding: 10px;
  position: relative;
  height: 60px; /* Adjusted height */
  overflow: hidden;
  margin-top: 20px;
  margin-bottom: 20px;
`;

const TimelineRuler = styled.div`
  display: flex;
  width: 100%;
  height: 30px;
  position: relative;
  border-bottom: 1px solid #ddd;
  cursor: pointer;
  
  /* Add grid lines for 1-minute intervals */
  background-image: 
    /* 10-minute intervals (stronger lines) */
    repeating-linear-gradient(
      90deg,
      transparent,
      transparent calc(100% / 6 - 1px),
      rgba(200, 200, 200, 0.5) calc(100% / 6)
    ),
    /* 1-minute intervals (lighter lines) */
    repeating-linear-gradient(
      90deg,
      transparent,
      transparent calc(100% / 60 - 1px),
      rgba(200, 200, 200, 0.1) calc(100% / 60)
    );
`;

const TimePopup = styled.div`
  position: absolute;
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 14px;
  top: -40px;
  transform: translateX(-50%);
  z-index: 100;
  pointer-events: none;
  opacity: ${props => props.$visible ? 1 : 0};
  transition: opacity 0.2s ease;
`;

const TimeMarker = styled.div`
  position: absolute;
  height: 100%;
  border-right: 1px solid #ccc;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 12px;
  color: #666;
  
  &::after {
    content: '';
    position: absolute;
    bottom: -5px;
    width: 1px;
    height: 5px;
    background-color: #ccc;
  }
`;

const TimeLabel = styled.div`
  position: absolute;
  top: 5px;
  transform: translateX(-50%);
  font-size: 12px;
  color: #666;
`;

const MediaSegment = styled.div`
  position: absolute;
  height: 6px;
  background-color: #3498db;  /* 常に青色（DetectMarkerを別途表示するため） */
  top: 32px; /* Positioned just below the timeline ruler */
  border-radius: 3px;
  z-index: 5;
  cursor: pointer;
  transition: background-color 0.2s ease, opacity 0.2s ease;
  margin: 0; /* Remove margin to ensure exact alignment */
  box-sizing: border-box; /* Ensure padding and border are included in width */
  
  &:hover {
    background-color: #2980b9;  /* ホバー時は濃い青 */
  }
  
  /* Loading state styling */
  &.loading {
    opacity: 0.3;
    cursor: not-allowed;
    animation: pulse 1.5s infinite;
  }
  
  @keyframes pulse {
    0% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.6;
    }
    100% {
      opacity: 0.3;
    }
  }
`;

const CurrentMediaSegment = styled(MediaSegment)`
  background-color: #e74c3c !important;
  border: 2px solid #c0392b !important;
  z-index: 10 !important;
  
  &:hover {
    background-color: #c0392b !important;
  }
`;

const DetectMarker = styled.div`
  position: absolute;
  height: 4px;  /* MediaSegmentより少し小さく */
  background-color: #ffc107;  /* 黄色 */
  top: 40px; /* MediaSegmentの下に配置 */
  border-radius: 2px;
  z-index: 6;  /* MediaSegmentの上 */
  pointer-events: none;  /* クリックイベントは親のMediaSegmentに任せる */
  box-sizing: border-box;
`;

const Timeline = ({ 
  currentHour, 
  mediaSegments = [], 
  minuteSummary = [],
  onTimeSelected,
  currentTime = null,
  currentSegmentId = null
}) => {
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState(0);
  const [popupTime, setPopupTime] = useState('');
  const timelineRef = useRef(null);
  const popupTimeout = useRef(null);
  
  // Log props changes for debugging
  useEffect(() => {
    console.log('=== Timeline Props Changed ===');
    console.log('currentSegmentId:', currentSegmentId, typeof currentSegmentId);
    console.log('mediaSegments:', mediaSegments);
    console.log('currentTime:', currentTime);
    console.log('currentHour:', currentHour);
  }, [currentSegmentId, mediaSegments, currentTime, currentHour]);
  
  console.log('Timeline props currentTime:', currentTime);
  
  // Generate time markers with 10-minute intervals (0, 10, ..., 60)
  const generateTimeMarkers = () => {
    const markers = [];
    for (let i = 0; i <= 6; i++) {
      const minute = i * 10;
      const label = `${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const position = (minute / 60) * 100;
      markers.push(
        <TimeMarker key={minute} style={{ left: `${position}%` }}>
          <TimeLabel>{label}</TimeLabel>
        </TimeMarker>
      );
    }
    return markers;
  };
  
  // Calculate position for media segments
  const calculateSegmentPosition = (timeString) => {
    if (!timeString) return null;
    try {
      // UTC時刻をユーザー設定のタイムゾーンに変換
      const formattedTime = formatUTCWithTimezone(timeString, 'HH:mm:ss');
      const [hours, minutes] = formattedTime.split(':').map(Number);
      if (hours !== currentHour) return null;
      return (minutes / 60) * 100;
    } catch (error) {
      console.error('Error parsing segment time:', error);
      return null;
    }
  };
  
  // Generate media segment markers
  const generateMediaSegments = () => {
    console.log('=== Timeline generateMediaSegments ===');
    console.log('currentSegmentId:', currentSegmentId, typeof currentSegmentId);
    console.log('mediaSegments:', mediaSegments);
    console.log('minuteSummary:', minuteSummary);
    
    const segments = [];
    
    // Add segments from mediaSegments (detailed data for current minute)
    mediaSegments.forEach((segment, index) => {
      const startPosition = (() => {
        if (!segment.startTime) return null;
        try {
          // UTC時刻をユーザー設定のタイムゾーンに変換
          const formattedTime = formatUTCWithTimezone(segment.startTime, 'HH:mm:ss');
          const [hours, minutes] = formattedTime.split(':').map(Number);
          if (hours !== currentHour) return null;
          return (minutes / 60) * 100;
        } catch (error) {
          console.error('Error parsing segment time:', error);
          return null;
        }
      })();
      if (startPosition === null) return;
      
      const width = 100 / 60;
      const isCurrentSegment = segment.id === currentSegmentId;
      console.log(`Segment ${index}: id="${segment.id}", currentSegmentId="${currentSegmentId}", isCurrentSegment=${isCurrentSegment}, has_detect=${segment.has_detect}`);
      
      const SegmentComponent = isCurrentSegment ? CurrentMediaSegment : MediaSegment;
      
      // ✅ MediaSegment（青色または赤色バー）を追加
      segments.push(
        <SegmentComponent 
          key={`detailed-${index}`}
          data-is-current={isCurrentSegment}
          data-segment-id={segment.id}
          style={{ 
            left: `${startPosition}%`,
            width: `${width}%`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            console.log('Detailed segment clicked:', segment);
            if (onTimeSelected) {
              onTimeSelected(segment);
            }
          }}
        />
      );
      
      // ✅ DetectMarker（黄色マーカー）を追加（has_detectがtrueの場合のみ）
      if (segment.has_detect) {
        segments.push(
          <DetectMarker 
            key={`detect-detailed-${index}`}
            style={{ 
              left: `${startPosition}%`,
              width: `${width}%`,
            }}
          />
        );
      }
    });
    
    // Add segments from minuteSummary (summary data for other minutes)
    minuteSummary.forEach((summary, index) => {
      const minute = summary.minute;
      const startPosition = (minute / 60) * 100;
      const width = 100 / 60;
      
      // Check if this minute already has detailed segments
      const hasDetailedSegments = mediaSegments.some(segment => {
        if (!segment.startTime) return false;
        try {
          // UTC時刻をユーザー設定のタイムゾーンに変換
          const formattedTime = formatUTCWithTimezone(segment.startTime, 'HH:mm:ss');
          const [hours, minutes, seconds] = formattedTime.split(':').map(Number);
          // More precise checking: consider the exact minute this segment belongs to
          return hours === currentHour && minutes === minute;
        } catch (error) {
          return false;
        }
      });
      
      // Only add summary segment if no detailed segments exist for this minute
      if (!hasDetailedSegments) {
        // ✅ MediaSegment（青色バー）を追加
        segments.push(
          <MediaSegment 
            key={`summary-${index}`}
            style={{ 
              left: `${startPosition}%`,
              width: `${width}%`,
            }}
            onClick={(e) => {
              e.stopPropagation();
              console.log('Summary segment clicked for minute:', minute);
              if (onTimeSelected) {
                // Create a time object for the clicked minute
                const timeString = `${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                onTimeSelected({
                  time: timeString,
                  hour: currentHour,
                  minute: minute
                });
              }
            }}
          />
        );
        
        // ✅ DetectMarker（黄色マーカー）を追加（has_detectがtrueの場合のみ）
        if (summary.has_detect) {
          segments.push(
            <DetectMarker 
              key={`detect-${index}`}
              style={{ 
                left: `${startPosition}%`,
                width: `${width}%`,
              }}
            />
          );
        }
      }
    });
    
    console.log(`Generated ${segments.length} total segments`);
    console.log('=== Timeline generateMediaSegments END ===');
    return segments;
  };
  
  // Function to calculate time from position
  const calculateTimeFromPosition = (position) => {
    const totalWidth = timelineRef.current ? timelineRef.current.offsetWidth : 0;
    const percentage = position / totalWidth;
    
    // Calculate minutes based on percentage within the hour
    let minute = Math.floor(percentage * 60);
    
    // Handle minute overflow
    if (minute >= 60) {
      minute = 59;
    }
    
    // Format the time
    return `${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };
  
  // Handle click on timeline
  const handleTimelineClick = (e) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const position = e.clientX - rect.left;
    const percentage = (position / rect.width) * 100;
    // 秒単位で正確に計算
    const totalSeconds = Math.floor((percentage / 100) * 3600);
    const minute = Math.floor(totalSeconds / 60);
    const second = totalSeconds % 60;
    
    // クリックされた時刻文字列（ユーザー設定のタイムゾーンベース）
    const clickedTimeStr = `${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
    setPopupTime(clickedTimeStr);
    setPopupPosition(percentage);
    setShowPopup(true);

    // MediaSegmentの中で該当するものを探す（ユーザー設定のタイムゾーンで比較）
    let foundSegment = null;
    // クリック位置を「その時間内での秒数」として計算（0-3599）
    const clickedSecondsInHour = minute * 60 + second;
    
    for (const segment of mediaSegments) {
      if (!segment.startTime || !segment.endTime) continue;
      
      // UTC時刻をユーザー設定のタイムゾーンに変換
      const startTimeStr = formatUTCWithTimezone(segment.startTime, 'HH:mm:ss');
      const endTimeStr = formatUTCWithTimezone(segment.endTime, 'HH:mm:ss');
      
      // HH:mm:ss形式の文字列を時・分・秒に分解
      const [startHour, startMinute, startSecond] = startTimeStr.split(':').map(Number);
      const [endHour, endMinute, endSecond] = endTimeStr.split(':').map(Number);
      
      // セグメントが現在の時間帯に属するか確認
      if (startHour !== currentHour) continue;
      
      // セグメントの範囲を「その時間内での秒数」として計算
      const startSecondsInHour = startMinute * 60 + startSecond;
      const endSecondsInHour = endMinute * 60 + endSecond;
      
      // セグメントの範囲内かチェック
      if (clickedSecondsInHour >= startSecondsInHour && clickedSecondsInHour < endSecondsInHour) {
        foundSegment = segment;
        break;
      }
    }
    
    if (foundSegment && onTimeSelected) {
      // セグメントとクリック時刻の両方を渡す
      onTimeSelected({
        ...foundSegment,
        selectedTime: clickedTimeStr
      });
    } else if (onTimeSelected) {
      onTimeSelected({
        time: `${currentHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        hour: currentHour,
        minute: minute
      });
    }

    // Hide popup after 2 seconds
    if (popupTimeout.current) {
      clearTimeout(popupTimeout.current);
    }
    popupTimeout.current = setTimeout(() => {
      setShowPopup(false);
    }, 2000);
  };
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (popupTimeout.current) {
        clearTimeout(popupTimeout.current);
      }
    };
  }, []);
  
  return (
    <TimelineContainer>
      <div style={{position: 'relative'}}>
        <TimelineRuler ref={timelineRef} onClick={handleTimelineClick}>
          {generateTimeMarkers()}
          <TimePopup 
            style={{ left: `${popupPosition}%` }} 
            $visible={showPopup}
          >
            {popupTime}
          </TimePopup>
        </TimelineRuler>
        {generateMediaSegments()}
      </div>
    </TimelineContainer>
  );
};

export default Timeline;
