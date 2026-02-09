import React from 'react';
import { Box, Button, ButtonGroup } from '@mui/material';

const HourSelector = ({ currentHour, onHourChange }) => {
  // Generate array of hours (0-23)
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  // Group hours into 4-hour chunks for better UI
  const hourGroups = [];
  for (let i = 0; i < hours.length; i += 4) {
    hourGroups.push(hours.slice(i, i + 4));
  }
  
  return (
    <Box sx={{ mb: 2, overflowX: 'auto' }}>
      {hourGroups.map((group, groupIndex) => (
        <ButtonGroup 
          key={groupIndex} 
          variant="outlined" 
          size="small" 
          sx={{ mr: 1, mb: 1 }}
        >
          {group.map(hour => (
            <Button
              key={hour}
              onClick={() => onHourChange(hour)}
              variant={currentHour === hour ? 'contained' : 'outlined'}
              sx={{ minWidth: '40px' }}
            >
              {hour.toString().padStart(2, '0')}
            </Button>
          ))}
        </ButtonGroup>
      ))}
    </Box>
  );
};

export default HourSelector;
